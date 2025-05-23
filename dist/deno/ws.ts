import Base from './base'
import { ItemType, JSONObj } from './types'

export default class WebSocketFunctions extends Base {
  constructor (credentials: { apiKey: string, apiSecret: string, projectId: string }, id?: string, options?: { passphrase?: string }) {
    super(credentials, id, options && { passphrase: options?.passphrase })
  }

  async send (msg: JSONObj, options: { transport?: 'ws' | 'http' } = { transport: 'ws' }): Promise<undefined> {
    // @ts-ignore
    if (this.passphrase && !this.symKey) throw new Error('Call init() first!')

    if (options.transport === 'http') {
      // @ts-ignore
      await this.request('POST', `/message/${this.id}`, msg, this?.metadata?.keyVersion)
      return
    }
    const ws = this.getWebSocket()

    const wrappedMsg = { event: 'message', payload: msg }
    // @ts-ignore
    if (this?.metadata?.keyVersion) wrappedMsg.keyVersion = this?.metadata?.keyVersion
    ws.send(JSON.stringify(wrappedMsg))
  }

  on (event: 'connect', handler: () => void): any
  on (event: 'disconnect', handler: () => void): any
  on (event: 'message', handler: (data: JSONObj) => void): any
  on (event: 'error', handler: (error: Error) => void): any
  on (event: 'setItem', handler: (item: ItemType & { prop: string }) => void): any
  on (event: 'setItem', name: string, handler: (item: ItemType & { prop: string }) => void): any
  on (event: 'removeItem', handler: (item: { prop: string }) => void): any
  on (event: 'removeItem', name: string, handler: (item: { prop: string }) => void): any
  on (
    event: string,
    handlerOrName: ((item: ItemType & { prop: string }) => void) | ((name: string) => void) | (() => void) | ((error: Error) => void) | ((data: JSONObj) => void) | string,
    handler?: ((item: ItemType & { prop: string }) => void) | (() => void) | ((name: string) => void) | ((error: Error) => void) | ((data: JSONObj) => void)
  ) {
    const ws = this.getWebSocket()

    if (event === 'error') {
      if (typeof handlerOrName !== 'function') throw new Error('No event handler defined!')
      const hndl = handlerOrName as (e: Error) => void
      ws.addEventListener('error', (evt: any) => hndl(new Error(evt?.message)))
    }

    if (event === 'connect') {
      if (typeof handlerOrName !== 'function') throw new Error('No event handler defined!')
      const hndl = handlerOrName as () => void
      ws.addEventListener('open', () => hndl())
    }

    if (event === 'disconnect') {
      if (typeof handlerOrName !== 'function') throw new Error('No event handler defined!')
      const hndl = handlerOrName as () => void
      ws.addEventListener('close', () => hndl())
    }

    if (event === 'message') {
      if (typeof handlerOrName !== 'function') throw new Error('No event handler defined!')
      const hndl = handlerOrName as (msg: JSONObj) => void
      ws.addEventListener('message', (evt) => {
        const msg = JSON.parse(evt.data)
        if (msg.event === 'message') hndl(msg.payload)
      })
    }

    if (event === 'setItem') {
      if (typeof handler === 'undefined') {
        if (typeof handlerOrName !== 'function') throw new Error('No event handler defined!')
        const hndl = handlerOrName as (item: ItemType & { prop: string }) => void
        ws.addEventListener('message', (evt) => {
          const msg = JSON.parse(evt.data)
          if (msg.event === 'setItem') hndl(msg.payload)
        })
      } else {
        if (typeof handler !== 'function') throw new Error('No event handler defined!')
        const hndl = handler as (item: ItemType & { prop: string }) => void
        const name = handlerOrName
        ws.addEventListener('message', (evt) => {
          const msg = JSON.parse(evt.data)
          if (msg.event === 'setItem' && msg.payload.prop === name) hndl(msg.payload)
        })
      }
    }

    if (event === 'removeItem') {
      if (typeof handler === 'undefined') {
        if (typeof handlerOrName !== 'function') throw new Error('No event handler defined!')
        const hndl = handlerOrName as (prop: { prop: string }) => void
        ws.addEventListener('message', (evt) => {
          const msg = JSON.parse(evt.data)
          if (msg.event === 'removeItem') hndl(msg.payload)
        })
      } else {
        if (typeof handler !== 'function') throw new Error('No event handler defined!')
        const hndl = handler as (prop: { prop: string }) => void
        const name = handlerOrName
        ws.addEventListener('message', (evt) => {
          const msg = JSON.parse(evt.data)
          if (msg.event === 'removeItem' && msg.payload.prop === name) hndl(msg.payload)
        })
      }
    }
  }

  disconnect () {
    // @ts-ignore
    if (!this.ws) return
    // @ts-ignore
    this.ws.close()
    // @ts-ignore
    delete this.ws
  }

  getWebSocket (): WebSocket {
    // @ts-ignore
    if (this.ws) return this.ws

    const wsBasePath = WebSocketFunctions.basePath.replace('http', 'ws')
    // @ts-ignore
    const ws = this.ws = new WebSocket(`${wsBasePath}/project/${this.credentials.projectId}/ws/${this.id}`, encodeURIComponent(`Basic ${btoa(`${this.credentials.apiKey}:${this.credentials.apiSecret}`)}`))
    ws.addEventListener('close', () => {
      // @ts-ignore
      delete this.ws
    })
    return ws
  }
}
