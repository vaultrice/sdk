import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest'
import createOfflineNonLocalStorage from '../../src/OfflineNonLocalStorage'
import { StorageAdapter, ItemType } from '../../src/types'
import mockRequest, { setRemoteState } from './fixtures/requestMock'
import mockWs from './fixtures/getWebsocketMock'
import mockRetrieveAccessToken from './fixtures/retrieveAccessTokenMock'

// --- Mocks ---

const createMockStorage = (): StorageAdapter & { state: Record<string, any>, clearState: () => void } => {
  let state: Record<string, any> = {}
  return {
    state,
    get: vi.fn(async (key: string) => state[key] ?? null),
    set: vi.fn(async (key: string, value: any) => { state[key] = value }),
    remove: vi.fn(async (key: string) => { delete state[key] }),
    getAll: vi.fn(async () => state),
    // clear: vi.fn(async () => {
    //   for (const key in state) delete state[key]
    // }),
    clearState: () => { state = {} } // Helper for tests
  }
}

const credentials = {
  apiKey: 'dummy-key',
  apiSecret: 'dummy-secret',
  projectId: 'dummy-project'
}

describe('createOfflineNonLocalStorage', () => {
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
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    vi.useFakeTimers()
    mockStorage = createMockStorage()
    // Reset remote state before each test
    setRemoteState(credentials.projectId, '_undefined_', 'test-id-online', {})
  })

  afterEach(() => {
    vi.useRealTimers()
    mockStorage.clearState()
  })

  describe('When Initializing and Operating Offline', () => {
    it('should start in offline mode and read from local storage', async () => {
      mockStorage.state.foo = { value: 'bar' }
      const nls = await createOfflineNonLocalStorage(credentials, { id: 'test-id-connection-error', storage: () => mockStorage })

      expect(nls.isConnected).toBe(false)
      const item = await nls.getItem('foo')
      expect(item?.value).toBe('bar')
    })

    it('should set an item to the local store and queue it in the outbox', async () => {
      const nls = await createOfflineNonLocalStorage(credentials, { id: 'test-id-connection-error', storage: () => mockStorage })
      await nls.setItem('foo', 'bar')

      expect(mockStorage.set).toHaveBeenCalledWith('foo', expect.objectContaining({ value: 'bar' }))
      expect(mockStorage.set).toHaveBeenCalledWith('_outbox', [
        expect.objectContaining({ op: 'set', prop: 'foo' })
      ])
    })

    it('should remove an item and queue it in the outbox', async () => {
      mockStorage.state.foo = { value: 'bar' }
      const nls = await createOfflineNonLocalStorage(credentials, { id: 'test-id-connection-error', storage: () => mockStorage })
      await nls.removeItem('foo')

      expect(mockStorage.remove).toHaveBeenCalledWith('foo')
      expect(mockStorage.set).toHaveBeenCalledWith('_outbox', expect.arrayContaining([
        expect.objectContaining({ op: 'remove', prop: 'foo' })
      ]))
    })

    it('should fire local events for local changes', async () => {
      const nls = await createOfflineNonLocalStorage(credentials, { id: 'test-id-connection-error', storage: () => mockStorage })
      const setSpy = vi.fn()
      const removeSpy = vi.fn()
      nls.on('setItem', setSpy)
      nls.on('removeItem', removeSpy)

      await nls.setItem('foo', 'bar')
      expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ prop: 'foo', value: 'bar' }))

      await nls.removeItem('foo')
      expect(removeSpy).toHaveBeenCalledWith(expect.objectContaining({ prop: 'foo' }))
    })

    it('should not return expired items', async () => {
      const nls = await createOfflineNonLocalStorage(credentials, {
        id: 'test-id-connection-error',
        storage: () => mockStorage
      })
      await nls.setItem('foo', 'bar', { ttl: 1000 })
      expect((await nls.getItem('foo'))?.value).toBe('bar')

      vi.advanceTimersByTime(1001)
      expect(await nls.getItem('foo')).toBeUndefined()
    })
  })

  describe('When Coming Online with Pending Changes', () => {
    it('should sync outbox changes to the server on initialization', async () => {
      // 1. ARRANGE: Pre-populate storage with an outbox from a "previous session"
      mockStorage.state._outbox = [
        { op: 'set', prop: 'foo', value: { value: 'local_value', updatedAt: 100 } },
        { op: 'remove', prop: 'old_item' }
      ]

      // 2. ACT: Initialize in online mode
      const nls = await createOfflineNonLocalStorage(credentials, { id: 'test-id-online', storage: () => mockStorage })

      // 3. ASSERT
      expect(nls.isConnected).toBe(true)
      // Check that the remote state was updated (via the requestMock's internal state)
      const remoteFoo = await nls.getItem('foo') // nls reads from remote when online
      expect(remoteFoo?.value).toBe('local_value')
      const remoteOldItem = await nls.getItem('old_item')
      expect(remoteOldItem).toBeUndefined()
      // Outbox should be empty
      expect(mockStorage.state._outbox).toEqual([])
    })

    it('should use default conflict resolution (last-write-wins)', async () => {
      // ARRANGE: Local item is NEWER
      mockStorage.state._outbox = [
        { op: 'set', prop: 'conflict', value: { value: 'local_wins', updatedAt: 200 } }
      ]
      // Remote item is OLDER
      setRemoteState(credentials.projectId, '_undefined_', 'test-id-online', {
        conflict: { value: 'remote_stale', updatedAt: 100 }
      })

      // ACT: Initialize, which triggers the sync
      const nls = await createOfflineNonLocalStorage(credentials, { id: 'test-id-online', storage: () => mockStorage })

      // ASSERT: Local version should have overwritten the remote one
      const finalItem = await nls.getItem('conflict')
      expect(finalItem?.value).toBe('local_wins')
    })

    it('should use a custom conflict resolution function', async () => {
      // ARRANGE: Custom resolver that merges arrays
      const resolveConflict = vi.fn((local: ItemType, remote: ItemType) => ({
        ...remote,
        value: [
          ...new Set([
            ...(Array.isArray(local.value) ? local.value : [local.value]),
            ...(Array.isArray(remote.value) ? remote.value : [remote.value])
          ])
        ]
      }))

      mockStorage.state.list = { value: ['a', 'b'], updatedAt: 100 }
      mockStorage.state._outbox = [
        { op: 'set', prop: 'list', value: { value: ['a', 'b'], updatedAt: 100 } }
      ]
      // Pre-populate remote state directly
      setRemoteState(credentials.projectId, '_undefined_', 'test-id-online', {
        list: { value: ['b', 'c'], updatedAt: 50 }
      })

      // ACT: Initialize with the custom resolver
      const nls = await createOfflineNonLocalStorage(credentials, {
        id: 'test-id-online',
        storage: () => mockStorage,
        resolveConflict
      })

      // ASSERT
      expect(resolveConflict).toHaveBeenCalled()
      const finalItem = await nls.getItem('list')
      expect(finalItem?.value).toEqual(['a', 'b', 'c'])
    })
  })
})
