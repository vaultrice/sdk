import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { NonLocalStorage } from '../../src/index'
import uuidv4 from '../../src/uuidv4'
import mockRequest from './fixtures/requestMock'
import mockWs from './fixtures/getWebsocketMock'
import { setTimeout as wait } from 'node:timers/promises'

describe('NonLocalStorage (presence)', () => {
  let restoreRequest, restoreWs
  beforeAll(() => {
    restoreRequest = mockRequest()
    restoreWs = mockWs()
  })
  afterAll(() => {
    restoreRequest()
    restoreWs()
  })

  describe('websocket presence part usage', () => {
    it('should work as expected', async () => {
      const receivedMesssagesOnServer: any[] = []
      const server = (NonLocalStorage as any).getWebSocketServer()
      server.on('connection', (socket) => {
        socket.on('message', (data) => {
          const parsedData = JSON.parse(data)
          receivedMesssagesOnServer.push(parsedData)
        })
      })

      const nls = new NonLocalStorage({ apiKey: uuidv4(), apiSecret: 'dummy', projectId: uuidv4() })
      expect(nls).to.have.property('join')
      expect(nls).to.have.property('leave')
      expect(nls).to.have.property('getJoinedConnections')

      nls.on('error', (e) => {
        console.log(e)
      })
      // nls.on('disconnect', () => {
      //   console.log('disconnected')
      // })
      const receivedMesssagesOnClient: any[] = []
      nls.on('presence:join', (m) => {
        receivedMesssagesOnClient.push({ event: 'join', m })
      })
      nls.on('presence:leave', (m) => {
        receivedMesssagesOnClient.push({ event: 'leave', m })
      })

      await new Promise<void>((resolve) => {
        nls.on('connect', () => {
          // console.log('connected')
          resolve()
        })
      })

      let joinedConns = await nls.getJoinedConnections()
      expect(joinedConns).to.have.lengthOf(0)

      await nls.join({ userId: 'my-user-id-1' })

      await wait(10)

      joinedConns = await nls.getJoinedConnections()
      expect(joinedConns).to.have.lengthOf(1)
      expect(joinedConns[0]).to.have.property('connectionId')
      expect(joinedConns[0]).to.have.property('joinedAt')
      expect(joinedConns[0]).to.have.property('data')
      expect(joinedConns[0].data).to.have.property('userId', 'my-user-id-1')

      nls.disconnect()

      await wait(10)

      expect(receivedMesssagesOnClient).to.have.a.lengthOf(2)
      expect(receivedMesssagesOnClient[0]).to.have.property('event', 'join')
      expect(receivedMesssagesOnClient[0]).to.have.property('m')
      expect(receivedMesssagesOnClient[0].m).to.have.property('connectionId')
      expect(receivedMesssagesOnClient[0].m).to.have.property('joinedAt')
      expect(receivedMesssagesOnClient[0].m).to.have.property('data')
      expect(receivedMesssagesOnClient[0].m.data).to.have.property('userId', 'my-user-id-1')
      expect(receivedMesssagesOnClient[1]).to.have.property('event', 'leave')
      expect(receivedMesssagesOnClient[1]).to.have.property('m')
      expect(receivedMesssagesOnClient[1].m).to.have.property('connectionId')
      expect(receivedMesssagesOnClient[1].m.data).to.have.property('userId', 'my-user-id-1')

      joinedConns = await nls.getJoinedConnections()
      expect(joinedConns).to.have.lengthOf(0)

      expect(receivedMesssagesOnServer).to.have.lengthOf(2)
      expect(receivedMesssagesOnServer[0]).to.have.property('event', 'presence:join')
      expect(receivedMesssagesOnServer[0]).to.have.property('payload')
      expect(receivedMesssagesOnServer[0].payload).to.have.property('userId', 'my-user-id-1')
      expect(receivedMesssagesOnServer[1]).to.have.property('event', 'presence:leave')
    })
  })

  describe('websocket presence part usage with e2e encryption', () => {
    it('should work as expected', async () => {
      const receivedMesssagesOnServer: any[] = []
      const server = (NonLocalStorage as any).getWebSocketServer()
      server.on('connection', (socket) => {
        socket.on('message', (data) => {
          const parsedData = JSON.parse(data)
          receivedMesssagesOnServer.push(parsedData)
        })
      })

      const nls = new NonLocalStorage({ apiKey: uuidv4(), apiSecret: '1234', projectId: uuidv4() }, { id: '1122334455', passphrase: 'very secret e2e password' })
      await nls.getEncryptionSettings()
      expect(nls).to.have.property('join')
      expect(nls).to.have.property('leave')
      expect(nls).to.have.property('getJoinedConnections')

      nls.on('error', (e) => {
        console.log(e)
      })
      // nls.on('disconnect', () => {
      //   console.log('disconnected')
      // })
      const receivedMesssagesOnClient: any[] = []
      nls.on('presence:join', (m) => {
        receivedMesssagesOnClient.push({ event: 'join', m })
      })
      nls.on('presence:leave', (m) => {
        receivedMesssagesOnClient.push({ event: 'leave', m })
      })

      await new Promise<void>((resolve) => {
        nls.on('connect', () => {
          // console.log('connected')
          resolve()
        })
      })

      let joinedConns = await nls.getJoinedConnections()
      expect(joinedConns).to.have.lengthOf(0)

      await nls.join({ userId: 'my-user-id-1' })

      await wait(10)

      joinedConns = await nls.getJoinedConnections()
      expect(joinedConns).to.have.lengthOf(1)
      expect(joinedConns).to.have.lengthOf(1)
      expect(joinedConns[0]).to.have.property('connectionId')
      expect(joinedConns[0]).to.have.property('joinedAt')
      expect(joinedConns[0]).to.have.property('data')
      expect(joinedConns[0].data).to.have.property('userId', 'my-user-id-1')

      nls.disconnect()

      await wait(10)

      expect(receivedMesssagesOnClient).to.have.a.lengthOf(2)
      expect(receivedMesssagesOnClient[0]).to.have.property('event', 'join')
      expect(receivedMesssagesOnClient[0]).to.have.property('m')
      expect(receivedMesssagesOnClient[0].m).to.have.property('connectionId')
      expect(receivedMesssagesOnClient[0].m).to.have.property('joinedAt')
      expect(receivedMesssagesOnClient[0].m).to.have.property('data')
      expect(receivedMesssagesOnClient[0].m.data).to.have.property('userId', 'my-user-id-1')
      expect(receivedMesssagesOnClient[1]).to.have.property('event', 'leave')
      expect(receivedMesssagesOnClient[1]).to.have.property('m')
      expect(receivedMesssagesOnClient[1].m).to.have.property('connectionId')
      expect(receivedMesssagesOnClient[1].m.data).to.have.property('userId', 'my-user-id-1')

      joinedConns = await nls.getJoinedConnections()
      expect(joinedConns).to.have.lengthOf(0)

      expect(receivedMesssagesOnServer).to.have.lengthOf(2)
      expect(receivedMesssagesOnServer[0]).to.have.property('event', 'presence:join')
      expect(receivedMesssagesOnServer[0]).to.have.property('payload')
      expect(receivedMesssagesOnServer[0].payload).to.be.a('string')
      expect(receivedMesssagesOnServer[1]).to.have.property('event', 'presence:leave')
    })
  })
})
