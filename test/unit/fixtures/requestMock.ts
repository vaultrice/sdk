import { vi } from 'vitest'
import Base from '../../../src/Base'
import { NonLocalStorage } from '../../../src/index'
import { JSONObj } from '../../../src/types'
import { setImmediate } from 'node:timers/promises'
import conns from './connectionsMock'
import { CREDENTIALS, ENCRYPTION_SETTINGS } from '../../../src/symbols'

const metadata = {}
const objects = {}

function generateDummyJWT (payload) {
  const header = {
    jti: 'bla bla bla',
    alg: 'ES512',
    kid: 'v0'
  }

  // Base64URL encode a JSON object
  const base64UrlEncode = (obj) => {
    return Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=/g, '')        // Remove padding
      .replace(/\+/g, '-')      // Replace + with -
      .replace(/\//g, '_')      // Replace / with _
  }

  const encodedHeader = base64UrlEncode(header)
  const encodedPayload = base64UrlEncode(payload)
  const dummySignature = base64UrlEncode('dummysignature123') // This can be any string

  return `${encodedHeader}.${encodedPayload}.${dummySignature}`
}

export default () => {
  const mock = vi.spyOn(Base.prototype, 'request').mockImplementation(
    async function (method: string, path: string, body?: JSONObj | string | string[]): Promise<string | string[] | JSONObj | undefined> {
      await setImmediate()
      const keyVersion = this[ENCRYPTION_SETTINGS]?.keyVersion
      const pathParts = path.split('/')
      // const className = pathParts[2]
      const objectId = pathParts[3]

      // getAccessToken()
      if (pathParts[1] === 'auth' && pathParts[2] === 'token') {
        return generateDummyJWT({
          sub: this[CREDENTIALS].apiKey,
          iss: 'NonLocalStorage-Api',
          exp: Date.now() + (1 * 60 * 60 * 1000), // 1h
          id: this[CREDENTIALS].apiKey,
          accountId: 'some-dummy-accountId',
          projectId: this[CREDENTIALS].projectId,
          iat: Math.round(Date.now() / 1000)
        })
      }

      // getEncryptionSettings()
      if (pathParts[1] === 'cache-encryption') {
        metadata[`${this[CREDENTIALS].projectId}:${this.class}`] ||= {}
        const meta = metadata[`${this[CREDENTIALS].projectId}:${this.class}`][objectId] || {}
        meta.encryptionSettings ||= {
          salt: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))),
          keyVersion: 0,
          createdAt: Date.now()
        }
        metadata[`${this[CREDENTIALS].projectId}:${this.class}`][objectId] = meta
        return meta
      }

      // rotateEncryptionSettings()
      if (pathParts[1] === 'cache-encryption-rotate') {
        metadata[`${this[CREDENTIALS].projectId}:${this.class}`] ||= {}
        const meta = metadata[`${this[CREDENTIALS].projectId}:${this.class}`][objectId] || {}
        meta.previousEncryptionSettings ||= []
        if (meta.encryptionSettings) meta.previousEncryptionSettings.push(meta.encryptionSettings)
        meta.encryptionSettings = {
          salt: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))),
          keyVersion: meta?.encryptionSettings?.keyVersion > -1 ? (meta?.encryptionSettings?.keyVersion + 1) : 0,
          createdAt: meta?.encryptionSettings?.createdAt || Date.now()
        }
        metadata[`${this[CREDENTIALS].projectId}:${this.class}`][objectId] = meta
        return meta
      }

      // getItem()
      if (pathParts[1] === 'cache' && pathParts.length === 5 && method === 'GET') {
        const propName = pathParts[4]
        objects[`${this[CREDENTIALS].projectId}:${this.class}`] ||= {}
        objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId] ||= {}
        const o = objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][propName]
        return o
      }

      // setItem()
      if (pathParts[1] === 'cache' && pathParts.length === 5 && method === 'POST') {
        const propName = pathParts[4]
        objects[`${this[CREDENTIALS].projectId}:${this.class}`] ||= {}
        objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId] ||= {}
        objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][propName] = body
        objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][propName].expiresAt = Date.now() + (objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][propName]?.ttl || 10000)
        objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][propName].keyVersion = keyVersion
        send({ event: 'setItem', payload: { prop: propName, ...objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][propName] } })
        return {
          expiresAt: (body as any)?.expiresAt,
          keyVersion
        }
      }

      // increment()
      if (pathParts[1] === 'cache' && pathParts.length === 6 && method === 'POST' && pathParts.at(-1) === 'increment') {
        const propName = pathParts[4]
        objects[`${this[CREDENTIALS].projectId}:${this.class}`] ||= {}
        objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId] ||= {}
        objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][propName] ||= {}
        objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][propName].value ||= 0
        objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][propName].value += (body as any)?.value
        if ((body as any)?.ttl) {
          objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][propName].ttl = (body as any)?.ttl
        }
        objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][propName].expiresAt = Date.now() + (objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][propName]?.ttl || 10000)
        objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][propName].keyVersion = keyVersion
        send({ event: 'setItem', payload: { prop: propName, ...objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][propName] } })
        return {
          value: objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][propName]?.value,
          expiresAt: objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][propName]?.expiresAt,
          keyVersion
        }
      }

      // decrement()
      if (pathParts[1] === 'cache' && pathParts.length === 6 && method === 'POST' && pathParts.at(-1) === 'decrement') {
        const propName = pathParts[4]
        objects[`${this[CREDENTIALS].projectId}:${this.class}`] ||= {}
        objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId] ||= {}
        objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][propName] ||= {}
        objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][propName].value ||= 0
        objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][propName].value -= (body as any)?.value
        if ((body as any)?.ttl) {
          objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][propName].ttl = (body as any)?.ttl
        }
        objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][propName].expiresAt = Date.now() + (objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][propName]?.ttl || 10000)
        objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][propName].keyVersion = keyVersion
        send({ event: 'setItem', payload: { prop: propName, ...objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][propName] } })
        return {
          value: objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][propName]?.value,
          expiresAt: objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][propName]?.expiresAt,
          keyVersion
        }
      }

      // setItems()
      if (pathParts[1] === 'cache' && pathParts.length === 4 && method === 'POST') {
        objects[`${this[CREDENTIALS].projectId}:${this.class}`] ||= {}
        objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId] ||= {}
        const r = {}
        if (body && typeof body === 'object') {
          Object.keys(body).forEach((name) => {
            objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][name] = body[name]
            let expiresAt = Date.now()
            if (typeof body[name] === 'object' && body[name] !== null && (body[name] as any).ttl) {
              expiresAt += body[name].ttl
            } else {
              expiresAt += 10000
            }
            r[name] = {
              expiresAt,
              keyVersion
            }
            send({ event: 'setItem', payload: { prop: name, value: objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][name].value, ...r[name] } })
          })
        }
        return r
      }

      // getItems()
      if (pathParts[1] === 'cache-query' && pathParts.length === 4 && method === 'POST') {
        objects[`${this[CREDENTIALS].projectId}:${this.class}`] ||= {}
        objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId] ||= {}
        const r = (body as unknown as string[]).reduce((prev, propName) => {
          prev[propName] = objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][propName]
          return prev
        }, {})
        return r
      }

      // getAllItems()
      if (pathParts[1] === 'cache' && pathParts.length === 4 && method === 'GET') {
        objects[`${this[CREDENTIALS].projectId}:${this.class}`] ||= {}
        objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId] ||= {}
        return objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId]
      }

      // getAllKeys()
      if (pathParts[1] === 'cache-keys' && pathParts.length === 4 && method === 'GET') {
        objects[`${this[CREDENTIALS].projectId}:${this.class}`] ||= {}
        objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId] ||= {}
        return Object.keys(objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId])
      }

      // removeItem()
      if (pathParts[1] === 'cache' && pathParts.length === 5 && method === 'DELETE') {
        const propName = pathParts[4]
        objects[`${this[CREDENTIALS].projectId}:${this.class}`] ||= {}
        objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId] ||= {}
        delete objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][propName]
        send({ event: 'removeItem', payload: { prop: propName } })
        return
      }

      // removeItems()
      if (pathParts[1] === 'cache' && pathParts.length === 4 && method === 'DELETE' && body) {
        objects[`${this[CREDENTIALS].projectId}:${this.class}`] ||= {}
        objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId] ||= {}
        ;(body as unknown as string[]).forEach((propName) => {
          delete objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId][propName]
          send({ event: 'removeItem', payload: { prop: propName } })
        })
        return
      }

      // clear()
      if (pathParts[1] === 'cache' && pathParts.length === 4 && method === 'DELETE' && !body) {
        objects[`${this[CREDENTIALS].projectId}:${this.class}`] ||= {}
        objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId] ||= {}
        delete objects[`${this[CREDENTIALS].projectId}:${this.class}`][objectId]
        return
      }

      // send()
      if (pathParts[1] === 'message' && pathParts.length === 4 && method === 'POST' && body) {
        send({ event: 'message', payload: body, keyVersion })
        return
      }

      // getJoinedConnections()
      if (pathParts[1] === 'presence-list' && pathParts.length === 4 && method === 'GET') {
        conns[`${this[CREDENTIALS].projectId}:${this.class}`] ||= {}
        conns[`${this[CREDENTIALS].projectId}:${this.class}`][objectId] ||= {}
        return conns[`${this[CREDENTIALS].projectId}:${this.class}`][objectId].filter((c) => (c as any)?.joinedAt)
      }

      console.error('No mock implementation for this:', {
        method,
        path,
        body
      })
      return undefined

      function send (msg) {
        if (typeof (NonLocalStorage as any).getWebSocketServer === 'function') {
          const srv = (NonLocalStorage as any).getWebSocketServer()
          srv.clients().forEach((client) => {
            client.send(JSON.stringify(msg))
          })
        }
      }
    }
  )

  return () => mock.mockRestore()
}
