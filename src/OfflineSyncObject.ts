import {
  OfflineSyncOptions,
  SyncObjectMeta,
  StorageAdapter,
  LogLevel
} from './types'
import { LocalStorageAdapter } from './LocalStorageAdapter'
import { DEFAULT_DURABLE_CACHE_CLASS, getId } from './Base'
import createSyncObject, { reservedProps } from './SyncObject'
import NonLocalStorage from './NonLocalStorage'
import getLogger, { Logger } from './logger'

/**
 * Represents an operation to be performed on the outbox.
 * @internal
 */
type OutboxOp =
  | { op: 'set'; prop: string; value: any }
  | { op: 'remove'; prop: string }

/** @internal */
const DEFAULT_TTL = 1 * 60 * 60 * 1000 // 1h
/** @internal */
const DEFAULT_EXPIRATION_SWEEP_INTERVAL = 15 * 60 * 1000 // 15min

/**
 * Checks if a metadata object is expired.
 * @param meta - The metadata object to check.
 * @returns True if expired, false otherwise.
 * @internal
 */
function isExpired (meta: any): boolean {
  return meta && typeof meta.expiresAt === 'number' && Date.now() >= meta.expiresAt
}

/**
 * Safely removes a key from the storage adapter.
 * @param storage - The storage adapter.
 * @param key - The key to remove.
 * @internal
 */
async function safeStorageRemove (storage: StorageAdapter, key: string): Promise<void> {
  try { await storage.remove(key) } catch (e) { /* ignore */ }
}

/**
 * Safely sets a key-value pair in the storage adapter.
 * @param storage - The storage adapter.
 * @param key - The key to set.
 * @param value - The value to set.
 * @internal
 */
async function safeStorageSet (storage: StorageAdapter, key: string, value: any): Promise<void> {
  try { await storage.set(key, value) } catch (e) { /* ignore */ }
}

/**
 * Processes the outbox queue, synchronizing changes with the remote sync object.
 * Handles conflict resolution, expiration, and error logging.
 * @param syncObject - The remote sync object.
 * @param options - Offline sync options.
 * @param storage - The storage adapter.
 * @param outbox - The outbox queue.
 * @param logger - Logger instance.
 * @internal
 */
async function processOutbox (
  syncObject: SyncObjectMeta,
  options: OfflineSyncOptions,
  storage: StorageAdapter,
  outbox: OutboxOp[],
  logger: Logger
): Promise<void> {
  while (outbox.length > 0) {
    const op = outbox[0]
    try {
      if (op.op === 'set') {
        const localItem = op.value
        if (isExpired(localItem)) {
          logger.log('info', `Skipping expired item during outbox sync: ${op.prop}`)
          outbox.shift()
          continue
        }
        const remoteItem = (syncObject as any)[op.prop]
        let resolved = localItem
        if (remoteItem) {
          if (options.resolveConflict && JSON.stringify(localItem?.value) !== JSON.stringify(remoteItem?.value)) {
            logger.log('info', `Conflict detected for "${op.prop}", resolving...`)
            resolved = options.resolveConflict(localItem, remoteItem)
          } else {
            logger.log('info', `Comparing timestamps for "${op.prop}" to resolve latest value`)
            resolved = (localItem.updatedAt ?? localItem.createdAt ?? 0) >
              (remoteItem.updatedAt ?? remoteItem.createdAt ?? 0)
              ? localItem
              : remoteItem
          }
        } else {
          logger.log('info', `No remote value for "${op.prop}", using local value`)
        }
        logger.log('info', `Synchronizing "${op.prop}" to remote`)
        ;(syncObject as any)[op.prop] = resolved
      } else if (op.op === 'remove') {
        logger.log('info', `Removing "${op.prop}" from remote during outbox sync`)
        ;(syncObject as any)[op.prop] = undefined
      }
      outbox.shift()
    } catch (e: any) {
      logger.log('error', `Failed to sync operation, will retry on next connection (${e.message || e.code || e.name}):\n${JSON.stringify(op, null, 2)}`)
      break
    }
  }
  await safeStorageSet(storage, '_outbox', outbox)
}

