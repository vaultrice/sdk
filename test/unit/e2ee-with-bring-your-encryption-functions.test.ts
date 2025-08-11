import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { NonLocalStorage } from '../../src/index'
import uuidv4 from '../../src/uuidv4'
import mockRequest from './fixtures/requestMock'
import mockWs from './fixtures/getWebsocketMock'
import mockRetrieveAccessToken from './fixtures/retrieveAccessTokenMock'

describe('NonLocalStorage (e2ee custom)', () => {
  let restoreRequest, restoreWs, restoreRetrieveAccessToken
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

  describe('by having the encryption functionality outside of the sdk', () => {
    it('should work as expected', async () => {
      const getEncryptionHandler = async (encryptionSettings) => {
        return {
          encrypt: async (v) => v.split('').reverse().join(''),
          decrypt: async (v) => v.split('').reverse().join('')
        }
      }
      const nls = new NonLocalStorage({ apiKey: uuidv4(), apiSecret: '1234', projectId: uuidv4() }, { id: '1122334455', getEncryptionHandler })
      await nls.getEncryptionSettings()
      const set = await nls.setItem('testprop', 'test-value')
      expect(set).to.have.property('keyVersion', 0)
      const item = await nls.getItem('testprop')
      expect(item?.value).to.eql('test-value')
      expect(item?.keyVersion).to.eql(0)

      await nls.rotateEncryption(32)
      const set2 = await nls.setItem('testprop2', 'test-value2')
      expect(set2).to.have.property('keyVersion', 1)
      const item2 = await nls.getItem('testprop2')
      expect(item2?.value).to.eql('test-value2')
      expect(item2?.keyVersion).to.eql(1)

      const oldItem = await nls.getItem('testprop')
      expect(oldItem?.value).to.eql('test-value')
      expect(oldItem?.keyVersion).to.eql(0)
    })
  })
})
