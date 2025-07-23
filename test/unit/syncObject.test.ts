import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createSyncObject, NonLocalStorage } from '../../src/index'
import uuidv4 from '../../src/uuidv4'
import mockRequest from './fixtures/requestMock'
import mockWs from './fixtures/getWebsocketMock'
import { setTimeout as wait } from 'node:timers/promises'

describe('SyncObject', () => {
  let restoreRequest, restoreWs
  beforeAll(() => {
    restoreRequest = mockRequest()
    restoreWs = mockWs()
  })
  afterAll(() => {
    restoreRequest()
    restoreWs()
  })

  describe('createSyncObject', () => {
    it('should work as expected', async () => {
      const so = await createSyncObject<{
        theme: 'light' | 'dark'
        fontSize: number
      }>({ apiKey: 'dummy', apiSecret: 'dummy', projectId: '12345' })
      expect(so).to.have.property('id')
      const so2 = await createSyncObject({ apiKey: 'dummy', apiSecret: 'dummy', projectId: '12345' }, 'my-id')
      expect(so2).to.have.property('id', 'my-id')
    })

    it('should work with options object', async () => {
      const so = await createSyncObject({ apiKey: 'dummy', apiSecret: 'dummy', projectId: '12345' }, {
        id: 'options-id',
        class: 'test-class',
        ttl: 5000
      })
      expect(so).to.have.property('id', 'options-id')
    })
  })

  describe('basic usage', () => {
    it('should work as expected', async () => {
      (NonLocalStorage as any).getWebSocketServer()

      const so = await createSyncObject({ apiKey: uuidv4(), apiSecret: 'dummy', projectId: '12345' }, 'room-id')
      expect(so['myProp']).to.eql(undefined)
      so['myProp'] = 'my-value'
      expect(so['myProp']).to.eql('my-value')

      const so2 = await createSyncObject({ apiKey: uuidv4(), apiSecret: 'dummy', projectId: '12345' }, 'room-id')
      expect(so2['myProp']).to.eql('my-value')
      so2['myProp2'] = 'my-value-2'
      expect(so2['myProp2']).to.eql('my-value-2')
      await wait(10)
      expect(so['myProp2']).to.eql('my-value-2')

      so['myProp2'] = undefined
      await wait(10)
      expect(so['myProp2']).to.eql(undefined)
      expect(so2['myProp2']).to.eql(undefined)
    })

    it('should handle different value types', async () => {
      const so = await createSyncObject({ apiKey: uuidv4(), apiSecret: 'dummy', projectId: '12345' }, 'types-test')

      // String
      so['stringProp'] = 'hello world'
      expect(so['stringProp']).to.eql('hello world')

      // Number
      so['numberProp'] = 42
      expect(so['numberProp']).to.eql(42)

      // Boolean
      so['boolProp'] = true
      expect(so['boolProp']).to.eql(true)

      // Object
      so['objProp'] = { nested: { value: 'test' } }
      expect(so['objProp']).to.eql({ nested: { value: 'test' } })

      // Array
      so['arrayProp'] = [1, 2, 3, 'four']
      expect(so['arrayProp']).to.eql([1, 2, 3, 'four'])

      // Handle NaN numbers (should convert to 0)
      so['nanProp'] = NaN
      expect(so['nanProp']).to.eql(0)
    })
  })

  describe('proxy handler robustness', () => {
    it('should prevent overwriting reserved properties', async () => {
      const so = await createSyncObject({ apiKey: uuidv4(), apiSecret: 'dummy', projectId: '12345' }, 'reserved-test')

      // Test 'id' property protection
      expect(() => {
        // @ts-expect-error
        so.id = 'new-id'
      }).to.throw('Cannot set property \'id\' - it is a reserved property')

      // Test 'on' property protection
      expect(() => {
        (so as any).on = true
      }).to.throw('Cannot set property \'on\' - it is a reserved property')

      // Test 'off' property protection
      expect(() => {
        (so as any).off = () => {}
      }).to.throw('Cannot set property \'off\' - it is a reserved property')

      // Verify the properties still work correctly
      expect(so.id).to.be.a('string')
      expect(so.on).to.be.a('function')
      expect(so.off).to.be.a('function')
    })

    it('should properly handle property existence checks', async () => {
      const so = await createSyncObject({ apiKey: uuidv4(), apiSecret: 'dummy', projectId: '12345' }, 'existence-test')

      // Reserved properties should always exist
      expect('id' in so).toBe(true)
      expect('on' in so).toBe(true)
      expect('off' in so).toBe(true)

      // Regular properties
      expect('nonExistent' in so).toBe(false)
      so['testProp'] = 'value'
      expect('testProp' in so).toBe(true)

      // Removed properties
      so['testProp'] = undefined
      expect('testProp' in so).toBe(false)
    })

    it('should handle property enumeration correctly', async () => {
      const so = await createSyncObject({ apiKey: uuidv4(), apiSecret: 'dummy', projectId: '12345' }, 'enum-test')

      so['prop1'] = 'value1'
      so['prop2'] = 'value2'
      so['prop3'] = 'value3'

      const keys = Object.keys(so)
      expect(keys).to.include('prop1')
      expect(keys).to.include('prop2')
      expect(keys).to.include('prop3')
      expect(keys).to.include('id')
      expect(keys).to.include('on')
      expect(keys).to.include('off')

      // Remove one property and check enumeration
      so['prop2'] = undefined
      const newKeys = Object.keys(so)
      expect(newKeys).to.include('prop1')
      expect(newKeys).not.to.include('prop2')
      expect(newKeys).to.include('prop3')
      expect(newKeys).to.include('id')
      expect(newKeys).to.include('on')
      expect(newKeys).to.include('off')
    })

    it('should handle property descriptors correctly', async () => {
      const so = await createSyncObject({ apiKey: uuidv4(), apiSecret: 'dummy', projectId: '12345' }, 'descriptor-test')

      // Reserved properties should be non-configurable and non-writable
      const idDescriptor = Object.getOwnPropertyDescriptor(so, 'id')
      expect(idDescriptor).to.deep.include({
        configurable: false,
        enumerable: true,
        writable: false
      })
      expect(idDescriptor?.value).to.be.a('string')

      const onDescriptor = Object.getOwnPropertyDescriptor(so, 'on')
      expect(onDescriptor).to.deep.include({
        configurable: false,
        enumerable: true,
        writable: false
      })
      expect(onDescriptor?.value).to.be.a('function')

      const offDescriptor = Object.getOwnPropertyDescriptor(so, 'off')
      expect(offDescriptor).to.deep.include({
        configurable: false,
        enumerable: true,
        writable: false
      })
      expect(offDescriptor?.value).to.be.a('function')

      // Regular properties should be configurable and writable
      so['testProp'] = 'test-value'
      const testDescriptor = Object.getOwnPropertyDescriptor(so, 'testProp')
      expect(testDescriptor).to.deep.include({
        configurable: true,
        enumerable: true,
        writable: true,
        value: 'test-value'
      })

      // Non-existent properties should return undefined
      const nonExistentDescriptor = Object.getOwnPropertyDescriptor(so, 'nonExistent')
      expect(nonExistentDescriptor).toBeUndefined()
    })
  })

  describe('event handling through proxy', () => {
    it('should expose on and off methods correctly', async () => {
      const so = await createSyncObject({ apiKey: uuidv4(), apiSecret: 'dummy', projectId: '12345' }, 'events-test')

      // Verify methods are functions
      expect(so.on).to.be.a('function')
      expect(so.off).to.be.a('function')

      // Test event registration and removal
      const receivedEvents: any[] = []
      const handler = (item: any) => {
        receivedEvents.push(item)
      }

      // Register event handler
      so.on('setItem', handler)

      // Trigger an event
      so['eventTest'] = 'event-value'
      await wait(10)

      expect(receivedEvents).to.have.lengthOf(1)
      expect(receivedEvents[0]).to.have.property('prop', 'eventTest')
      expect(receivedEvents[0]).to.have.property('value', 'event-value')

      // Remove event handler
      so.off('setItem', handler)

      // Trigger another event (should not be received)
      so['eventTest2'] = 'event-value-2'
      await wait(10)

      expect(receivedEvents).to.have.lengthOf(1) // Still only one event
    })

    it('should handle specific item event listeners', async () => {
      const so = await createSyncObject({ apiKey: uuidv4(), apiSecret: 'dummy', projectId: '12345' }, 'specific-events-test')

      const specificEvents: any[] = []
      const allEvents: any[] = []

      const specificHandler = (item: any) => {
        specificEvents.push(item)
      }

      const allHandler = (item: any) => {
        allEvents.push(item)
      }

      // Register handlers
      so.on('setItem', 'specificProp', specificHandler)
      so.on('setItem', allHandler)

      // Set specific property
      so['specificProp'] = 'specific-value'
      await wait(10)

      // Set other property
      so['otherProp'] = 'other-value'
      await wait(10)

      expect(specificEvents).to.have.lengthOf(1)
      expect(specificEvents[0]).to.have.property('prop', 'specificProp')
      expect(specificEvents[0]).to.have.property('value', 'specific-value')

      expect(allEvents).to.have.lengthOf(2)
      expect(allEvents[0]).to.have.property('prop', 'specificProp')
      expect(allEvents[1]).to.have.property('prop', 'otherProp')
    })
  })

  describe('synchronization between instances', () => {
    it('should sync changes between multiple instances', async () => {
      const id = uuidv4()

      const so1 = await createSyncObject({ apiKey: uuidv4(), apiSecret: 'dummy', projectId: '12345' }, id)
      const so2 = await createSyncObject({ apiKey: uuidv4(), apiSecret: 'dummy', projectId: '12345' }, id)

      // Set value in first instance
      so1['syncTest'] = 'synced-value'
      await wait(10)

      // Should appear in second instance
      expect(so2['syncTest']).to.eql('synced-value')

      // Modify in second instance
      so2['syncTest'] = 'modified-value'
      await wait(10)

      // Should update in first instance
      expect(so1['syncTest']).to.eql('modified-value')

      // Remove from first instance
      so1['syncTest'] = undefined
      await wait(10)

      // Should be removed from second instance
      expect(so2['syncTest']).to.eql(undefined)
    })
  })

  describe('encryption support', () => {
    it('should work with end-to-end encryption', async () => {
      const id = uuidv4()
      const passphrase = 'test-encryption-passphrase'

      const so = await createSyncObject({
        apiKey: uuidv4(),
        apiSecret: 'dummy',
        projectId: '12345'
      }, {
        id,
        passphrase
      })

      // Set encrypted value
      so['encryptedProp'] = 'secret-value'
      expect(so['encryptedProp']).to.eql('secret-value')

      // Create another instance with same passphrase
      const so2 = await createSyncObject({
        apiKey: uuidv4(),
        apiSecret: 'dummy',
        projectId: '12345'
      }, {
        id,
        passphrase
      })

      await wait(10)

      // Should decrypt correctly
      expect(so2['encryptedProp']).to.eql('secret-value')
    })
  })

  describe('TTL and expiration', () => {
    it('should handle TTL correctly', async () => {
      const so = await createSyncObject({
        apiKey: uuidv4(),
        apiSecret: 'dummy',
        projectId: '12345'
      }, {
        id: uuidv4(),
        ttl: 100 // Very short TTL for testing
      })

      so['shortLived'] = 'expires-soon'
      expect(so['shortLived']).to.eql('expires-soon')

      // Wait for expiration
      await wait(150)

      // Should be expired and return undefined
      expect(so['shortLived']).to.eql(undefined)
      expect('shortLived' in so).toBe(false)
    })
  })

  describe('error handling', () => {
    it('should handle WebSocket errors gracefully', async () => {
      const so = await createSyncObject({ apiKey: uuidv4(), apiSecret: 'dummy', projectId: '12345' }, 'error-test')

      const errors: Error[] = []
      so.on('error', (error: Error) => {
        errors.push(error)
      })

      // Normal operation should not generate errors
      so['normalProp'] = 'normal-value'
      await wait(10)

      expect(errors).to.have.lengthOf(0)
      expect(so['normalProp']).to.eql('normal-value')
    })
  })
})
