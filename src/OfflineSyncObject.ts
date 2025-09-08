import {
  OfflineSyncOptions,
  SyncObjectMeta,
  LogLevel,
  ItemType,
  Credentials
} from './types'
import { DEFAULT_DURABLE_CACHE_CLASS, getId } from './Base'
import createSyncObject, { reservedProps } from './SyncObject'
import NonLocalStorage from './NonLocalStorage'
import getLogger from './logger'
import { getStorage, DEFAULT_TTL, OutboxOp, isExpired, safeStorageRemove, safeStorageSet, isConnectionError, processOutbox, afterProcessOutbox, startSweep, stopSweep } from './offlineHelpers'

/**
 * Creates an offline-capable sync object that transparently synchronizes with a remote sync object when online.
 * Handles local persistence, expiration, conflict resolution, and event bridging.
 *
 * @param credentials - API credentials and project information.
 * @param idOrOptions - Either an ID string or an OfflineSyncOptions object.
 * @returns A proxy object implementing both local and remote sync behaviors.
 */
export default async function createOfflineSyncObject<T extends object> (
  credentials: Credentials,
  idOrOptions?: string | OfflineSyncOptions
): Promise<T & SyncObjectMeta> {
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
  const outbox: OutboxOp[] = (await storage.get('_outbox')) || []
  let syncObject: T & SyncObjectMeta | undefined
  let isOnline = false
  let connectedAtStart = false

  try {
    syncObject = await createSyncObject<T>(credentials, options)
    isOnline = true
    connectedAtStart = true
  } catch (err: any) {
    if (!isConnectionError(err)) throw err
    isOnline = false
    syncObject = undefined
  }

  const localListeners: Record<string, any[]> = {}
  function addLocalListener (event: string, nameOrHandler: any, maybeHandler?: any) {
    if (typeof nameOrHandler === 'function') {
      localListeners[event] = localListeners[event] || []
      localListeners[event].push(nameOrHandler)
    } else if (typeof maybeHandler === 'function') {
      maybeHandler._name = nameOrHandler
      localListeners[event] = localListeners[event] || []
      localListeners[event].push(maybeHandler)
    }
  }
  function removeLocalListener (event: string, fn: any) {
    if (localListeners[event]) {
      localListeners[event] = localListeners[event].filter(f => f !== fn)
    }
  }
  function fireLocalEvent (event: string, ...args: any[]) {
    (localListeners[event] || []).forEach(fn => {
      if (fn._name !== undefined) {
        if (args[0]?.prop === fn._name) fn(...args)
      } else {
        fn(...args)
      }
    })
  }

  const accessTokenExpiringListeners: any[] = []
  function addAccessTokenExpiringListener (fn: any) {
    accessTokenExpiringListeners.push(fn)
  }
  function removeAccessTokenExpiringListener (fn: any) {
    const idx = accessTokenExpiringListeners.indexOf(fn)
    if (idx !== -1) accessTokenExpiringListeners.splice(idx, 1)
  }

  function createOfflineBase (): SyncObjectMeta {
    const base: any = {}
    for (const prop of reservedProps) {
      if (prop.startsWith('__')) continue
      if (prop === 'on') base.on = addLocalListener
      else if (prop === 'off') base.off = removeLocalListener
      else if (prop === 'join') base.join = async () => { throw new Error('Vaultrice: .join() is not available while offline. It will be available upon reconnection.') }
      else if (prop === 'leave') base.leave = async () => { throw new Error('Vaultrice: .leave() is not available while offline. It will be available upon reconnection.') }
      else if (prop === 'send') base.send = async () => { throw new Error('Vaultrice: .send() is not available while offline. It will be available upon reconnection.') }
      else if (prop === 'joinedConnections') {
        // Return last known joinedConnections from syncObject if available
        Object.defineProperty(base, 'joinedConnections', {
          get: () => syncObject ? syncObject.joinedConnections : [],
          enumerable: true,
          configurable: true
        })
      } else if (prop === 'connectionId') {
        Object.defineProperty(base, 'connectionId', {
          get: () => syncObject ? syncObject.connectionId : undefined,
          enumerable: true,
          configurable: true
        })
      } else if (prop === 'useAccessToken') base.useAccessToken = () => { }
      else if (prop === 'onAccessTokenExpiring') base.onAccessTokenExpiring = addAccessTokenExpiringListener
      else if (prop === 'offAccessTokenExpiring') base.offAccessTokenExpiring = removeAccessTokenExpiringListener
      else if (prop === 'connect') base.connect = async () => { }
      else if (prop === 'disconnect') base.disconnect = async () => { isOnline = false }
      else if (prop === 'isConnected') Object.defineProperty(base, 'isConnected', { get: () => isOnline, enumerable: true, configurable: true })
      else if (prop === 'id') base.id = id
      else base[prop] = undefined
    }
    return base
  }

  function transferListenersToOnline () {
    Object.entries(localListeners).forEach(([event, fns]) => {
      fns.forEach(fn => {
        if (typeof fn._name !== 'undefined') {
          syncObject?.on(event, fn._name, fn)
        } else {
          syncObject?.on(event, fn)
        }
      })
    })
    accessTokenExpiringListeners.forEach(fn => syncObject?.onAccessTokenExpiring(fn))
  }

  const handleConnect = async () => {
    if (!syncObject) return
    const nls = (syncObject as any).__getNonLocalStorage?.() as NonLocalStorage | undefined
    const internalSyncObjectStore = (syncObject as any).__getInternalMemoryStore?.() as Partial<T> | {}
    const remoteItems = nls ? await nls.getAllItems() : undefined
    const updateHandlers = {
      set: async (prop: string, item: ItemType) => {
        if (internalSyncObjectStore) {
          ;(internalSyncObjectStore as any)[prop] = { value: item.value, expiresAt: item?.expiresAt }
        }
        if (!nls) return
        const now = Date.now()
        return nls.setItem(prop, item.value, { ttl: item.expiresAt > now ? item.expiresAt - Date.now() : undefined })
      },
      remove: async (prop: string) => {
        if (internalSyncObjectStore) {
          delete (internalSyncObjectStore as any)[prop]
        }
        if (!nls) return
        return nls.removeItem(prop)
      }
    }
    await processOutbox(options, storage, outbox, remoteItems || {}, updateHandlers, logger)
    await afterProcessOutbox(options, storage, store, remoteItems, updateHandlers, fireLocalEvent, logger)
  }

  let lastAttachedSyncObject: T & SyncObjectMeta | undefined

  function detachSyncListeners (so: T & SyncObjectMeta | undefined) {
    if (!so) return
    so.off('connect', handleSyncConnect)
    so.off('disconnect', handleSyncDisconnect)
    so.off('setItem', handleSyncSetItem)
    so.off('removeItem', handleSyncRemoveItem)
  }

  function attachSyncListeners (so: T & SyncObjectMeta) {
    detachSyncListeners(lastAttachedSyncObject) // <-- Detach from previous!
    so.on('connect', handleSyncConnect)
    so.on('disconnect', handleSyncDisconnect)
    so.on('setItem', handleSyncSetItem)
    so.on('removeItem', handleSyncRemoveItem)
    lastAttachedSyncObject = so
  }

  const handleSyncConnect = async () => {
    isOnline = true
    if (connectedAtStart) fireLocalEvent('connect')
    await handleConnect()
  }
  const handleSyncDisconnect = () => {
    if (connectedAtStart) fireLocalEvent('disconnect')
    isOnline = false
  }
  const handleSyncSetItem = (item: any) => {
    store[item.prop] = item
    safeStorageSet(storage, item.prop, item)
  }
  const handleSyncRemoveItem = (item: any) => {
    delete store[item.prop]
    safeStorageRemove(storage, item.prop)
  }

  const reconnectBaseDelay = options.connectionSettings?.reconnectBaseDelay ?? 1000
  const reconnectMaxDelay = options.connectionSettings?.reconnectMaxDelay ?? 30000
  let reconnectAttempts = 0
  let delay = reconnectBaseDelay
  const tryReconnect = async () => {
    reconnectAttempts++
    delay = Math.min(
      reconnectBaseDelay * Math.pow(2, reconnectAttempts),
      reconnectMaxDelay
    )
    try {
      const newSyncObject = await createSyncObject<T>(credentials, options)
      isOnline = true
      syncObject = newSyncObject
      transferListenersToOnline()
      attachSyncListeners(syncObject)
      fireLocalEvent('connect')
      if (syncObject.isConnected) {
        reconnectAttempts = 0
        logger.log('info', `Back online, ${outbox.length > 0 ? `synchronize ${outbox.length} item changes` : 'nothing to synchronize'}.`)
        await handleConnect()
      }
    } catch {
      setTimeout(() => tryReconnect().catch(() => {}), delay)
    }
  }
  if (!isOnline) {
    setTimeout(() => tryReconnect().catch(() => {}), delay)
  } else if (syncObject) {
    attachSyncListeners(syncObject)
    if (syncObject.isConnected) {
      await handleConnect()
    }
  }

  const proxyTarget: any = createOfflineBase()
  Object.defineProperty(proxyTarget, 'isConnected', {
    get: () => {
      if (syncObject) return syncObject.isConnected
      return isOnline
    },
    enumerable: true,
    configurable: true
  })

  const handler: ProxyHandler<T & SyncObjectMeta> = {
    get (_, prop: string | symbol, receiver) {
      if (prop === 'on') return proxyTarget.on
      if (prop === 'off') return proxyTarget.off
      if (prop === 'isConnected') return isOnline
      if (prop === 'connectionId') {
        if (isOnline && syncObject) {
          return syncObject.connectionId
        }
        return undefined
      }
      if (reservedProps.includes(prop as string)) {
        if (isOnline && syncObject) {
          return Reflect.get(syncObject, prop, receiver)
        }
        return Reflect.get(proxyTarget, prop, receiver)
      }
      if (isOnline && syncObject) {
        // Use Reflect.get to respect the syncObject's own behaviour (and proxies)
        const item = Reflect.get(syncObject as any, prop, receiver)
        if (!item) return undefined
        if (isExpired(item)) {
          // if (options.cleanupExpiredRemote) {
          //   // mark for removal on the server and notify local listeners (handled via events)
          //   try { (syncObject as any)[prop] = undefined } catch (_) {}
          // }
          return undefined
        }
        // Return the full meta object (contains { value, createdAt, updatedAt, expiresAt })
        return item
      }
      const meta = store[prop as string]
      if (!meta) return undefined
      if (isExpired(meta)) {
        delete store[prop as string]
        safeStorageRemove(storage, prop as string).catch(() => {})
        // Fire removeItem event for local listeners
        fireLocalEvent('removeItem', { prop })
        return undefined
      }
      return meta.value
    },
    set (_, prop: string, value, receiver) {
      let payload = value
      let ttlMs: number | undefined
      if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value') && (Object.prototype.hasOwnProperty.call(value, 'ttl') || Object.prototype.hasOwnProperty.call(value, 'expiresAt'))) {
        payload = value.value
        if (typeof value.ttl === 'number') ttlMs = value.ttl
        if (typeof value.expiresAt === 'number') ttlMs = value.expiresAt - Date.now()
      }
      if (isOnline && syncObject) {
        if (typeof ttlMs === 'number') {
          const now = Date.now()
          const meta = {
            value: payload,
            createdAt: store[prop]?.createdAt ?? now,
            updatedAt: now,
            expiresAt: now + ttlMs
          }
          ;(syncObject as any)[prop] = meta
        } else {
          ;(syncObject as any)[prop] = payload
        }
      } else {
        const now = Date.now()
        const effectiveTtl = typeof ttlMs === 'number' ? ttlMs : (options.ttl ?? DEFAULT_TTL)
        const meta = {
          value: payload,
          createdAt: store[prop]?.createdAt ?? now,
          updatedAt: now,
          expiresAt: typeof effectiveTtl === 'number' ? (now + effectiveTtl) : undefined
        }
        store[prop] = meta
        safeStorageSet(storage, prop, meta)
        outbox.push({ op: 'set', prop, value: meta })
        safeStorageSet(storage, '_outbox', outbox)
        // Fire local setItem event for offline updates
        fireLocalEvent('setItem', { prop, ...meta })
      }
      return true
    },
    deleteProperty (_, prop: string) {
      if (isOnline && syncObject) {
        ;(syncObject as any)[prop] = undefined
      } else {
        delete store[prop]
        safeStorageRemove(storage, prop)
        outbox.push({ op: 'remove', prop })
        safeStorageSet(storage, '_outbox', outbox)
        // Fire local removeItem event for offline deletes
        fireLocalEvent('removeItem', { prop })
      }
      return true
    },
    has (_, prop: string | symbol) {
      if (reservedProps.includes(prop as string)) return true
      const meta = store[prop as string]
      if (!meta) return false
      if (isExpired(meta)) return false
      return true
    },
    ownKeys (_) {
      const baseKeys = Reflect.ownKeys(proxyTarget)
      const storeKeys = Object.keys(store).filter(k => {
        const meta = store[k]
        return meta && !isExpired(meta)
      })
      const syncObjectKeys = syncObject
        ? Reflect.ownKeys(syncObject).filter(k => {
          const item = (syncObject as any)[k]
          return item && !isExpired(item)
        })
        : []
      return Array.from(new Set([...baseKeys, ...storeKeys, ...syncObjectKeys]))
    },
    getOwnPropertyDescriptor (_, prop: string | symbol) {
      if (reservedProps.includes(prop as string)) {
        return Reflect.getOwnPropertyDescriptor(proxyTarget, prop)
      }
      const meta = store[prop as string]
      if (!meta || isExpired(meta)) return undefined
      return {
        configurable: true,
        enumerable: true,
        writable: true,
        value: meta.value
      }
    }
  }

  const sweepTimer = startSweep(store, storage, outbox, options.expirationSweepInterval, fireLocalEvent, logger)
  const originalDisconnect = proxyTarget.disconnect
  proxyTarget.disconnect = async () => {
    try { await originalDisconnect?.() } catch (_) {}
    stopSweep(sweepTimer)
    await safeStorageSet(storage, '_outbox', outbox)
  }

  return new Proxy(proxyTarget, handler) as T & SyncObjectMeta
}
