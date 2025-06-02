import Base from './base'
import { ItemType, JSONObj } from './types'
import { encrypt, decrypt } from './encryption'

export default class WebSocketFunctions extends Base {
  constructor (credentials: { apiKey: string, apiSecret: string, projectId: string }, id?: string, options?: { passphrase?: string }) {
    super(credentials, id, options && { passphrase: options?.passphrase })
    ;(this as any).errorHandlers = []
  }

  async send (msg: JSONObj, options: { transport?: 'ws' | 'http' } = { transport: 'ws' }): Promise<undefined> {
    if ((this as any).passphrase && !(this as any).symKey) throw new Error('Call init() first!')

    const msgToSend = (this as any).symKey ? await encrypt((this as any).symKey, JSON.stringify(msg)) : msg

    if (options.transport === 'http') {
      await this.request('POST', `/message/${this.id}`, msgToSend)
      return
    }

    const ws = this.getWebSocket()
    const wrappedMsg = { event: 'message', payload: msgToSend }
    if ((this as any)?.metadata?.keyVersion > -1) (wrappedMsg as any).keyVersion = (this as any)?.metadata?.keyVersion
    if (this.signedId && this.idSignatureKeyVersion !== undefined) {
      ;(wrappedMsg as any).signedId = this.signedId
      ;(wrappedMsg as any).idSignatureKeyVersion = this.idSignatureKeyVersion
    }
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
      (this as any).errorHandlers.push(hndl)
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

    const maybeDecryptAndHandle = (msg: any, hndl: any, completePayload: boolean = false) => {
      if (msg.keyVersion === undefined) return hndl(msg.payload)
      if (msg.keyVersion > -1) {
        if (!(this as any).passphrase) return (this as any).errorHandlers.map((h: (e: Error) => {}) => h(new Error('Encrypted data, but no passhprase configured!')))
        if (!(this as any).symKey) return (this as any).errorHandlers.map((h: (e: Error) => {}) => h(new Error('Encrypted data, but init() not called!')))
        if (msg.keyVersion !== (this as any)?.metadata?.keyVersion) return (this as any).errorHandlers.map((h: (e: Error) => {}) => h(new Error('Wrong keyVersion! Call init() again!')))
        let toDec = msg.payload.value
        if (completePayload) toDec = msg.payload
        decrypt((this as any).symKey, toDec).then((decrypted) => {
          if (completePayload) {
            msg.payload = JSON.parse(decrypted)
          } else {
            msg.payload.value = JSON.parse(decrypted)
          }
          hndl(msg.payload)
        }).catch((err) => {
          (this as any).errorHandlers.map((h: (e: Error) => {}) => h(err))
        })
      }
    }

    if (event === 'message') {
      if (typeof handlerOrName !== 'function') throw new Error('No event handler defined!')
      const hndl = handlerOrName as (msg: JSONObj) => void
      ws.addEventListener('message', (evt) => {
        const msg = JSON.parse(evt.data)
        if (msg.event === 'message') {
          maybeDecryptAndHandle(msg, hndl, true)
        }
      })
    }

    if (event === 'setItem') {
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
    if (!(this as any).ws) return
    (this as any).ws.close()
    delete (this as any).ws
  }

  getWebSocket (): WebSocket {
    if ((this as any).ws) return (this as any).ws

    const wsBasePath = WebSocketFunctions.basePath.replace('http', 'ws')
    const ws = (this as any).ws = new WebSocket(`${wsBasePath}/project/${(this as any).credentials.projectId}/${this.class}/ws/${this.id}`, encodeURIComponent(`Basic ${btoa(`${(this as any).credentials.apiKey}:${(this as any).credentials.apiSecret}`)}`))
    ws.addEventListener('close', () => {
      delete (this as any).ws
    })
    return ws
  }
}
