import { describe, it, expect, beforeEach, afterEach, vi, afterAll, beforeAll } from 'vitest'
import createOfflineSyncObject from '../../src/OfflineSyncObject'
import { StorageAdapter } from '../../src/types'
import mockRequest from './fixtures/requestMock'
import mockWs from './fixtures/getWebsocketMock'
import mockRetrieveAccessToken from './fixtures/retrieveAccessTokenMock'

// --- Mocks ---

// 1. A controllable mock Storage Adapter
const createMockStorage = (): StorageAdapter & { state: Record<string, any> } => {
  const state: Record<string, any> = {}
  return {
    state,
    get: vi.fn(async (key: string) => state[key] ?? null),
    set: vi.fn(async (key: string, value: any) => { state[key] = value }),
    remove: vi.fn(async (key: string) => { delete state[key] }),
    getAll: vi.fn(async () => state)
  }
}

// 2. A reusable mock for the online SyncObject
const createMockSyncObject = (initialData: Record<string, any> = {}) => {
  const store = { ...initialData }
  const listeners: Record<string, Function[]> = {}

  const syncObject: any = {
    id: 'test-id',
    isConnected: true,
    joinedConnections: [],
    on: vi.fn((event: string, ...args: any[]) => {
      listeners[event] = listeners[event] || []
      // support both (event, fn) and (event, name, fn)
      if (typeof args[0] === 'function') {
        listeners[event].push(args[0])
      } else if (typeof args[1] === 'function') {
        listeners[event].push(args[1])
      }
    }),
    off: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
    send: vi.fn(),
    useAccessToken: vi.fn(),
    onAccessTokenExpiring: vi.fn(),
    offAccessTokenExpiring: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    __store: store,
    __listeners: listeners,
    // simulate a server-side update (firing 'setItem' callbacks)
    __triggerRemoteUpdate: (prop: string, value: any) => {
      store[prop] = value
      ;(listeners['setItem'] || []).forEach(fn => {
        try { fn({ prop, ...value }) } catch (_) { /* ignore */ }
      })
    },
    // Compatibility helper used by OfflineSyncObject.handleConnect
    __getNonLocalStorage: () => ({
      getAllItems: async () => store,
      setItem: async (key, value, options?: { ttl?: number }) => {
        store[key] ||= {}
        store[key].value = value
        const now = Date.now()
        store[key].expiresAt = options?.ttl && options?.ttl > 0 ? (now + options?.ttl) : (60 * 60 * 1000)
        store[key].updatedAt = now
        if (!store[key].createdAt) store[key].createdAt = now
      },
      removeItem: async (key) => { delete store[key] }
    }),
    __getInternalMemoryStore: () => {
      syncObject._store ||= {}
      return syncObject._store
    }
  }

  return new Proxy(syncObject, {
    get: (target, prop) => {
      if (prop in target) return target[prop as keyof typeof target]
      return target.__store[prop as string]?.value
    },
    set: (target, prop, value) => {
      target.__store[prop as string] = value
      return true
    }
  })
}

// 2b. A flaky mock that fails once for specified prop names on set,
// used to simulate partial network failures during processOutbox.
const createFlakyMockSyncObject = (initialData: Record<string, any> = {}, failOnceFor: string[] = []) => {
  const store = { ...initialData }
  const listeners: Record<string, Function[]> = {}
  const failMap: Record<string, boolean> = {}
  failOnceFor.forEach(p => { failMap[p] = true })

  const target: any = {
    id: 'test-id',
    isConnected: true,
    joinedConnections: [],
    on: (event: string, ...args: any[]) => {
      listeners[event] = listeners[event] || []
      if (typeof args[0] === 'function') listeners[event].push(args[0])
      else if (typeof args[1] === 'function') listeners[event].push(args[1])
    },
    off: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
    send: vi.fn(),
    useAccessToken: vi.fn(),
    onAccessTokenExpiring: vi.fn(),
    offAccessTokenExpiring: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    __store: store,
    __listeners: listeners,
    __triggerRemoteUpdate: (prop: string, value: any) => {
      store[prop] = value
      ;(listeners['setItem'] || []).forEach(fn => {
        try { fn({ prop, ...value }) } catch (_) {}
      })
    },
    __getNonLocalStorage: () => ({
      getAllItems: async () => store,
      setItem: async (key, value, options?: { ttl?: number }) => {
        if (failMap[key]) {
          // simulate a transient failure on first attempt
          delete failMap[key]
          throw new Error('simulated network error')
        }
        store[key] ||= {}
        store[key].value = value
        const now = Date.now()
        store[key].expiresAt = options?.ttl && options?.ttl > 0 ? (now + options?.ttl) : (60 * 60 * 1000)
        store[key].updatedAt = now
        if (!store[key].createdAt) store[key].createdAt = now
      },
      removeItem: async (key) => { delete store[key] }
    }),
    __getInternalMemoryStore: () => {
      target._store ||= {}
      return target._store
    },
    // helper to clear failure for a prop
    __allowProp: (prop: string) => { delete failMap[prop] }
  }

  const proxy = new Proxy(target, {
    get: (t, prop) => {
      if (prop in t) return t[prop as keyof typeof t]
      return t.__store[prop as string]
    },
    set: (t, prop, value) => {
      const propName = String(prop)
      if (failMap[propName]) {
        // simulate a transient failure on first attempt
        delete failMap[propName]
        throw new Error('simulated network error')
      }
      t.__store[propName] = value
      return true
    }
  })
  return proxy
}

