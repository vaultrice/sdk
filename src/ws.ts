import Base from './base'
import { ItemType, JSONObj } from './types'
import { encrypt, decrypt } from './encryption'

export default class WebSocketFunctions extends Base {
  constructor (credentials: { apiKey: string, apiSecret: string, projectId: string }, id?: string, options?: { passphrase?: string }) {
    super(credentials, id, options && { passphrase: options?.passphrase })
    // @ts-ignore
    this.errorHandlers = []
  }

  async send (msg: JSONObj, options: { transport?: 'ws' | 'http' } = { transport: 'ws' }): Promise<undefined> {
    // @ts-ignore
    if (this.passphrase && !this.symKey) throw new Error('Call init() first!')

    // @ts-ignore
    const msgToSend = this.symKey ? await encrypt(this.symKey, JSON.stringify(msg)) : msg

    if (options.transport === 'http') {
      // @ts-ignore
      await this.request('POST', `/message/${this.id}`, msgToSend, this?.metadata?.keyVersion)
      return
    }

    const ws = this.getWebSocket()
    const wrappedMsg = { event: 'message', payload: msgToSend }
    // @ts-ignore
    if (this?.metadata?.keyVersion > -1) wrappedMsg.keyVersion = this?.metadata?.keyVersion
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
      // @ts-ignore
      this.errorHandlers.push(hndl)
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
      const maybeDecryptAndHandle = (msg: any, hndl: any) => {
        if (msg.keyVersion === undefined) return hndl(msg.payload)
        if (msg.keyVersion > -1) {
          // @ts-ignore
          if (!this.passphrase) return this.errorHandlers.map((h) => h(new Error('Encrypted data, but no passhprase configured!')))
          // @ts-ignore
          if (!this.symKey) return this.errorHandlers.map((h) => h(new Error('Encrypted data, but init() not called!')))
          // @ts-ignore
          if (msg.keyVersion !== this?.metadata?.keyVersion) return this.errorHandlers.map((h) => h(new Error('Wrong keyVersion! Call init() again!')))
          // @ts-ignore
          decrypt(this.symKey, msg.payload).then((decrypted) => {
            msg.payload = JSON.parse(decrypted)
            hndl(msg.payload)
          }).catch((err) => {
            // @ts-ignore
            this.errorHandlers.map((h) => h(err))
          })
        }
      }
      if (typeof handlerOrName !== 'function') throw new Error('No event handler defined!')
      const hndl = handlerOrName as (msg: JSONObj) => void
      ws.addEventListener('message', (evt) => {
        const msg = JSON.parse(evt.data)
        if (msg.event === 'message') {
          maybeDecryptAndHandle(msg, hndl)
        }
      })
    }

    if (event === 'setItem') {
      const maybeDecryptAndHandle = (msg: any, hndl: any) => {
        if (msg.keyVersion === undefined) return hndl(msg.payload)
        if (msg.keyVersion > -1) {
          // @ts-ignore
          if (!this.passphrase) return this.errorHandlers.map((h) => h(new Error('Encrypted data, but no passhprase configured!')))
          // @ts-ignore
          if (!this.symKey) return this.errorHandlers.map((h) => h(new Error('Encrypted data, but init() not called!')))
          // @ts-ignore
          if (msg.keyVersion !== this?.metadata?.keyVersion) return this.errorHandlers.map((h) => h(new Error('Wrong keyVersion! Call init() again!')))
          // @ts-ignore
          decrypt(this.symKey, msg.payload.value).then((decrypted) => {
            msg.payload.value = JSON.parse(decrypted)
            hndl(msg.payload)
          }).catch((err) => {
            // @ts-ignore
            this.errorHandlers.map((h) => h(err))
          })
        }
      }
      if (typeof handler === 'undefined') {
        if (typeof handlerOrName !== 'function') throw new Error('No event handler defined!')
        const hndl = handlerOrName as (item: ItemType & { prop: string }) => void
        ws.addEventListener('message', (evt) => {
          const msg = JSON.parse(evt.data)
          if (msg.event === 'setItem') maybeDecryptAndHandle(msg, hndl)
        })
      } else {
        if (typeof handler !== 'function') throw new Error('No event handler defined!')
        const hndl = handler as (item: ItemType & { prop: string }) => void
        const name = handlerOrName
        ws.addEventListener('message', (evt) => {
          const msg = JSON.parse(evt.data)
          if (msg.event === 'setItem' && msg.payload.prop === name) maybeDecryptAndHandle(msg, hndl)
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
