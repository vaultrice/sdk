import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest'
import { NonLocalStorage, createSyncObject } from '../../src/index'
import ThrottleManager from '../../src/ThrottleManager'
import mockRequest from './fixtures/requestMock'
import mockWs from './fixtures/getWebsocketMock'
import mockRetrieveAccessToken from './fixtures/retrieveAccessTokenMock'
import { setTimeout as wait } from 'node:timers/promises'

const credentials = {
  apiKey: 'dummy-key',
  apiSecret: 'dummy-secret',
  projectId: 'dummy-project'
}

const logger = { log: vi.fn() }
vi.mock('../../src/logger', () => ({ default: () => logger }))

describe('Throttling Functionality', () => {
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
  })

  afterEach(() => {
    vi.useRealTimers()
    logger.log.mockClear() // Clear the logger spy after each test
  })

  // 1. Unit tests for the ThrottleManager itself
  describe('ThrottleManager (Unit Tests)', () => {
    it('should allow operations up to the limit', async () => {
      const manager = new ThrottleManager({ maxOperations: 2, windowMs: 1000 })
      await expect(manager.throttleOperation()).resolves.toBeUndefined()
      await expect(manager.throttleOperation()).resolves.toBeUndefined()
    })

    it('should throw an error when the rate limit is exceeded', async () => {
      const manager = new ThrottleManager({ maxOperations: 2, windowMs: 1000 })
      await manager.throttleOperation()
      await manager.throttleOperation()
      await expect(manager.throttleOperation()).rejects.toThrow(/rate limit exceeded/)
    })

    it('should reset the count after the time window passes', async () => {
      const manager = new ThrottleManager({ maxOperations: 1, windowMs: 1000 })
      await manager.throttleOperation() // First operation succeeds
      await expect(manager.throttleOperation()).rejects.toThrow() // Second fails

      vi.advanceTimersByTime(1001) // Advance time past the window

      await expect(manager.throttleOperation()).resolves.toBeUndefined() // Third succeeds again
    })

    // --- FIX: Add async and advance timers for this test ---
    it('should enforce the operationDelay between operations', async () => {
      const manager = new ThrottleManager({ operationDelay: 100 })
      const startTime = Date.now()

      const p1 = manager.throttleOperation()
      const p2 = manager.throttleOperation()

      // Allow the internal delays to complete
      await vi.advanceTimersByTimeAsync(100)

      await Promise.all([p1, p2])

      const endTime = Date.now()
      expect(endTime - startTime).toBeGreaterThanOrEqual(100)
    })

    it('should not throttle if disabled', async () => {
      const manager = new ThrottleManager({ enabled: false, maxOperations: 1 })
      await expect(manager.throttleOperation()).resolves.toBeUndefined()
      await expect(manager.throttleOperation()).resolves.toBeUndefined() // Should not throw
      await expect(manager.throttleOperation()).resolves.toBeUndefined() // Should not throw
    })
  })

  // 2. Integration tests with NonLocalStorage (HTTP requests)
  describe('NonLocalStorage Integration', () => {
    it('should throttle setItem calls when the limit is exceeded', async () => {
      const nls = new NonLocalStorage(credentials, {
        id: 'test-throttle-http',
        throttling: { maxOperations: 2, windowMs: 60000 }
      })

      await nls.setItem('a', 1) // op 1
      await nls.setItem('b', 2) // op 2

      // op 3 should fail
      await expect(nls.setItem('c', 3)).rejects.toThrow(/rate limit exceeded/)
    })

    it('should allow more calls after the window resets', async () => {
      const nls = new NonLocalStorage(credentials, {
        id: 'test-throttle-reset',
        throttling: { maxOperations: 1, windowMs: 1000 }
      })

      await nls.setItem('a', 1) // op 1
      await expect(nls.setItem('b', 2)).rejects.toThrow()

      vi.advanceTimersByTime(1001)

      await expect(nls.setItem('c', 3)).resolves.toBeDefined() // Should succeed now
    })
  })

  // 3. Integration tests with WebSocket messages
  describe('WebSocket and SyncObject Integration', () => {
    beforeEach(() => {
      vi.useRealTimers()
    })

    it('should throttle WebSocket send() messages', async () => {
      ;(NonLocalStorage as any).getWebSocketServer()

      const nls = new NonLocalStorage(credentials, {
        id: 'test-throttle-ws',
        throttling: { maxOperations: 2, windowMs: 60000 }
      })

      await nls.send({ msg: 1 }) // op 1
      await nls.send({ msg: 2 }) // op 2

      // op 3 should fail
      await expect(nls.send({ msg: 3 })).rejects.toThrow(/rate limit exceeded/)
    })

    it('should throttle presence join() operations', async () => {
      const nls = new NonLocalStorage(credentials, {
        id: 'test-throttle-presence',
        throttling: { maxOperations: 1, windowMs: 60000 }
      })

      await nls.join({ name: 'Alice' }) // op 1

      // op 2 should fail
      await expect(nls.join({ name: 'Bob' })).rejects.toThrow(/rate limit exceeded/)
    })

    it('should throttle SyncObject property sets', async () => {
      const syncObject = await createSyncObject<{ a: number, b: number, c: number }>(credentials, {
        id: 'test-throttle-syncobject',
        throttling: { maxOperations: 2, windowMs: 60000 }
      })

      // These are asynchronous under the hood but don't return a promise from the proxy
      syncObject.a = 1 // op 1
      syncObject.b = 2 // op 2
      syncObject.c = 3 // op 3 - this will fail internally

      // Allow async operations to complete
      await wait(10)

      // The proxy 'set' doesn't throw, but the internal setItem call will fail.
      // We can check if the error was logged, which is the expected behavior.
      expect(logger.log).toHaveBeenCalledWith(
        'error',
        expect.stringContaining('[SyncObject] setItem failed for "c": Operation rate limit exceeded')
      )
    })
  })
})
