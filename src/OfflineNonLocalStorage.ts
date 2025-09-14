import NonLocalStorage from './NonLocalStorage'
import { DEFAULT_DURABLE_CACHE_CLASS, getId } from './Base'
import {
  OfflineSyncOptions,
  OfflineSyncOptionsExtra,
  LogLevel,
  StorageAdapter,
  ItemType,
  ItemsType,
  Credentials
} from './types'
import getLogger, { Logger } from './logger'
import { getStorage, OutboxOp, isExpired, safeStorageRemove, safeStorageSet, isConnectionError, DEFAULT_TTL, processOutbox, afterProcessOutbox, startSweep, stopSweep } from './offlineHelpers'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Handles synchronization between local and remote storage when a connection is established.
 * Processes the outbox and updates local/remote items.
 *
 * @param options - Extra offline sync options.
 * @param storage - The storage adapter.
 * @param store - Local store of items.
 * @param outbox - Array of outbox operations.
 * @param remoteItems - Remote items to synchronize.
 * @param nls - NonLocalStorage instance.
 * @param fireLocalEvent - Function to fire local events.
 * @param logger - Logger instance.
 * @internal
 */
async function handleConnect (
  options: OfflineSyncOptionsExtra,
  storage: StorageAdapter,
  store: Record<string, any>,
  outbox: OutboxOp[] = [],
  remoteItems: ItemsType = {},
  nls: NonLocalStorage | undefined,
  fireLocalEvent: (event: string, payload: any) => void,
  logger: Logger
) {
  const updateHandlers = {
    set: async (prop: string, item: ItemType) => {
      if (!nls) return
      const now = Date.now()
      return nls.setItem(prop, item.value, { ttl: item.expiresAt > now ? item.expiresAt - Date.now() : undefined })
    },
    remove: async (prop: string) => {
      if (!nls) return
      return nls.removeItem(prop)
    }
  }
  await processOutbox(options, storage, outbox, remoteItems, updateHandlers, logger)
  await afterProcessOutbox(options, storage, store, remoteItems, updateHandlers, fireLocalEvent, logger)
}

/**
 * Creates an offline-capable NonLocalStorage instance.
 * Synchronizes local changes with remote storage when online, and queues changes for later sync when offline.
 * Provides a unified API for item management, event handling, and connection state.
 *
 * @param credentials - Credentials for remote storage access.
 * @param idOrOptions - Either a string ID or an OfflineSyncOptions object.
 * @returns A promise that resolves to a NonLocalStorage instance.
 *
 * @example
 * const nls = await createOfflineNonLocalStorage({ projectId: 'myProject' }, { ttl: 60000 });
 * await nls.setItem('key', 'value');
 * const value = await nls.getItem('key');
 */
