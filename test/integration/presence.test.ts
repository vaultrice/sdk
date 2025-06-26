import { describe, it, expect, beforeAll } from 'vitest'
import { NonLocalStorage } from '../../src/index'
import Base from '../../src/Base'
import uuidv4 from '../../src/uuidv4'
import { setTimeout as wait } from 'node:timers/promises'

describe(`NonLocalStorage WS (${process.env.MODE})`, () => {
  const basePath = process.env.BASE_PATH as string
  const apiKey = process.env.API_KEY as string
  const apiSecret = process.env.API_SECRET as string
  const projectId = process.env.PROJECT_ID as string
  const className = process.env.CLASS_NAME as string

  beforeAll(() => {
    // @ts-ignore
    Base.basePath = basePath
  })

  describe('websocket part usage (messages)', () => {
    it('should work as expected', async () => {
      const id = uuidv4()
      const nls1 = new NonLocalStorage({ apiKey, apiSecret, projectId }, { id, class: className })
      nls1.on('error', (e) => {
        console.log('error', e)
      })
      // nls1.on('disconnect', () => {
      //   console.log('disconnected')
      // })
      const receivedMesssagesOnClient1: any[] = []
      nls1.on('presence:join', (m) => {
        receivedMesssagesOnClient1.push({ event: 'join', m })
      })
      nls1.on('presence:leave', (m) => {
        receivedMesssagesOnClient1.push({ event: 'leave', m })
      })

      await new Promise<void>((resolve) => {
        nls1.on('connect', () => {
          // console.log('connected')
          resolve()
        })
      })

      let joinedConns = await nls1.getJoinedConnections()
      expect(joinedConns).to.have.lengthOf(0)

      await nls1.join({ userId: 'my-user-id-1' })

      await wait(500)

      joinedConns = await nls1.getJoinedConnections()
      expect(joinedConns).to.have.lengthOf(1)
      expect(joinedConns[0]).to.have.property('connectionId')
      expect(joinedConns[0]).to.have.property('joinedAt')
      expect(joinedConns[0]).to.have.property('data')
      expect(joinedConns[0].data).to.have.property('userId', 'my-user-id-1')

      const nls2 = new NonLocalStorage({ apiKey, apiSecret, projectId }, { id, class: className })
      const receivedMesssagesOnClient2: any[] = []
      nls2.on('presence:join', (m) => {
        receivedMesssagesOnClient2.push({ event: 'join', m })
      })
      nls2.on('presence:leave', (m) => {
        receivedMesssagesOnClient2.push({ event: 'leave', m })
      })
      await new Promise<void>((resolve) => {
        nls2.on('connect', () => {
          // console.log('connected')
          resolve()
        })
      })

      nls1.disconnect()

      await wait(500)

      joinedConns = await nls1.getJoinedConnections()
      expect(joinedConns).to.have.lengthOf(0)

      expect(receivedMesssagesOnClient1).to.have.lengthOf(1)
      expect(receivedMesssagesOnClient1[0]).to.have.property('event', 'join')
      expect(receivedMesssagesOnClient1[0]).to.have.property('m')
      expect(receivedMesssagesOnClient1[0].m).to.have.property('connectionId')
      expect(receivedMesssagesOnClient1[0].m).to.have.property('joinedAt')
      expect(receivedMesssagesOnClient1[0].m).to.have.property('data')
      expect(receivedMesssagesOnClient1[0].m.data).to.have.property('userId', 'my-user-id-1')
      expect(receivedMesssagesOnClient2).to.have.lengthOf(1)
      expect(receivedMesssagesOnClient2[0]).to.have.property('event', 'leave')
      expect(receivedMesssagesOnClient2[0].m).to.have.property('connectionId')
      expect(receivedMesssagesOnClient2[0].m).to.have.property('data')
      expect(receivedMesssagesOnClient2[0].m.data).to.have.property('userId', 'my-user-id-1')
    })
  })
})
