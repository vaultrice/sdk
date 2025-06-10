import { describe, it, expect, beforeAll } from 'vitest'
import NonLocalStorage from '../../src/index'
import Base from '../../src/base'
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
      nls1.on('disconnect', () => {
        console.log('disconnected')
      })
      const receivedMesssagesOnClient1: any[] = []
      nls1.on('message', (m) => {
        receivedMesssagesOnClient1.push(m)
      })

      await new Promise<void>((resolve) => {
        nls1.on('connect', () => {
          // console.log('connected')
          resolve()
        })
      })

      await nls1.send({ hi: 'there' }, { transport: 'http' })
      expect(receivedMesssagesOnClient1).to.have.lengthOf(1)
      expect(receivedMesssagesOnClient1[0]).to.eql({ hi: 'there' })

      const nls2 = new NonLocalStorage({ apiKey, apiSecret, projectId }, { id, class: className })
      const receivedMesssagesOnClient2: any[] = []
      nls2.on('message', (m) => {
        receivedMesssagesOnClient2.push(m)
      })
      await new Promise<void>((resolve) => {
        nls2.on('connect', () => {
          // console.log('connected')
          resolve()
        })
      })

      nls1.send({ hi: 'there2' })
      await wait(500)
      expect(receivedMesssagesOnClient2).to.have.lengthOf(1)
      expect(receivedMesssagesOnClient2[0]).to.eql({ hi: 'there2' })
      expect(receivedMesssagesOnClient1).to.have.lengthOf(1)

      nls1.disconnect()
    })
  })

  describe('websocket part usage (item events)', () => {
    it('should work as expected', async () => {
      const id = uuidv4()
      const nls = new NonLocalStorage({ apiKey, apiSecret, projectId }, { id, class: className })

      nls.on('error', (e) => {
        console.log(2, e)
      })
      nls.on('disconnect', () => {
        console.log('disconnected')
      })
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
      await wait(500)
      expect(receivedMesssagesOnClient).to.have.lengthOf(0)
      expect(setItemEvts1).to.have.lengthOf(2)
      expect(setItemEvts1[0]).to.have.property('prop', 'my-prop')
      expect(setItemEvts1[0]).to.have.property('value', 'my-value')
      expect(setItemEvts1[0]).to.have.property('expiresAt')
      expect(setItemEvts1[1]).to.have.property('prop', 'my-prop-2')
      expect(setItemEvts1[1]).to.have.property('value', 'my-value-2')
      expect(setItemEvts1[1]).to.have.property('expiresAt')
      expect(setItemEvts2).to.have.lengthOf(1)
      expect(setItemEvts2[0]).to.have.property('prop', 'my-prop-2')
      expect(setItemEvts2[0]).to.have.property('value', 'my-value-2')
      expect(setItemEvts2[0]).to.have.property('expiresAt')

      // const removeItemEvts1: string[] = []
      // nls.on('removeItem', (m) => {
      //   removeItemEvts1.push(m.prop)
      // })
      // const removeItemEvts2: string[] = []
      // nls.on('removeItem', 'my-prop-2', () => {
      //   removeItemEvts2.push('my-prop-2')
      // })

      // await nls.removeItem('my-prop-2')
      // await nls.removeItems(['my-prop-3'])
      // await wait(300)
      // expect(receivedMesssagesOnClient).to.have.lengthOf(0)
      // expect(removeItemEvts1).to.have.lengthOf(1)
      // expect(removeItemEvts1).to.contain('my-prop-2')
      // expect(removeItemEvts2).to.have.lengthOf(1)
      // expect(removeItemEvts2).to.contain('my-prop-2')

      nls.disconnect()
    })
  })
})