export default async function createOfflineNonLocalStorage (
  credentials: Credentials,
  idOrOptions?: string | OfflineSyncOptions
): Promise<NonLocalStorage> {
  let options: OfflineSyncOptions
  let id: string | undefined
  let className: string | undefined
  let ttl: number | undefined
  let logLevel: LogLevel

  if (typeof idOrOptions === 'string') {
    id = idOrOptions
    className = DEFAULT_DURABLE_CACHE_CLASS
    ttl = DEFAULT_TTL
    options = { id }
    logLevel = 'warn'
  } else {
    className = idOrOptions?.class || DEFAULT_DURABLE_CACHE_CLASS
    id = idOrOptions?.id || getId(credentials.projectId, className)
    ttl = idOrOptions?.ttl || DEFAULT_TTL
    options = { ...(idOrOptions || {}) }
    logLevel = idOrOptions?.logLevel || 'warn'
  }

  const logger = getLogger(logLevel)
  const storageOptions = { projectId: credentials.projectId, class: className, id, ttl }
  const storage = getStorage(storageOptions, options.storage)

  const store: Record<string, any> = await storage.getAll()
  let localKeys = Object.keys(store)
  if (localKeys.length === 0) localKeys = ['__just_a_dummy_key__']
  const outbox: OutboxOp[] = (await storage.get('_outbox')) || []

  let nls: NonLocalStorage | undefined
  let isOnline = false
  let remoteItems: ItemsType | undefined

  // --- Local event system ---
  const listeners: Record<string, Set<Function>> = {}

  // Supported remote events
  const REMOTE_EVENTS = [
    'connect',
    'disconnect',
    'presence:join',
    'presence:leave',
    'message',
    'error',
    'setItem',
    'removeItem'
  ]

  // Helper to fire local events (including named events)
  function fireLocalEvent (event: string, payload: any) {
    if (listeners[event]) {
      for (const fn of listeners[event]) fn(payload)
    }
    if (payload?.prop) {
      const key = `${event}:${payload?.prop}`
      if (listeners[key]) {
        for (const fn of listeners[key]) fn(payload)
      }
    }
  }

  function attachRemoteListeners () {
    if (!nls || typeof nls.on !== 'function') return
    // Attach only for events that have at least one local listener
    for (const event of ['setItem', 'removeItem', 'connect', 'disconnect']) {
      if (listeners[event]?.size > 0) {
        attachRemoteListener(event)
      }
    }
  }

  // Track which remote listeners are currently attached
  const remoteListenerEvents = new Set<string>()

  // Attach remote listener for event (and optional name for named events)
  function attachRemoteListener (event: string, name?: string) {
    const key = name ? `${event}:${name}` : event
    if (!nls || typeof nls.on !== 'function' || remoteListenerEvents.has(key)) return
    remoteListenerEvents.add(key)
    if (name) {
      if (event === 'setItem') {
        nls.on('setItem', name, remoteSetItemHandler)
      } else if (event === 'removeItem') {
        nls.on('removeItem', name, remoteRemoveItemHandler)
      }
    } else {
      if (event === 'connect') {
        nls.on('connect', remoteConnectHandler)
      } else if (event === 'disconnect') {
        nls.on('disconnect', remoteDisconnectHandler)
      } else if (event === 'setItem') {
        nls.on('setItem', remoteSetItemHandler)
      } else if (event === 'removeItem') {
        nls.on('removeItem', remoteRemoveItemHandler)
      } else if (event === 'error') {
        nls.on('error', (payload: any) => fireLocalEvent(event, payload))
      } else if (event === 'message') {
        nls.on('message', (payload: any) => fireLocalEvent(event, payload))
      } else if (event === 'presence:join') {
        nls.on('presence:join', (payload: any) => fireLocalEvent(event, payload))
      } else if (event === 'presence:leave') {
        nls.on('presence:leave', (payload: any) => fireLocalEvent(event, payload))
      }
    }
  }

  // Detach remote listener for event (and optional name for named events)
  function detachRemoteListener (event: string, name?: string) {
    const key = name ? `${event}:${name}` : event
    if (!nls || typeof nls.off !== 'function' || !remoteListenerEvents.has(key)) return
    remoteListenerEvents.delete(key)
    if (name) {
      if (event === 'setItem') {
        nls.off('setItem', name, remoteSetItemHandler)
      } else if (event === 'removeItem') {
        nls.off('removeItem', name, remoteRemoveItemHandler)
      }
    } else {
      if (event === 'connect') {
        nls.off('connect', remoteConnectHandler)
      } else if (event === 'disconnect') {
        nls.off('disconnect', remoteDisconnectHandler)
      } else if (event === 'setItem') {
        nls.off('setItem', remoteSetItemHandler)
      } else if (event === 'removeItem') {
        nls.off('removeItem', remoteRemoveItemHandler)
      } else if (event === 'error') {
        nls.off('error', (payload: any) => fireLocalEvent(event, payload))
      } else if (event === 'message') {
        nls.off('message', (payload: any) => fireLocalEvent(event, payload))
      } else if (event === 'presence:join') {
        nls.off('presence:join', (payload: any) => fireLocalEvent(event, payload))
      } else if (event === 'presence:leave') {
        nls.off('presence:leave', (payload: any) => fireLocalEvent(event, payload))
      }
    }
  }

  // Detach all remote listeners
  function detachAllRemoteListeners () {
    for (const key of Array.from(remoteListenerEvents)) {
      const [event, name] = key.split(':')
      detachRemoteListener(event, name)
    }
  }

  const reconnectBaseDelay = options.connectionSettings?.reconnectBaseDelay ?? 1000
  const reconnectMaxDelay = options.connectionSettings?.reconnectMaxDelay ?? 30000
  let delay = reconnectBaseDelay

  // Remote event handlers
  function remoteSetItemHandler (item: any) {
    store[item.prop] = item
    safeStorageSet(storage, item.prop, item)
    fireLocalEvent('setItem', item)
  }
  function remoteRemoveItemHandler (item: any) {
    delete store[item.prop]
    safeStorageRemove(storage, item.prop)
    fireLocalEvent('removeItem', item)
  }
  function remoteConnectHandler () {
    isOnline = true
    fireLocalEvent('connect', {})
  }
  function remoteDisconnectHandler () {
    isOnline = false
    fireLocalEvent('disconnect', {})
    setTimeout(tryReconnect, delay)
  }

  async function initNls () {
    try {
      nls ||= typeof idOrOptions === 'string'
        ? new NonLocalStorage(credentials, idOrOptions)
        : new NonLocalStorage(credentials, idOrOptions)

      if ((nls as any).isGettingAccessToken) {
        await (nls as any).isGettingAccessToken
        isOnline = true
      }
    } catch (err: any) {
      if (!isConnectionError(err)) throw err
      isOnline = false
    }

    if (nls) {
      try {
        remoteItems = await nls.getItems(localKeys)
        isOnline = true
      } catch (err: any) {
        if (!isConnectionError(err)) throw err
        isOnline = false
      }
    }
    if (isOnline) attachRemoteListeners()
  }

  await initNls()

  let reconnectAttempts = 0
  const tryReconnect = async () => {
    reconnectAttempts++
    delay = Math.min(
      reconnectBaseDelay * Math.pow(2, reconnectAttempts),
      reconnectMaxDelay
    )
    try {
      await initNls()
      if (!isOnline) {
        await wait(delay)
        return tryReconnect()
      }
      reconnectAttempts = 0
      logger.log('info', `Back online, ${outbox.length > 0 ? `synchronize ${outbox.length} item changes` : 'nothing to synchronize'}.`)
      await handleConnect(options, storage, store, outbox, remoteItems, nls, fireLocalEvent, logger)
    } catch (err: any) {
      logger.log('error', err.message || err.code || err.name)
    }
  }

  if (isOnline) {
    await handleConnect(options, storage, store, outbox, remoteItems, nls, fireLocalEvent, logger)
  } else {
    setTimeout(tryReconnect, delay)
  }

  let lastJoinedConnections: any[] = []

  // --- Build API wrapper ---
  const wrapper: any = {
    async setItem (key: string, value: any, opts?: { ttl?: number, ifAbsent?: boolean, updatedAt?: number }) {
      const now = Date.now()
      const effectiveTtl = opts?.ttl ?? ttl ?? DEFAULT_TTL
      const existingMeta = store[key]
      if (opts?.ifAbsent && existingMeta && !isExpired(existingMeta)) {
        return existingMeta
      }
      const meta = {
        value,
        createdAt: store[key]?.createdAt ?? now,
        updatedAt: now,
        expiresAt: now + effectiveTtl
      }
      store[key] = meta
      await safeStorageSet(storage, key, meta)
      if (isOnline && nls) {
        try {
          const remote = await nls.setItem(key, value, opts)
          // Cache remote value locally (in case remote returns more accurate meta)
          if (remote !== undefined) {
            const remoteMeta = {
              value,
              createdAt: remote.createdAt ?? now,
              updatedAt: remote.updatedAt ?? now,
              expiresAt: remote.expiresAt ?? (now + effectiveTtl)
            }
            store[key] = remoteMeta
            await safeStorageSet(storage, key, remoteMeta)
          }
          return remote
        } catch (err: any) {
          if (!isConnectionError(err)) throw err
          isOnline = false
          fireLocalEvent('disconnect', {})
          setTimeout(tryReconnect, delay)
        }
      }
      // Offline: queue for later sync
      isOnline = false
      outbox.push({ op: 'set', prop: key, value: meta })
      await safeStorageSet(storage, '_outbox', outbox)
      fireLocalEvent('setItem', { prop: key, ...meta })
      return meta
    },

    async removeItem (key: string) {
      delete store[key]
      await safeStorageRemove(storage, key)
      if (isOnline && nls) {
        try {
          return await nls.removeItem(key)
          // Do NOT fireLocalEvent here; remote listener will handle it
        } catch (err: any) {
          if (!isConnectionError(err)) throw err
          isOnline = false
          fireLocalEvent('disconnect', {})
          setTimeout(tryReconnect, delay)
        }
      }

      // Offline: queue for later sync
      isOnline = false
      outbox.push({ op: 'remove', prop: key })
      await safeStorageSet(storage, '_outbox', outbox)
      fireLocalEvent('removeItem', { prop: key })
    },

    getItem: async (key: string) => {
      if (isOnline && nls) {
        try {
          const remote = await nls.getItem(key)
          if (remote !== undefined) {
            // Cache remote value locally
            const now = Date.now()
            const meta = {
              value: remote.value ?? remote,
              createdAt: remote.createdAt ?? now,
              updatedAt: remote.updatedAt ?? now,
              expiresAt: remote.expiresAt ?? (now + (ttl ?? DEFAULT_TTL))
            }
            store[key] = meta
            await safeStorageSet(storage, key, meta)
          }
          return remote
        } catch (err: any) {
          if (!isConnectionError(err)) throw err
          isOnline = false
          fireLocalEvent('disconnect', {})
          setTimeout(tryReconnect, delay)
          // fallback to local below
        }
      }

      // is offline
      isOnline = false
      const meta = store[key]
      if (!meta || isExpired(meta)) return undefined
      return meta
    },

    getAllItems: async (options?: { prefix?: string }) => {
      if (isOnline && nls) {
        try {
          const remote = await nls.getAllItems(options)
          if (remote) {
            // Cache all remote values locally
            const remoteKeys = Object.keys(remote)
            for (const [k, v] of Object.entries(remote)) {
              const now = Date.now()
              const meta = {
                value: v.value ?? v,
                createdAt: v.createdAt ?? now,
                updatedAt: v.updatedAt ?? now,
                expiresAt: v.expiresAt ?? (now + (ttl ?? DEFAULT_TTL))
              }
              store[k] = meta
              await safeStorageSet(storage, k, meta)
            }
            // Delete local items not present in remote
            for (const k of Object.keys(store)) {
              if (options?.prefix && !k.startsWith(options.prefix)) continue
              if (!remoteKeys.includes(k)) {
                delete store[k]
                await safeStorageRemove(storage, k)
              }
            }
          }
          return remote
        } catch (err: any) {
          if (!isConnectionError(err)) throw err
          isOnline = false
          fireLocalEvent('disconnect', {})
          setTimeout(tryReconnect, delay)
          // fallback to local below
        }
      }

      // Offline: queue for later sync
      isOnline = false
      const items: any = {}
      for (const k of Object.keys(store)) {
        if (options?.prefix && !k.startsWith(options.prefix)) continue
        if (!isExpired(store[k])) items[k] = store[k]
      }
      return items
    },

    async setItems (items: Record<string, { value: any, ttl?: number, ifAbsent?: boolean, updatedAt?: number }>) {
      if (isOnline && nls) {
        try {
          const remote = await nls.setItems(items)
          // Cache remote values locally
          if (remote) {
            for (const [k, meta] of Object.entries(remote)) {
              const now = Date.now()
              const localMeta = {
                value: items[k]?.value,
                createdAt: meta.createdAt ?? now,
                updatedAt: meta.updatedAt ?? now,
                expiresAt: meta.expiresAt ?? (now + (ttl ?? DEFAULT_TTL))
              }
              store[k] = localMeta
              await safeStorageSet(storage, k, localMeta)
            }
          }
          return remote
        } catch (err: any) {
          if (!isConnectionError(err)) throw err
          isOnline = false
          fireLocalEvent('disconnect', {})
          setTimeout(tryReconnect, delay)
        }
      }

      // Offline: set each item individually
      isOnline = false
      const result: any = {}
      for (const k of Object.keys(items)) {
        result[k] = await wrapper.setItem(k, items[k].value, { ttl: items[k].ttl, ifAbsent: items[k].ifAbsent })
      }
      return result
    },

    async getItems (keys: string[]) {
      if (isOnline && nls) {
        try {
          const remote = await nls.getItems(keys)
          // Cache remote values locally
          if (remote) {
            for (const [k, v] of Object.entries(remote)) {
              const now = Date.now()
              const meta = {
                value: v.value ?? v,
                createdAt: v.createdAt ?? now,
                updatedAt: v.updatedAt ?? now,
                expiresAt: v.expiresAt ?? (now + (ttl ?? DEFAULT_TTL))
              }
              store[k] = meta
              await safeStorageSet(storage, k, meta)
            }
          }
          return remote
        } catch (err: any) {
          if (!isConnectionError(err)) throw err
          isOnline = false
          fireLocalEvent('disconnect', {})
          setTimeout(tryReconnect, delay)
        }
      }

      // Offline: return local items
      isOnline = false
      const result: any = {}
      for (const k of keys) {
        const meta = store[k]
        if (meta && !isExpired(meta)) result[k] = meta
      }
      return result
    },

    async getAllKeys (options?: { prefix?: string }) {
      if (isOnline && nls) {
        try {
          return await nls.getAllKeys(options)
        } catch (err: any) {
          if (!isConnectionError(err)) throw err
          isOnline = false
          fireLocalEvent('disconnect', {})
          setTimeout(tryReconnect, delay)
        }
      }

      // Offline: filter local keys
      isOnline = false
      return Object.keys(store).filter(k => !isExpired(store[k]) && (!options?.prefix || k.startsWith(options.prefix)))
    },

    async removeItems (keys: string[]) {
      for (const k of keys) {
        delete store[k]
        await safeStorageRemove(storage, k)
      }

      if (isOnline && nls) {
        try {
          return await nls.removeItems(keys)
        } catch (err: any) {
          if (!isConnectionError(err)) throw err
          isOnline = false
          fireLocalEvent('disconnect', {})
          setTimeout(tryReconnect, delay)
        }
      }

      // Offline: remove each item individually
      isOnline = false
      for (const k of keys) {
        await wrapper.removeItem(k)
      }
    },

    async clear () {
      const keys = Object.keys(store)
      for (const k of keys) {
        delete store[k]
        await safeStorageRemove(storage, k)
      }
      if (isOnline && nls) {
        try {
          return await nls.clear()
        } catch (err: any) {
          if (!isConnectionError(err)) throw err
          isOnline = false
          fireLocalEvent('disconnect', {})
          setTimeout(tryReconnect, delay)
        }
      }

      // Offline: remove all local items
      isOnline = false
      for (const k of keys) {
        await wrapper.removeItem(k)
      }
    },

    async incrementItem (key: string, value: number = 1, options?: { ttl?: number, updatedAt?: number }) {
      if (isOnline && nls) {
        try {
          const remote = await nls.incrementItem(key, value, options)
          // Cache remote value locally
          if (remote) {
            store[key] = remote
            await safeStorageSet(storage, key, remote)
          }
          return remote
        } catch (err: any) {
          if (!isConnectionError(err)) throw err
          isOnline = false
          fireLocalEvent('disconnect', {})
          setTimeout(tryReconnect, delay)
        }
      }

      // Offline: emulate increment locally
      isOnline = false
      const meta = store[key]
      let newValue = value
      if (meta && !isExpired(meta) && typeof meta.value === 'number') {
        newValue = meta.value + value
      }
      return wrapper.setItem(key, newValue, options)
    },

    async decrementItem (key: string, value: number = 1, options?: { ttl?: number, updatedAt?: number }) {
      if (isOnline && nls) {
        try {
          const remote = await nls.decrementItem(key, value, options)
          // Cache remote value locally
          if (remote) {
            store[key] = remote
            await safeStorageSet(storage, key, remote)
          }
          return remote
        } catch (err: any) {
          if (!isConnectionError(err)) throw err
          isOnline = false
          fireLocalEvent('disconnect', {})
          setTimeout(tryReconnect, delay)
        }
      }

      // Offline: emulate decrement locally
      isOnline = false
      const meta = store[key]
      let newValue = -value
      if (meta && !isExpired(meta) && typeof meta.value === 'number') {
        newValue = meta.value - value
      }
      return await wrapper.setItem(key, newValue, options)
    },

    async push (key: string, element: any, options?: { ttl?: number, updatedAt?: number }) {
      if (isOnline && nls) {
        try {
          const remote = await nls.push(key, element, options)
          if (remote) {
            store[key] = remote
            await safeStorageSet(storage, key, remote)
          }
          return remote
        } catch (err: any) {
          if (!isConnectionError(err)) throw err
          isOnline = false
          fireLocalEvent('disconnect', {})
          setTimeout(tryReconnect, delay)
        }
      }

      // Offline: emulate push locally
      isOnline = false
      const meta = store[key]
      let arr: any[] = []
      if (meta && !isExpired(meta) && Array.isArray(meta.value)) {
        arr = [...meta.value]
      }
      arr.push(element)
      return await wrapper.setItem(key, arr, options)
    },

    async splice (
      key: string,
      startIndex: number,
      deleteCount: number,
      items?: any[],
      options?: { ttl?: number, updatedAt?: number }
    ) {
      if (isOnline && nls) {
        try {
          const remote = await nls.splice(key, startIndex, deleteCount, items, options)
          if (remote) {
            store[key] = remote
            await safeStorageSet(storage, key, remote)
          }
          return remote
        } catch (err: any) {
          if (!isConnectionError(err)) throw err
          isOnline = false
          fireLocalEvent('disconnect', {})
          setTimeout(tryReconnect, delay)
        }
      }

      // Offline: emulate splice locally
      isOnline = false
      const meta = store[key]
      let arr: any[] = []
      if (meta && !isExpired(meta) && Array.isArray(meta.value)) {
        arr = [...meta.value]
      }
      // Normalize startIndex similar to Array.prototype.splice behavior
      const len = arr.length
      let start = startIndex
      if (start < 0) start = Math.max(len + start, 0)
      if (start > len) start = len
      arr.splice(start, deleteCount, ...(items ?? []))
      return await wrapper.setItem(key, arr, options)
    },

    async merge (key: string, objectToMerge: any, options?: { ttl?: number, updatedAt?: number }) {
      if (isOnline && nls) {
        try {
          const remote = await nls.merge(key, objectToMerge, options)
          if (remote) {
            store[key] = remote
            await safeStorageSet(storage, key, remote)
          }
          return remote
        } catch (err: any) {
          if (!isConnectionError(err)) throw err
          isOnline = false
          fireLocalEvent('disconnect', {})
          setTimeout(tryReconnect, delay)
        }
      }

      // Offline: emulate merge locally (shallow merge)
      isOnline = false
      const meta = store[key]
      const base = (meta && !isExpired(meta) && typeof meta.value === 'object' && meta.value !== null) ? { ...meta.value } : {}
      const merged = { ...base, ...(objectToMerge || {}) }
      return await wrapper.setItem(key, merged, options)
    },

    async setIn (key: string, path: string | string[], value: any, options?: { ttl?: number, updatedAt?: number }) {
      if (isOnline && nls) {
        try {
          const remote = await nls.setIn(key, path, value, options)
          if (remote) {
            store[key] = remote
            await safeStorageSet(storage, key, remote)
          }
          return remote
        } catch (err: any) {
          if (!isConnectionError(err)) throw err
          isOnline = false
          fireLocalEvent('disconnect', {})
          setTimeout(tryReconnect, delay)
        }
      }

      // Offline: emulate setIn locally
      isOnline = false
      const meta = store[key]
      const currentValue = (meta && !isExpired(meta) && typeof meta.value === 'object' && meta.value !== null) ? JSON.parse(JSON.stringify(meta.value)) : {}
      const pathArr = Array.isArray(path) ? path : (typeof path === 'string' ? path.split('.').filter(Boolean) : [])
      // helper to set nested value
      const setAtPath = (obj: any, keys: string[], val: any) => {
        if (keys.length === 0) return val
        const [first, ...rest] = keys
        if (rest.length === 0) {
          obj[first] = val
          return
        }
        if (typeof obj[first] !== 'object' || obj[first] === null) obj[first] = {}
        setAtPath(obj[first], rest, val)
      }
      setAtPath(currentValue, pathArr, value)
      return await wrapper.setItem(key, currentValue, options)
    },

    on: (event: string, ...args: any[]) => {
      let handler: Function
      let name: string | undefined
      if (typeof args[0] === 'string' && args.length === 2) {
        name = args[0]
        handler = args[1]
      } else {
        handler = args[0]
      }
      const key = name ? `${event}:${name}` : event
      if (!listeners[key]) listeners[key] = new Set()
      listeners[key].add(handler)
      if (isOnline && REMOTE_EVENTS.includes(event)/* && listeners[key].size === 1 */) {
        attachRemoteListener(event, name)
      }
    },

    off: (event: string, ...args: any[]) => {
      let handler: Function
      let name: string | undefined
      if (typeof args[0] === 'string' && args.length === 2) {
        name = args[0]
        handler = args[1]
      } else {
        handler = args[0]
      }
      const key = name ? `${event}:${name}` : event
      if (listeners[key]) {
        listeners[key].delete(handler)
        // Detach remote listener if there are no more listeners for this event
        if (isOnline && REMOTE_EVENTS.includes(event) && listeners[key].size === 0) {
          detachRemoteListener(event, name)
        }
        // If there are no listeners for any remote event, detach all remote listeners
        const hasAnyRemoteListener = Object.keys(listeners).some(k => listeners[k]?.size > 0)
        if (!hasAnyRemoteListener) {
          detachAllRemoteListeners()
        }
      }
    },

    async send (msg: any, options: { transport?: 'ws' | 'http', auth?: { userIdSignature?: string; identityToken?: string; } } = { transport: 'ws' }) {
      if (isOnline && nls && typeof nls.send === 'function') {
        return await nls.send(msg, options)
      }

      isOnline = false
      throw new Error('Vaultrice: .send() is not available while offline. It will be available upon reconnection.')
    },

    async join (data: any, auth?: { userIdSignature?: string; identityToken?: string }) {
      if (isOnline && nls && typeof nls.join === 'function') {
        return await nls.join(data, auth)
      }

      isOnline = false
      throw new Error('Vaultrice: .join() is not available while offline. It will be available upon reconnection.')
    },

    async leave () {
      if (isOnline && nls && typeof nls.leave === 'function') {
        return await nls.leave()
      }

      isOnline = false
      throw new Error('Vaultrice: .leave() is not available while offline. It will be available upon reconnection.')
    },

    async getJoinedConnections () {
      if (isOnline && nls && typeof nls.getJoinedConnections === 'function') {
        const result = await nls.getJoinedConnections()
        lastJoinedConnections = result
        return result
      }

      // Offline: return last known result
      isOnline = false
      return lastJoinedConnections
    },

    get isConnected () {
      return isOnline
    },

    get connectionId () {
      return nls?.connectionId
    },

    id
  }

  const sweepTimer = startSweep(store, storage, outbox, options.expirationSweepInterval, fireLocalEvent, logger)
  const originalDisconnect = wrapper.disconnect
  wrapper.disconnect = async () => {
    try { await originalDisconnect?.() } catch (_) {}
    stopSweep(sweepTimer)
    await safeStorageSet(storage, '_outbox', outbox)
  }

  return wrapper as NonLocalStorage
}