// 3. Mock the createSyncObject factory so tests can control online/offline
let syncObjectMock: any = null
vi.mock('../../src/SyncObject', () => ({
  default: (...args: any[]) => {
    if (syncObjectMock) return Promise.resolve(syncObjectMock)
    const error: any = new Error('fetch failed')
    error.code = 'ECONNREFUSED'
    return Promise.reject(error)
  },
  reservedProps: [
    'id', 'on', 'off', 'join', 'leave', 'send', 'joinedConnections',
    'useAccessToken', 'onAccessTokenExpiring', 'offAccessTokenExpiring',
    'connect', 'disconnect', 'isConnected', '__getNonLocalStorage'
  ]
}))

const credentials = {
  apiKey: 'dummy-key',
  apiSecret: 'dummy-secret',
  projectId: 'dummy-project'
}

describe('createOfflineSyncObject', () => {
  let mockStorage: ReturnType<typeof createMockStorage>
  let restoreRequest: Function, restoreWs: Function, restoreRetrieveAccessToken: Function

  beforeAll(() => {
    restoreRequest = mockRequest()
    restoreWs = mockWs()
    restoreRetrieveAccessToken = mockRetrieveAccessToken()
  })
  afterAll(() => {
    restoreRequest()
    restoreWs()
    restoreRetrieveAccessToken()
  })

  beforeEach(() => {
    vi.useFakeTimers()
    mockStorage = createMockStorage()
    syncObjectMock = null // Start offline by default
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // helper to flip instance online by assigning syncObjectMock then advancing timers
  async function goOnline (mock?: any, advanceMs = 5000) {
    syncObjectMock = mock || createMockSyncObject()
    await vi.advanceTimersByTimeAsync(advanceMs)
  }

  describe('When Initializing Offline', () => {
    it('should start in offline mode if createSyncObject fails', async () => {
      const offlineSync = await createOfflineSyncObject(credentials, { id: 'test-id', storage: () => mockStorage })
      expect(offlineSync.isConnected).toBe(false)
    })

    it('should load initial state from the storage adapter', async () => {
      mockStorage.state.foo = { value: 'bar' }
      const offlineSync = await createOfflineSyncObject<{ foo: string }>(credentials, { id: 'test-id', storage: () => mockStorage })
      expect(mockStorage.getAll).toHaveBeenCalled()
      expect(offlineSync.foo).toBe('bar')
    })
  })

  describe('When Operating Offline', () => {
    it('should set a value to local storage and queue it in the outbox', async () => {
      const offlineSync = await createOfflineSyncObject<{ foo: string }>(credentials, { id: 'test-id', storage: () => mockStorage })
      offlineSync.foo = 'bar'

      // Check local in-memory state
      expect(offlineSync.foo).toBe('bar')
      // Check that it was persisted to the storage adapter
      expect(mockStorage.set).toHaveBeenCalledWith('foo', expect.objectContaining({ value: 'bar' }))
      // Check that the operation was queued in the outbox
      expect(mockStorage.set).toHaveBeenCalledWith('_outbox', [
        expect.objectContaining({ op: 'set', prop: 'foo' })
      ])
    })

    it('should delete a value from local storage and queue it in the outbox', async () => {
      mockStorage.state.foo = { value: 'bar' }
      const offlineSync = await createOfflineSyncObject<{ foo?: string }>(credentials, { id: 'test-id', storage: () => mockStorage })

      delete offlineSync.foo

      expect(offlineSync.foo).toBeUndefined()
      expect(mockStorage.remove).toHaveBeenCalledWith('foo')
      expect(mockStorage.set).toHaveBeenCalledWith('_outbox', [{ op: 'remove', prop: 'foo' }])
    })

    it('should throw for online-only methods', async () => {
      const offlineSync = await createOfflineSyncObject(credentials, { id: 'test-id', storage: () => mockStorage })
      await expect(offlineSync.join({})).rejects.toThrow(/not available while offline/)
    })
  })

  describe('When Transitioning from Offline to Online', () => {
    it('should sync outbox changes to the server', async () => {
      // 1. Start offline and make changes
      const offlineSync = await createOfflineSyncObject<{ foo: string, bar: number }>(credentials, { id: 'test-id', storage: () => mockStorage })
      offlineSync.foo = 'local_value'
      offlineSync.bar = 123

      // 2. Bring the instance online and trigger reconnect
      await goOnline(createMockSyncObject())

      // 3. Assertions
      expect(offlineSync.isConnected).toBe(true)
      expect(syncObjectMock.foo).toBe('local_value')
      expect(syncObjectMock.bar).toBe(123)
      expect(mockStorage.state._outbox).toEqual([]) // Outbox should be empty
    })

    it('should use default conflict resolution (last-write-wins)', async () => {
      // 1. Local state (older)
      mockStorage.state.conflict = { value: 'local', updatedAt: 100 }
      const offlineSync = await createOfflineSyncObject<{ conflict: any }>(credentials, { id: 'test-id', storage: () => mockStorage })

      // 2. Remote state (newer)
      await goOnline(createMockSyncObject({
        conflict: { value: 'remote', updatedAt: 200 }
      }))

      // 3. Assert: Remote value should win
      expect(offlineSync.conflict).toBe('remote')
    })

    it('should use a custom conflict resolution function', async () => {
      // 1. Custom resolver that merges arrays
      const resolveConflict = vi.fn((local, remote) => ({
        ...remote,
        value: [...new Set([...local.value, ...remote.value])]
      }))

      // 2. Local state
      mockStorage.state.list = { value: ['a', 'b'], updatedAt: 300 } // Local is newer
      const offlineSync = await createOfflineSyncObject<{ list: any }>(credentials, {
        id: 'test-id',
        storage: () => mockStorage,
        resolveConflict
      })

      // 3. Remote state (older)
      await goOnline(createMockSyncObject({
        list: { value: ['b', 'c'], updatedAt: 200 }
      }))

      // 4. Assert
      expect(resolveConflict).toHaveBeenCalled()
      expect(offlineSync.list).toEqual(['a', 'b', 'c'])
    })

    it('should transfer event listeners upon reconnection', async () => {
      const connectHandler = vi.fn()
      const itemHandler = vi.fn()
      const offlineSync = await createOfflineSyncObject(credentials, { id: 'test-id', storage: () => mockStorage })

      offlineSync.on('connect', connectHandler)
      offlineSync.on('setItem', 'foo', itemHandler)

      await goOnline(createMockSyncObject())

      expect(connectHandler).toHaveBeenCalled()

      const calls = syncObjectMock.on.mock.calls
      const found = calls.some(call =>
        call[0] === 'setItem' && call[1] === 'foo' && typeof call[2] === 'function'
      )
      expect(found).toBe(true)

      // Check if transferred listener works
      syncObjectMock.__triggerRemoteUpdate('foo', { value: 'remote_update' })
      expect(itemHandler).toHaveBeenCalledWith(expect.objectContaining({ prop: 'foo', value: 'remote_update' }))
    })

    it('sweep removes expired local items and fires removeItem', async () => {
      const now = Date.now()
      mockStorage.state.expired = { value: 'gone', createdAt: now - 10000, updatedAt: now - 10000, expiresAt: now - 5000 }
      const offlineSync = await createOfflineSyncObject<{ expired: any }>(credentials, {
        id: 'test-sweep',
        storage: () => mockStorage,
        expirationSweepInterval: 1000 // 1s for test
      })

      const removeSpy = vi.fn()
      offlineSync.on('removeItem', removeSpy)

      // advance time to trigger sweep
      await vi.advanceTimersByTimeAsync(1500)

      expect(mockStorage.remove).toHaveBeenCalledWith('expired')
      expect(removeSpy).toHaveBeenCalledWith({ prop: 'expired' })
      expect(offlineSync.expired).toBeUndefined()
    })

    it('skips expired outbox entries when reconnecting', async () => {
      const now = Date.now()
      // queue an expired set operation in outbox
      const expiredMeta = { value: 'old', createdAt: now - 20000, updatedAt: now - 20000, expiresAt: now - 10000 }
      mockStorage.state._outbox = [{ op: 'set', prop: 'oldKey', value: expiredMeta }]

      await createOfflineSyncObject(credentials, {
        id: 'test-outbox-expired',
        storage: () => mockStorage
      })

      // go online
      await goOnline(createMockSyncObject())

      // remote should NOT have oldKey set, outbox should be cleared
      expect(syncObjectMock.oldKey).toBeUndefined()
      expect(mockStorage.state._outbox).toEqual([])
    })

    // it('cleanupExpiredRemote removes expired remote items on connect if enabled', async () => {
    //   const now = Date.now()
    //   // remote item already expired - bring online first
    //   await goOnline(createMockSyncObject({
    //     oldRemote: { value: 'remote', createdAt: now - 20000, updatedAt: now - 20000, expiresAt: now - 10000 }
    //   }))

    //   await createOfflineSyncObject(credentials, {
    //     id: 'test-cleanup-remote',
    //     storage: () => mockStorage,
    //     cleanupExpiredRemote: true
    //   })

    //   // trigger reconnect (instance attempts reconnect in next tick)
    //   await vi.advanceTimersByTimeAsync(5000)

    //   // after handleConnect, remote store should no longer have oldRemote
    //   expect(syncObjectMock.__store.oldRemote).toBeUndefined()
    //   // local storage cleaned
    //   expect(mockStorage.remove).toHaveBeenCalledWith('oldRemote')
    // })

    it('transfers named listeners (event + name) on reconnect', async () => {
      const itemHandler = vi.fn()
      const offlineSync = await createOfflineSyncObject(credentials, { id: 'test-listener-named', storage: () => mockStorage })
      offlineSync.on('setItem', 'foo', itemHandler)

      await goOnline(createMockSyncObject())

      const calls = syncObjectMock.on.mock.calls
      const found = calls.some(call => call[0] === 'setItem' && call[1] === 'foo' && typeof call[2] === 'function')
      expect(found).toBe(true)

      // remote update should trigger named handler
      syncObjectMock.__triggerRemoteUpdate('foo', { value: 'remote' })
      expect(itemHandler).toHaveBeenCalledWith(expect.objectContaining({ prop: 'foo', value: 'remote' }))
    })

    it('transfers onAccessTokenExpiring listeners to online syncObject', async () => {
      const tokenHandler = vi.fn()
      const offlineSync = await createOfflineSyncObject(credentials, { id: 'test-token-listener', storage: () => mockStorage })
      // register via reserved prop while offline
      offlineSync.onAccessTokenExpiring(tokenHandler)

      // go online
      await goOnline(createMockSyncObject())

      // ensure onAccessTokenExpiring was attached to remote
      expect(syncObjectMock.onAccessTokenExpiring).toHaveBeenCalled()
      const passed = syncObjectMock.onAccessTokenExpiring.mock.calls.some(c => c[0] === tokenHandler)
      expect(passed).toBe(true)
    })

    it('setting with ttl while online attaches meta on remote', async () => {
      // create online mock BEFORE creating offline instance so instance initializes online
      await goOnline(createMockSyncObject())
      const offlineSync = await createOfflineSyncObject<{ someKey: any }>(credentials, { id: 'test-ttl-online', storage: () => mockStorage })

      // set with ttl object while online
      offlineSync.someKey = { value: 'v', ttl: 2000 }

      // remote store should contain meta with expiresAt
      const meta = syncObjectMock.__store.someKey
      expect(meta).toBeDefined()
      expect(meta.value).toBe('v')
      expect(typeof meta.expiresAt).toBe('number')
      expect(meta.expiresAt).toBeGreaterThan(Date.now())
    })

    it('processOutbox calls resolveConflict when both local and remote differ during sync', async () => {
      const resolver = vi.fn((local, remote) => ({ ...local, value: 'merged' }))
      // local outbox has a set op
      const now = Date.now()
      mockStorage.state._outbox = [{
        op: 'set',
        prop: 'conflictKey',
        value: { value: 'local', updatedAt: now, createdAt: now, expiresAt: now + 10000 }
      }]

      await goOnline(createMockSyncObject({
        conflictKey: { value: 'remote', updatedAt: now - 1000, createdAt: now - 1000, expiresAt: now + 10000 }
      }))

      await createOfflineSyncObject(credentials, {
        id: 'test-resolve-conflict',
        storage: () => mockStorage,
        resolveConflict: resolver
      })

      await vi.advanceTimersByTimeAsync(5000)

      expect(resolver).toHaveBeenCalled()
      expect(syncObjectMock.__store.conflictKey.value).toBe('merged')
      expect(mockStorage.state._outbox).toEqual([])
    })

    it('partial failure during processOutbox leaves failing op in outbox and resumes later', async () => {
      const now = Date.now()
      // prepare an outbox with two ops: 'a' and 'b'
      const aMeta = { value: 'A', createdAt: now, updatedAt: now, expiresAt: now + 10000 }
      const bMeta = { value: 'B', createdAt: now, updatedAt: now, expiresAt: now + 10000 }
      mockStorage.state._outbox = [
        { op: 'set', prop: 'a', value: aMeta },
        { op: 'set', prop: 'b', value: bMeta }
      ]

      // create flaky sync that fails on first attempt to set 'b'
      const flaky = createFlakyMockSyncObject({}, ['b'])

      // Bring instance online (this triggers processOutbox)
      await createOfflineSyncObject(credentials, {
        id: 'test-flaky',
        storage: () => mockStorage
      })
      // Assign flaky sync object and trigger reconnect handling
      syncObjectMock = flaky
      // initial connect attempt -> processOutbox will run and fail on 'b'
      await vi.advanceTimersByTimeAsync(5000)

      // 'a' should have been applied, 'b' should remain in outbox
      expect(syncObjectMock.__store.a.value).toBe('A')
      expect(mockStorage.state._outbox.length).toBe(1)
      expect(mockStorage.state._outbox[0].prop).toBe('b')

      // Now allow 'b' to succeed by clearing failure and re-trigger connect
      flaky.__allowProp('b')
      // find any attached 'connect' handlers and call them to retry
      const handlers = flaky.__listeners?.connect || []
      // call handlers (simulate reconnect)
      for (const h of handlers) {
        // handlers could be async; call and await if they return a promise
        const res = h()
        if (res && typeof res.then === 'function') await res
      }

      // After retry, outbox should be cleared and 'b' applied
      expect(mockStorage.state._outbox).toEqual([])
      expect(syncObjectMock.__store.b.value).toBe('B')
    })

    it('processOutbox partial failure stops processing and does not drop earlier ops', async () => {
      const now = Date.now()
      mockStorage.state._outbox = [
        { op: 'set', prop: 'x', value: { value: 'X', createdAt: now, updatedAt: now, expiresAt: now + 10000 } },
        { op: 'set', prop: 'y', value: { value: 'Y', createdAt: now, updatedAt: now, expiresAt: now + 10000 } },
        { op: 'set', prop: 'z', value: { value: 'Z', createdAt: now, updatedAt: now, expiresAt: now + 10000 } }
      ]

      // fail on 'y', succeed on others
      const flaky2 = createFlakyMockSyncObject({}, ['y'])

      // create offline instance then bring online with flaky2
      await createOfflineSyncObject(credentials, {
        id: 'test-flaky-2',
        storage: () => mockStorage
      })
      syncObjectMock = flaky2
      await vi.advanceTimersByTimeAsync(5000)

      // 'x' should be applied (first op), 'y' should remain as failing op,
      // 'z' should NOT be applied because processing stops at the failing op
      expect(syncObjectMock.__store.x.value).toBe('X')
      expect(mockStorage.state._outbox.length).toBeGreaterThanOrEqual(1)
      expect(mockStorage.state._outbox.some((o: any) => o.prop === 'y')).toBe(true)
      // ensure 'z' not applied yet
      expect(syncObjectMock.__store.z).toBeUndefined()

      // Allow y to succeed and retrigger connect handlers
      flaky2.__allowProp('y')
      const handlers2 = flaky2.__listeners?.connect || []
      for (const h of handlers2) {
        const res = h()
        if (res && typeof res.then === 'function') await res
      }

      // After retry, outbox cleared, z applied as well
      expect(mockStorage.state._outbox).toEqual([])
      expect(syncObjectMock.__store.y.value).toBe('Y')
      expect(syncObjectMock.__store.z.value).toBe('Z')
    })
  })
})
