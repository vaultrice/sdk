import { vi } from 'vitest'
import NonLocalStorage from '../../src/index'
import { JSONObj } from '../../src/types'

const metadata = {}

const objects = {}

vi.spyOn(NonLocalStorage.prototype, 'request').mockImplementation(
  async function (method: string, path: string, body?: JSONObj | string | string[]): Promise<string | string[] | JSONObj | undefined> {
    const keyVersion = (this as any)?.metadata?.keyVersion
    const pathParts = path.split('/')
    // const className = pathParts[2]
    const objectId = pathParts[3]

    // init()
    if (pathParts[1] === 'cache-meta') {
      metadata[`${this.credentials.projectId}:${this.class}`] ||= {}
      let meta = metadata[`${this.credentials.projectId}:${this.class}`][objectId]
      if (!meta) {
        meta = {
          salt: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))),
          keyVersion: 0
        }
        metadata[`${this.credentials.projectId}:${this.class}`][objectId] = meta
      }
      return meta
    }

    // getItem()
    if (pathParts[1] === 'cache' && pathParts.length === 5 && method === 'GET') {
      const propName = pathParts[4]
      objects[`${this.credentials.projectId}:${this.class}`] ||= {}
      objects[`${this.credentials.projectId}:${this.class}`][objectId] ||= {}
      const o = objects[`${this.credentials.projectId}:${this.class}`][objectId][propName]
      return o
    }

    // setItem()
    if (pathParts[1] === 'cache' && pathParts.length === 5 && method === 'POST') {
      const propName = pathParts[4]
      objects[`${this.credentials.projectId}:${this.class}`] ||= {}
      objects[`${this.credentials.projectId}:${this.class}`][objectId] ||= {}
      objects[`${this.credentials.projectId}:${this.class}`][objectId][propName] = body
      objects[`${this.credentials.projectId}:${this.class}`][objectId][propName].expiresAt = Date.now() + (objects[`${this.credentials.projectId}:${this.class}`][objectId][propName]?.ttl || 10000)
      delete objects[`${this.credentials.projectId}:${this.class}`][objectId][propName].ttl
      send({ event: 'setItem', payload: { prop: propName, ...objects[`${this.credentials.projectId}:${this.class}`][objectId][propName] }, keyVersion })
      return {
        expiresAt: (body as any)?.expiresAt
      }
    }

    // setItems()
    if (pathParts[1] === 'cache' && pathParts.length === 4 && method === 'POST') {
      objects[`${this.credentials.projectId}:${this.class}`] ||= {}
      objects[`${this.credentials.projectId}:${this.class}`][objectId] ||= {}
      const r = {}
      if (body && typeof body === 'object') {
        Object.keys(body).forEach((name) => {
          objects[`${this.credentials.projectId}:${this.class}`][objectId][name] = body[name]
          let expiresAt = Date.now()
          if (typeof body[name] === 'object' && body[name] !== null && (body[name] as any).ttl) {
            expiresAt += body[name].ttl
          } else {
            expiresAt += 10000
          }
          r[name] = {
            expiresAt
          }
          send({ event: 'setItem', payload: { prop: name, value: objects[`${this.credentials.projectId}:${this.class}`][objectId][name].value, ...r[name] }, keyVersion })
        })
      }
      return r
    }

    // getItems()
    if (pathParts[1] === 'cache-query' && pathParts.length === 4 && method === 'POST') {
      objects[`${this.credentials.projectId}:${this.class}`] ||= {}
      objects[`${this.credentials.projectId}:${this.class}`][objectId] ||= {}
      const r = (body as unknown as string[]).reduce((prev, propName) => {
        prev[propName] = objects[`${this.credentials.projectId}:${this.class}`][objectId][propName]
        return prev
      }, {})
      return r
    }

    // getAllItems()
    if (pathParts[1] === 'cache' && pathParts.length === 4 && method === 'GET') {
      objects[`${this.credentials.projectId}:${this.class}`] ||= {}
      objects[`${this.credentials.projectId}:${this.class}`][objectId] ||= {}
      return objects[`${this.credentials.projectId}:${this.class}`][objectId]
    }

    // getAllKeys()
    if (pathParts[1] === 'cache-keys' && pathParts.length === 4 && method === 'GET') {
      objects[`${this.credentials.projectId}:${this.class}`] ||= {}
      objects[`${this.credentials.projectId}:${this.class}`][objectId] ||= {}
      return Object.keys(objects[`${this.credentials.projectId}:${this.class}`][objectId])
    }

    // removeItem()
    if (pathParts[1] === 'cache' && pathParts.length === 5 && method === 'DELETE') {
      const propName = pathParts[4]
      objects[`${this.credentials.projectId}:${this.class}`] ||= {}
      objects[`${this.credentials.projectId}:${this.class}`][objectId] ||= {}
      delete objects[`${this.credentials.projectId}:${this.class}`][objectId][propName]
      send({ event: 'removeItem', payload: { prop: propName } })
      return
    }

    // removeItems()
    if (pathParts[1] === 'cache' && pathParts.length === 4 && method === 'DELETE' && body) {
      objects[`${this.credentials.projectId}:${this.class}`] ||= {}
      objects[`${this.credentials.projectId}:${this.class}`][objectId] ||= {}
      ;(body as unknown as string[]).forEach((propName) => {
        delete objects[`${this.credentials.projectId}:${this.class}`][objectId][propName]
        send({ event: 'removeItem', payload: { prop: propName } })
      })
      return
    }

    // clear()
    if (pathParts[1] === 'cache' && pathParts.length === 4 && method === 'DELETE' && !body) {
      objects[`${this.credentials.projectId}:${this.class}`] ||= {}
      objects[`${this.credentials.projectId}:${this.class}`][objectId] ||= {}
      delete objects[`${this.credentials.projectId}:${this.class}`][objectId]
      return
    }

    // send()
    if (pathParts[1] === 'message' && pathParts.length === 4 && method === 'POST' && body) {
      send({ event: 'message', payload: body, keyVersion })
      return
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
