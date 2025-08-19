import {
  OfflineSyncOptions,
  StorageAdapter,
  ItemType,
  ItemsType,
  OfflineSyncOptionsExtra
} from './types'
import LocalStorageAdapter from './LocalStorageAdapter'
import { Logger } from './logger'

type OfflineSyncStorageOption = OfflineSyncOptions['storage']

/**
 * Gets a storage adapter instance based on the provided options and creation method.
 * @param storageOptions - Options for storage adapter creation.
 * @param storageCreation - Storage adapter class, factory, or instance.
 * @returns The storage adapter instance.
 * @throws If the storage option interface is invalid.
 * @internal
 */
export function getStorage (
  storageOptions: { projectId: string, class: string, id: string, ttl: number },
  storageCreation: OfflineSyncStorageOption
): StorageAdapter {
  let storage: StorageAdapter | undefined
  if (storageCreation) {
    if (typeof storageCreation === 'function') {
      const isClass = storageCreation.prototype && storageCreation.prototype.constructor === storageCreation
      storage = isClass
        ? new (storageCreation as new (options: any) => StorageAdapter)(storageOptions)
        : (storageCreation as (options: any) => StorageAdapter)(storageOptions)
    } else {
      storage = storageCreation as StorageAdapter
    }
  } else {
    storage = new LocalStorageAdapter(storageOptions)
  }
  if (!storage) throw new Error('Wrong storageOption interface!')
  return storage
}

/**
 * Represents an operation to be performed on the outbox.
 * @internal
 */
export type OutboxOp =
  | { op: 'set'; prop: string; value: any }
  | { op: 'remove'; prop: string }

/**
 * Default time-to-live for items (1 hour).
 * @internal
 */
export const DEFAULT_TTL = 1 * 60 * 60 * 1000 // 1h

/**
 * Default interval for sweeping expired items (15 minutes).
 * @internal
 */
export const DEFAULT_EXPIRATION_SWEEP_INTERVAL = 15 * 60 * 1000 // 15min

/**
 * Checks if a metadata object is expired.
 * @param meta - The metadata object to check.
 * @returns True if expired, false otherwise.
 * @internal
 */
export function isExpired (meta: any): boolean {
  return meta && typeof meta.expiresAt === 'number' && Date.now() >= meta.expiresAt
}

/**
 * Safely removes a key from the storage adapter.
 * Ignores errors.
 * @param storage - The storage adapter.
 * @param key - The key to remove.
 * @internal
 */
export async function safeStorageRemove (storage: StorageAdapter, key: string): Promise<void> {
  try { await storage.remove(key) } catch (e) { /* ignore */ }
}

/**
 * Safely sets a key-value pair in the storage adapter.
 * Ignores errors.
 * @param storage - The storage adapter.
 * @param key - The key to set.
 * @param value - The value to set.
 * @internal
 */
export async function safeStorageSet (storage: StorageAdapter, key: string, value: any): Promise<void> {
  try { await storage.set(key, value) } catch (e) { /* ignore */ }
}

/**
 * Determines if an error is a connection error.
 * @param err - The error object.
 * @returns True if the error is a connection error, false otherwise.
 */
export function isConnectionError (err: any): boolean {
  return (err?.code === 'ECONNREFUSED') ||
        (err?.code === 'UND_ERR_SOCKET') ||
        (err?.code === 'ECONNRESET') ||
        (err?.message?.includes?.('fetch failed')) ||
        (err?.cause?.code === 'ECONNREFUSED') ||
        (err?.cause?.code === 'UND_ERR_SOCKET') ||
        (err?.cause?.code === 'ECONNRESET') ||
        (err?.cause?.message?.includes?.('fetch failed'))
}

function deduplicateOutbox (outbox: OutboxOp[]): OutboxOp[] {
  const latestOps: Record<string, OutboxOp> = {}
  for (const op of outbox) {
    latestOps[op.prop] = op
  }
  return Object.values(latestOps)
}