/**
 * Creates an offline-capable sync object that transparently synchronizes with a remote sync object when online.
 * Handles local persistence, expiration, conflict resolution, and event bridging.
 *
 * @param credentials - API credentials and project information.
 * @param idOrOptions - Either an ID string or an OfflineSyncOptions object.
 * @returns A proxy object implementing both local and remote sync behaviors.
 */
export default async function createOfflineSyncObject<T extends object> (
  credentials: { apiKey?: string, apiSecret?: string, accessToken?: string, projectId: string },
  idOrOptions?: string | OfflineSyncOptions
): Promise<T & SyncObjectMeta> {
  let options: OfflineSyncOptions
  let id: string | undefined
  let className: string | undefined
  let ttl: number | undefined
  let logLevel: LogLevel
  let reconnectDelay: number

  if (typeof idOrOptions === 'string') {
    id = idOrOptions
    className = DEFAULT_DURABLE_CACHE_CLASS
    ttl = DEFAULT_TTL
    options = { id }
    reconnectDelay = 5000
    logLevel = 'warn'
  } else {
    className = idOrOptions?.class || DEFAULT_DURABLE_CACHE_CLASS
    id = idOrOptions?.id || getId(credentials.projectId, className)
    ttl = idOrOptions?.ttl || DEFAULT_TTL
    options = { ...(idOrOptions || {}) }
    reconnectDelay = options.reconnectDelay ?? 5000
    logLevel = idOrOptions?.logLevel || 'warn'
  }

  const logger = getLogger(logLevel)
  const storageOptions = { projectId: credentials.projectId, class: className, id, ttl }
  let storage: StorageAdapter | undefined
  if (options.storage) {
    if (typeof options.storage === 'function') {
      const isClass = options.storage.prototype && options.storage.prototype.constructor === options.storage
      storage = isClass
        ? new (options.storage as new (options: any) => StorageAdapter)(storageOptions)
        : (options.storage as (options: any) => StorageAdapter)(storageOptions)
    } else {
      storage = options.storage as StorageAdapter
    }
  } else {
    storage = new LocalStorageAdapter(storageOptions)
  }
  if (!storage) throw new Error('Wrong options.storage interface!')

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
    const isConnectionError =
      (err?.code === 'ECONNREFUSED') ||
      (err?.code === 'UND_ERR_SOCKET') ||
      (err?.code === 'ECONNRESET') ||
      (err?.message?.includes?.('fetch failed')) ||
      (err?.cause?.code === 'ECONNREFUSED') ||
      (err?.cause?.code === 'UND_ERR_SOCKET') ||
      (err?.cause?.code === 'ECONNRESET') ||
      (err?.cause?.message?.includes?.('fetch failed'))
    if (!isConnectionError) throw err
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
    (localListeners[event] || []).forEach(fn => fn(...args))
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
      else if (prop === 'joinedConnections') base.joinedConnections = []
      else if (prop === 'useAccessToken') base.useAccessToken = () => { }
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

  let sweepTimer: ReturnType<typeof setInterval> | null = null
  function startSweep (store: Record<string, any>, storage: StorageAdapter, outbox: OutboxOp[], intervalMs: number) {
    if (sweepTimer) return
    sweepTimer = setInterval(async () => {
      try {
        let mutated = false
        for (const k of Object.keys(store)) {
          const meta = store[k]
          if (isExpired(meta)) {
            logger.log('info', `Item expired and removed locally: ${k}`)
            delete store[k]
            await safeStorageRemove(storage, k)
            // notify local listeners immediately about the removal
            try { fireLocalEvent('removeItem', { prop: k }) } catch (e) { /* ignore */ }
            mutated = true
          }
        }
        if (mutated) await safeStorageSet(storage, '_outbox', outbox)
      } catch (err: any) {
        logger.log('warn', `Expiration sweep error: ${err.message || err.code || err.name}`)
      }
    }, intervalMs)
  }
  function stopSweep () {
    if (sweepTimer) {
      clearInterval(sweepTimer)
      sweepTimer = null
    }
  }

  const handleConnect = async () => {
    if (!syncObject) return
    await processOutbox(syncObject, options, storage, outbox, logger)
    const nls = (syncObject as any).__getNonLocalStorage?.() as NonLocalStorage | undefined
    const remoteItems = nls ? await nls.getAllItems() : undefined
    if (remoteItems) {
      const cleanupExpiredRemote = !!options?.cleanupExpiredRemote
      for (const k of Object.keys(remoteItems)) {
        const localItem = store[k]
        const remoteItem = remoteItems[k]
        const localExpired = isExpired(localItem)
        const remoteExpired = isExpired(remoteItem)
        if (localExpired) {
          logger.log('info', `Item expired and removed locally during sync: ${k}`)
          delete store[k]
          await safeStorageRemove(storage, k)
          // notify local listeners that a local item expired and was removed
          try { fireLocalEvent('removeItem', { prop: k }) } catch (e) { /* ignore */ }
        }
        if (remoteExpired) {
          if (cleanupExpiredRemote) {
            logger.log('info', `Item expired and removed remotely during sync: ${k}`)
            ;(syncObject as any)[k] = undefined
            // also notify local listeners immediately (remote remove will likely be
            // handled by the sweep interval, but we do it here to be prompt)
            try { fireLocalEvent('removeItem', { prop: k }) } catch (e) { /* ignore */ }
          }
          await safeStorageRemove(storage, k)
          continue
        }
        if (!localExpired && !remoteExpired) {
          let resolved = remoteItem
          if (localItem && remoteItem) {
            if (options.resolveConflict && JSON.stringify(localItem.value) !== JSON.stringify(remoteItem.value)) {
              resolved = options.resolveConflict(localItem, remoteItem)
            } else {
              resolved = (localItem.updatedAt ?? localItem.createdAt ?? 0) > (remoteItem.updatedAt ?? remoteItem.createdAt ?? 0)
                ? localItem
                : remoteItem
            }
          } else if (localItem) {
            resolved = localItem
          }
          store[k] = resolved
          await safeStorageSet(storage, k, resolved)
          ;(syncObject as any)[k] = resolved
        }
      }
    }
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

  const tryReconnect = async () => {
    try {
      const newSyncObject = await createSyncObject<T>(credentials, options)
      isOnline = true
      syncObject = newSyncObject
      transferListenersToOnline()
      attachSyncListeners(syncObject)
      fireLocalEvent('connect')
      if (syncObject.isConnected) {
        logger.log('info', `Back online, ${outbox.length > 0 ? `synchronize ${outbox.length} item changes` : 'nothing to synchronize'}.`)
        await handleConnect()
      }
    } catch {
      setTimeout(() => tryReconnect().catch(() => {}), reconnectDelay)
    }
  }
  if (!isOnline) {
    setTimeout(() => tryReconnect().catch(() => {}), reconnectDelay)
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
          if (options.cleanupExpiredRemote) {
            // mark for removal on the server and notify local listeners (handled via events)
            try { (syncObject as any)[prop] = undefined } catch (_) {}
          }
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

  const sweepInterval = options.expirationSweepInterval ?? DEFAULT_EXPIRATION_SWEEP_INTERVAL
  startSweep(store, storage, outbox, sweepInterval)

  const originalDisconnect = proxyTarget.disconnect
  proxyTarget.disconnect = async () => {
    try { await originalDisconnect?.() } catch (_) {}
    stopSweep()
  }

  return new Proxy(proxyTarget, handler) as T & SyncObjectMeta
}
