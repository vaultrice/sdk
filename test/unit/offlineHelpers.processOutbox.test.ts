import { describe, it, expect, beforeEach } from 'vitest'
import { processOutbox, DEFAULT_TTL, OutboxOp } from '../../src/offlineHelpers'
import { OfflineSyncOptionsExtra, ItemType } from '../../src/types'

// Minimal in-memory "StorageAdapter" mock used by safeStorageSet in processOutbox
class InMemoryStorage {
  public store: Record<string, any> = {}
  async get (key: string) {
    return this.store[key]
  }

  async set (key: string, value: any) {
    this.store[key] = value
  }

  async remove (key: string) {
    delete this.store[key]
  }

  async getAll () {
    return { ...this.store }
  }
}

function makeMeta (value: any, opts?: { now?: number, ttlMs?: number }) {
  const now = opts?.now ?? Date.now()
  const ttl = opts?.ttlMs ?? DEFAULT_TTL
  return {
    value,
    createdAt: now,
    updatedAt: now,
    expiresAt: typeof ttl === 'number' ? now + ttl : undefined
  }
}

function makeExpiredMeta (value: any) {
  const now = Date.now()
  return {
    value,
    createdAt: now - 10000,
    updatedAt: now - 10000,
    expiresAt: now - 1000
  }
}

describe('processOutbox (network flakiness / partial failures)', () => {
  let storage: InMemoryStorage
  let logger: { logs: string[]; log: (level: string, msg: string) => void }

  beforeEach(() => {
    storage = new InMemoryStorage()
    logger = {
      logs: [],
      log (level: string, msg: string) {
        this.logs.push(`[${level}] ${msg}`)
      }
    }
  })

  it('processes all operations successfully and persists empty _outbox', async () => {
    const options = {} as OfflineSyncOptionsExtra
    const outbox: OutboxOp[] = [
      { op: 'set', prop: 'a', value: makeMeta('A') },
      { op: 'set', prop: 'b', value: makeMeta('B') },
      { op: 'remove', prop: 'c' }
    ]

    const remoteItems: Record<string, ItemType> = {}

    const updateCalls: { set: string[]; remove: string[] } = { set: [], remove: [] }
    const update = {
      set: async (prop: string, item: ItemType) => {
        updateCalls.set.push(prop)
        remoteItems[prop] = item
      },
      remove: async (prop: string) => {
        updateCalls.remove.push(prop)
        delete remoteItems[prop]
      }
    }

    await processOutbox(options, storage as any, outbox.slice(), remoteItems, update as any, logger as any)

    // All update handlers were called in order (but deduplication may change order of same-prop ops)
    expect(updateCalls.set).toEqual(['a', 'b'])
    expect(updateCalls.remove).toEqual(['c'])

    // _outbox should be empty after full success
    expect(storage.store['_outbox']).toEqual([])
  })

  it('partial failure: an update.set throws; remaining ops are persisted to _outbox', async () => {
    const options = {} as OfflineSyncOptionsExtra
    const outbox: OutboxOp[] = [
      { op: 'set', prop: 'alpha', value: makeMeta('α') },
      { op: 'set', prop: 'beta', value: makeMeta('β') }, // we'll make this fail
      { op: 'remove', prop: 'gamma' }
    ]

    const remoteItems: Record<string, ItemType> = {}

    const updateCalls: string[] = []
    const update = {
      set: async (prop: string, item: ItemType) => {
        updateCalls.push(prop)
        if (prop === 'beta') {
          // Simulate flaky network error for 'beta'
          throw new Error('Simulated network failure on beta')
        }
        remoteItems[prop] = item
      },
      remove: async (prop: string) => {
        updateCalls.push(`remove:${prop}`)
        delete remoteItems[prop]
      }
    }

    await processOutbox(options, storage as any, outbox.slice(), remoteItems, update as any, logger as any)

    // Only the first 'alpha' op should have succeeded; 'beta' triggered error and prevented further ops
    expect(updateCalls).toEqual(['alpha', 'beta'])
    // Because we stop on error, processOutbox should persist the remaining dedupedOutbox
    // deduplicateOutbox keeps the last op per prop; in our input each prop is unique, so remaining should be ['beta','remove:gamma']
    // processOutbox stores the dedupedOutbox (with the unprocessed tail) under '_outbox'
    const persisted = storage.store['_outbox']
    expect(Array.isArray(persisted)).toBe(true)
    // find first remaining op should be 'beta' (the failing one)
    expect(persisted.length).toBeGreaterThanOrEqual(1)
    expect(persisted[0]).toMatchObject({ prop: 'beta' })
  })

  it('skips expired items during outbox processing', async () => {
    const options = {} as OfflineSyncOptionsExtra
    const outbox: OutboxOp[] = [
      { op: 'set', prop: 'fresh', value: makeMeta('fresh') },
      { op: 'set', prop: 'old', value: makeExpiredMeta('old') }, // expired, should be skipped
      { op: 'set', prop: 'newer', value: makeMeta('new') }
    ]
    const remoteItems: Record<string, ItemType> = {}

    const processed: string[] = []
    const update = {
      set: async (prop: string, item: ItemType) => {
        processed.push(prop)
        remoteItems[prop] = item
      },
      remove: async (_prop: string) => {
        // not expected
      }
    }

    await processOutbox(options, storage as any, outbox.slice(), remoteItems, update as any, logger as any)

    // expired 'old' should be skipped; others processed
    expect(processed).toEqual(['fresh', 'newer'])
    // _outbox should be empty after success
    expect(storage.store['_outbox']).toEqual([])
    // logger should contain a message about skipping expired
    const found = logger.logs.some(l => l.includes('Skipping expired item during outbox sync') || l.includes('Skipping expired'))
    expect(found).toBe(true)
  })

  it('deduplicates outbox: last-op-per-prop wins (e.g. set then remove => remove only)', async () => {
    const options = {} as OfflineSyncOptionsExtra
    // multiple ops for 'dup' prop; last op is 'remove' => expect only 'remove' to be processed
    const outbox: OutboxOp[] = [
      { op: 'set', prop: 'dup', value: makeMeta('v1') },
      { op: 'set', prop: 'dup', value: makeMeta('v2') },
      { op: 'remove', prop: 'dup' },
      { op: 'set', prop: 'other', value: makeMeta('o') }
    ]
    const remoteItems: Record<string, ItemType> = {}

    const updateCalls: string[] = []
    const update = {
      set: async (prop: string, item: ItemType) => {
        updateCalls.push(`set:${prop}`)
        remoteItems[prop] = item
      },
      remove: async (prop: string) => {
        updateCalls.push(`remove:${prop}`)
        delete remoteItems[prop]
      }
    }

    await processOutbox(options, storage as any, outbox.slice(), remoteItems, update as any, logger as any)

    // dedupedOutbox should be [remove dup, set other] (order may be based on dedupe implementation)
    // We assert that there is no set:dup invoked, only remove:dup and set:other.
    expect(updateCalls).toContain('remove:dup')
    expect(updateCalls).toContain('set:other')
    expect(updateCalls).not.toContain('set:dup')
    // _outbox should be empty after success
    expect(storage.store['_outbox']).toEqual([])
  })
})