/**
 * Processes the outbox operations, synchronizing local changes to remote.
 * Handles conflict resolution and updates remote items.
 * @param options - Extra offline sync options.
 * @param storage - The storage adapter.
 * @param outbox - Array of outbox operations.
 * @param remoteItems - Remote items to synchronize.
 * @param update - Update handlers for set/remove.
 * @param logger - Logger instance.
 */
export async function processOutbox (
  options: OfflineSyncOptionsExtra,
  storage: StorageAdapter,
  outbox: OutboxOp[] = [],
  remoteItems: ItemsType = {},
  update: { set: (prop: string, item: ItemType) => Promise<any>, remove: (prop: string) => Promise<any> },
  logger: Logger
): Promise<void> {
  const dedupedOutbox = deduplicateOutbox(outbox)
  while (dedupedOutbox.length > 0) {
    const op = dedupedOutbox[0]
    try {
      if (op.op === 'set') {
        const localItem = op.value
        if (isExpired(localItem)) {
          logger.log('info', `Skipping expired item during outbox sync: ${op.prop}`)
          dedupedOutbox.shift()
          continue
        }
        const remoteItem = remoteItems[op.prop]
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
        remoteItems[op.prop] = resolved
        await update.set(op.prop, resolved)
      } else if (op.op === 'remove') {
        logger.log('info', `Removing "${op.prop}" from remote during outbox sync`)
        delete remoteItems[op.prop]
        await update.remove(op.prop)
      }
      dedupedOutbox.shift()
    } catch (e: any) {
      logger.log('error', `Failed to sync operation, will retry on next connection (${e.message || e.code || e.name}):\n${JSON.stringify(op, null, 2)}`)
      break
    }
  }
  await safeStorageSet(storage, '_outbox', dedupedOutbox)
}

/**
 * Handles post-processing after outbox sync.
 * Cleans up expired items, resolves conflicts, and updates local/remote stores.
 * @param options - Extra offline sync options.
 * @param storage - The storage adapter.
 * @param store - Local store of items.
 * @param remoteItems - Remote items to synchronize.
 * @param update - Update handlers for set/remove.
 * @param fireLocalEvent - Function to fire local events.
 * @param logger - Logger instance.
 */
export async function afterProcessOutbox (
  options: OfflineSyncOptionsExtra,
  storage: StorageAdapter,
  store: Record<string, any>,
  remoteItems: ItemsType = {},
  update: { set: (prop: string, item: ItemType) => Promise<any>, remove: (prop: string) => Promise<any> },
  fireLocalEvent: (event: string, payload: any) => void,
  logger: Logger
): Promise<void> {
  if (!remoteItems) return

  // const cleanupExpiredRemote = !!options.cleanupExpiredRemote
  for (const k of Object.keys(remoteItems)) {
    const localItem = store[k]
    const remoteItem = remoteItems[k]
    const localExpired = isExpired(localItem)
    const remoteExpired = isExpired(remoteItem)
    if (localExpired) {
      logger.log('info', `Item expired and removed locally during sync: ${k}`)
      delete store[k]
      await safeStorageRemove(storage, k)
      fireLocalEvent('removeItem', { prop: k })
    }
    if (remoteExpired) {
      // if (cleanupExpiredRemote) {
      //   logger.log('info', `Item expired and removed remotely during sync: ${k}`)
      //   await update.remove(k)
      //   fireLocalEvent('removeItem', { prop: k })
      // }
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
      await update.set(k, resolved)
    }
  }
}

export function startSweep (store: Record<string, any>, storage: StorageAdapter, outbox: OutboxOp[], intervalMs: number = DEFAULT_EXPIRATION_SWEEP_INTERVAL, fireLocalEvent: (event: string, payload: any) => void, logger: Logger): ReturnType<typeof setInterval> | null {
  const sweepTimer = setInterval(async () => {
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
  return sweepTimer
}

export function stopSweep (sweepTimer: ReturnType<typeof setInterval> | null) {
  if (sweepTimer) {
    clearInterval(sweepTimer)
    sweepTimer = null
  }
}
