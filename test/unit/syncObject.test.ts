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
  })
})
