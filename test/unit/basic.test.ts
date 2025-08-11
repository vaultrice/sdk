import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { NonLocalStorage } from '../../src/index'
import uuidv4 from '../../src/uuidv4'
import mockRequest from './fixtures/requestMock'
import mockWs from './fixtures/getWebsocketMock'
import mockRetrieveAccessToken from './fixtures/retrieveAccessTokenMock'
import { setTimeout as wait } from 'node:timers/promises'

describe('NonLocalStorage', () => {
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

  describe('new instance', () => {
    it('should work as expected', () => {
      const nls = new NonLocalStorage({ apiKey: 'dummy', apiSecret: 'dummy', projectId: '12345' })
      expect(nls).to.have.property('id')

      const nls2 = new NonLocalStorage({ apiKey: 'dummy', apiSecret: 'dummy', projectId: '12345' }, 'my-id')
      expect(nls2).to.have.property('id', 'my-id')
    })
  })

  describe('static accessToken generation', () => {
    it('should work as expected', async () => {
      const accessToken = await NonLocalStorage.retrieveAccessToken('my-project-id', 'a-k-1', 's-k-1')
      expect(accessToken).to.be.a('string')
    })
  })

  describe('basic usage', () => {
    it('should work as expected', async () => {
      const nls = new NonLocalStorage({ apiKey: uuidv4(), apiSecret: 'dummy', projectId: '12345' })
      let item = await nls.getItem('my-prop')
      expect(item).to.eql(undefined)

      const setInfo = await nls.setItem('my-prop', 'my-value')
      expect(setInfo).to.have.property('expiresAt')

      item = await nls.getItem('my-prop')
      expect(item).not.to.eql(undefined)
      expect(item).to.have.property('value', 'my-value')
      expect(item).to.have.property('expiresAt')

      item = await nls.getItem<string>('my-prop')
      expect(item).not.to.eql(undefined)
      expect(item).to.have.property('value', 'my-value')
      expect(item).to.have.property('expiresAt')

      await nls.setItem('my-prop-2', 'my-value-2')
      await nls.setItem('my-prop-3', 'my-value-3')
      item = await nls.getItem('my-prop-3')
      expect(item).not.to.eql(undefined)

      const items = await nls.getItems(['my-prop-2', 'my-prop-3'])
      expect(items).to.have.property('my-prop-2')
      expect(items).to.have.property('my-prop-3')
      expect(items?.['my-prop-2']).to.have.property('value', 'my-value-2')
      expect(items?.['my-prop-2']).to.have.property('expiresAt')

      await nls.removeItem('my-prop-3')
      item = await nls.getItem('my-prop-3')
      expect(item).to.eql(undefined)

      const setInfos = await nls.setItems({ another: { value: 'here' }, obj: { value: { some: 'thing' } } })
      expect(setInfos).to.have.property('another')
      expect(setInfos?.another).not.to.have.property('value')
      expect(setInfos?.another).to.have.property('expiresAt')
      expect(setInfos).to.have.property('obj')
      expect(setInfos?.obj).not.to.have.property('value')
      expect(setInfos?.obj).to.have.property('expiresAt')

      item = await nls.getItem('another')
      expect(item?.value).to.eql('here')

      item = await nls.getItem('obj')
      expect(item?.value).to.eql({ some: 'thing' })

      const incr = await nls.incrementItem('counter', 7)
      expect(incr).to.have.property('expiresAt')
      expect(incr).to.have.property('value', 7)
      await nls.decrementItem('counter', 1)
      const counter = await nls.getItem('counter')
      expect(counter).to.have.property('expiresAt')
      expect(counter).to.have.property('value', 6)

      await nls.removeItems(['another'])
      item = await nls.getItem('another')
      expect(item).to.eql(undefined)

      const allItems = await nls.getAllItems()
      expect(allItems).to.have.property('my-prop')
      expect(allItems).to.have.property('my-prop-2')
      expect(allItems?.['my-prop-2']).to.have.property('value', 'my-value-2')
      expect(allItems?.['my-prop-2']).to.have.property('expiresAt')

      const keys = await nls.getAllKeys()
      expect(keys).to.contain('my-prop')
      expect(keys).to.contain('my-prop-2')

      await nls.clear()
      item = await nls.getItem('my-prop-2')
      expect(item).to.eql(undefined)
    })
  })

  describe('websocket part usage', () => {
    it('should work as expected', async () => {
      const receivedMesssagesOnServer: any[] = []
      const server = (NonLocalStorage as any).getWebSocketServer()
      server.on('connection', (socket) => {
        socket.on('message', (data) => {
          receivedMesssagesOnServer.push(JSON.parse(data))
        })
      })

      const nls = new NonLocalStorage({ apiKey: uuidv4(), apiSecret: 'dummy', projectId: uuidv4() })
      expect(nls).to.have.property('send')
      expect(nls).to.have.property('on')

      nls.on('error', (e) => {
        console.log(e)
      })
      // nls.on('disconnect', () => {
      //   console.log('disconnected')
      // })
      const receivedMesssagesOnClient: any[] = []
      nls.on('message', (m) => {
        receivedMesssagesOnClient.push(m)
      })

      await new Promise<void>((resolve) => {
        nls.on('connect', () => {
          // console.log('connected')
          resolve()
        })
      })

      nls.send({ hi: 'there' })
      await wait(10)
      expect(receivedMesssagesOnServer).to.have.lengthOf(1)
      expect(receivedMesssagesOnServer[0]).to.have.property('event', 'message')
      expect(receivedMesssagesOnServer[0]).to.have.property('payload')
      expect(receivedMesssagesOnServer[0].payload).to.eql({ hi: 'there' })

      await nls.send({ hi2: 'there2' }, { transport: 'http' })
      await wait(10)
      expect(receivedMesssagesOnClient).to.have.lengthOf(1)
      expect(receivedMesssagesOnClient[0]).to.eql({ hi2: 'there2' })

      nls.disconnect()
    })
  })

  describe('websocket part usage (item events)', () => {
    it('should work as expected', async () => {
      const receivedMesssagesOnServer: any[] = []
      const server = (NonLocalStorage as any).getWebSocketServer()
      server.on('connection', (socket) => {
        socket.on('message', (data) => {
          receivedMesssagesOnServer.push(JSON.parse(data))
        })
      })

      const nls = new NonLocalStorage({ apiKey: uuidv4(), apiSecret: 'dummy', projectId: uuidv4() })

      nls.on('error', (e) => {
        console.log(e)
      })
      // nls.on('disconnect', () => {
      //   console.log('disconnected')
      // })
      const receivedMesssagesOnClient: any[] = []
      nls.on('message', (m) => {
        receivedMesssagesOnClient.push(m)
      })

      const setItemEvts1: any[] = []
      nls.on('setItem', (m) => {
        setItemEvts1.push(m)
      })
      const setItemEvts2: any[] = []
      nls.on('setItem', 'my-prop-2', (m) => {
        setItemEvts2.push(m)
      })

      await new Promise<void>((resolve) => {
        nls.on('connect', () => {
          // console.log('connected')
          resolve()
        })
      })

      await nls.setItem('my-prop', 'my-value')
      await nls.setItem('my-prop-2', 'my-value-2')
      await nls.setItems({
        'my-prop-3': {
          value: 'my-value-3'
        }
      })
      await wait(10)
      expect(receivedMesssagesOnServer).to.have.lengthOf(0)
      expect(receivedMesssagesOnClient).to.have.lengthOf(0)
      expect(setItemEvts1).to.have.lengthOf(3)
      expect(setItemEvts1[0]).to.have.property('prop', 'my-prop')
      expect(setItemEvts1[0]).to.have.property('value', 'my-value')
      expect(setItemEvts1[0]).to.have.property('expiresAt')
      expect(setItemEvts1[1]).to.have.property('prop', 'my-prop-2')
      expect(setItemEvts1[1]).to.have.property('value', 'my-value-2')
      expect(setItemEvts1[1]).to.have.property('expiresAt')
      expect(setItemEvts1[2]).to.have.property('prop', 'my-prop-3')
      expect(setItemEvts1[2]).to.have.property('value', 'my-value-3')
      expect(setItemEvts1[2]).to.have.property('expiresAt')
      expect(setItemEvts2).to.have.lengthOf(1)
      expect(setItemEvts2[0]).to.have.property('prop', 'my-prop-2')
      expect(setItemEvts2[0]).to.have.property('value', 'my-value-2')
      expect(setItemEvts2[0]).to.have.property('expiresAt')

      const removeItemEvts1: string[] = []
      nls.on('removeItem', (m) => {
        removeItemEvts1.push(m.prop)
      })
      const removeItemEvts2: string[] = []
      nls.on('removeItem', 'my-prop-2', () => {
        removeItemEvts2.push('my-prop-2')
      })

      await nls.removeItem('my-prop-2')
      await nls.removeItems(['my-prop-3'])
      await wait(10)
      expect(receivedMesssagesOnServer).to.have.lengthOf(0)
      expect(receivedMesssagesOnClient).to.have.lengthOf(0)
      expect(removeItemEvts1).to.have.lengthOf(2)
      expect(removeItemEvts1).to.contain('my-prop-2')
      expect(removeItemEvts1).to.contain('my-prop-3')
      expect(removeItemEvts2).to.have.lengthOf(1)
      expect(removeItemEvts2).to.contain('my-prop-2')

      nls.disconnect()
      server.stop()
    })
  })

  describe('e2ee usage', () => {
    it('should work as expected', async () => {
      const nls = new NonLocalStorage({ apiKey: uuidv4(), apiSecret: '1234', projectId: uuidv4() }, { id: '1122334455', passphrase: 'very secret e2ee password' })
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

  describe('e2ee usage with websockets stuff', () => {
    it('should work as expected', async () => {
      const receivedMesssagesOnServer: any[] = []
      const server = (NonLocalStorage as any).getWebSocketServer()
      server.on('connection', (socket) => {
        socket.on('message', (data) => {
          receivedMesssagesOnServer.push(JSON.parse(data))
        })
      })

      const nls = new NonLocalStorage({ apiKey: uuidv4(), apiSecret: 'dummy', projectId: uuidv4() }, { id: '1234567890', passphrase: 'very secret e2ee password' })
      await nls.getEncryptionSettings()

      const receivedMesssagesOnClient: any[] = []
      nls.on('message', (m) => {
        receivedMesssagesOnClient.push(m)
      })

      const setItemEvts1: any[] = []
      nls.on('setItem', (m) => {
        setItemEvts1.push(m)
      })
      const setItemEvts2: any[] = []
      nls.on('setItem', 'my-prop-2', (m) => {
        setItemEvts2.push(m)
      })

      await new Promise<void>((resolve) => {
        nls.on('connect', () => {
          // console.log('connected')
          resolve()
        })
      })

      await nls.setItem('my-prop', 'my-value')
      await nls.setItem('my-prop-2', 'my-value-2')
      await nls.setItems({
        'my-prop-3': {
          value: 'my-value-3'
        }
      })
      await wait(10)
      expect(receivedMesssagesOnServer).to.have.lengthOf(0)
      expect(receivedMesssagesOnClient).to.have.lengthOf(0)
      expect(setItemEvts1).to.have.lengthOf(3)
      expect(setItemEvts1[0]).to.have.property('prop', 'my-prop')
      expect(setItemEvts1[0]).to.have.property('value', 'my-value')
      expect(setItemEvts1[0]).to.have.property('expiresAt')
      expect(setItemEvts1[1]).to.have.property('prop', 'my-prop-2')
      expect(setItemEvts1[1]).to.have.property('value', 'my-value-2')
      expect(setItemEvts1[1]).to.have.property('expiresAt')
      expect(setItemEvts1[2]).to.have.property('prop', 'my-prop-3')
      expect(setItemEvts1[2]).to.have.property('value', 'my-value-3')
      expect(setItemEvts1[2]).to.have.property('expiresAt')
      expect(setItemEvts2).to.have.lengthOf(1)
      expect(setItemEvts2[0]).to.have.property('prop', 'my-prop-2')
      expect(setItemEvts2[0]).to.have.property('value', 'my-value-2')
      expect(setItemEvts2[0]).to.have.property('expiresAt')

      const removeItemEvts1: string[] = []
      nls.on('removeItem', (m) => {
        removeItemEvts1.push(m.prop)
      })
      const removeItemEvts2: string[] = []
      nls.on('removeItem', 'my-prop-2', () => {
        removeItemEvts2.push('my-prop-2')
      })

      await nls.removeItem('my-prop-2')
      await nls.removeItems(['my-prop-3'])
      await wait(10)
      expect(receivedMesssagesOnServer).to.have.lengthOf(0)
      expect(receivedMesssagesOnClient).to.have.lengthOf(0)
      expect(removeItemEvts1).to.have.lengthOf(2)
      expect(removeItemEvts1).to.contain('my-prop-2')
      expect(removeItemEvts1).to.contain('my-prop-3')
      expect(removeItemEvts2).to.have.lengthOf(1)
      expect(removeItemEvts2).to.contain('my-prop-2')

      nls.send({ hiEnc1: 'thereEnc1' })
      await wait(10)
      expect(receivedMesssagesOnServer).to.have.lengthOf(1)
      expect(receivedMesssagesOnServer[0]).to.have.property('event', 'message')
      expect(receivedMesssagesOnServer[0]).to.have.property('payload')
      expect(receivedMesssagesOnServer[0].payload).not.to.eql({ hiEnc1: 'thereEnc1' }) // it's encrypted

      await nls.send({ hiEnc: 'thereEnc' }, { transport: 'http' })
      await wait(10)
      expect(receivedMesssagesOnClient).to.have.lengthOf(1)
      expect(receivedMesssagesOnClient[0]).to.eql({ hiEnc: 'thereEnc' })

      nls.disconnect()
    })
  })

  describe('e2ee usage with object id signature', () => {
    it('should work as expected', async () => {
      const nls = new NonLocalStorage({ apiKey: uuidv4(), apiSecret: '1234', projectId: uuidv4() }, { id: '1122334455667788', idSignature: '1122334455667788-fake-signed' })
      expect(nls).to.have.property('idSignature')
    })
  })
})
