import { vi } from 'vitest'
import NonLocalStorage from '../../src/index'
import { JSONObj } from '../../src/types'

const metadata = {}

const objects = {}

vi.spyOn(NonLocalStorage.prototype, 'request').mockImplementation(
  async function (method: string, path: string, body?: JSONObj | string | string[], keyVersion?: number | undefined): Promise<string | string[] | JSONObj | undefined> {
    const pathParts = path.split('/')
    const objectId = pathParts[2]

    // init()
    if (pathParts[1] === 'cache-meta') {
      metadata[this.credentials.projectId] ||= {}
      let meta = metadata[this.credentials.projectId][objectId]
      if (!meta) {
        meta = {
          salt: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))),
          keyVersion: 0
        }
        metadata[this.credentials.projectId][objectId] = meta
      }
      return meta
    }

    // getItem()
    if (pathParts[1] === 'cache' && pathParts.length === 4 && method === 'GET') {
      const propName = pathParts[3]
      objects[this.credentials.projectId] ||= {}
      objects[this.credentials.projectId][objectId] ||= {}
      const o = objects[this.credentials.projectId][objectId][propName]
      return o
    }

    // setItem()
    if (pathParts[1] === 'cache' && pathParts.length === 4 && method === 'POST') {
      const propName = pathParts[3]
      objects[this.credentials.projectId] ||= {}
      objects[this.credentials.projectId][objectId] ||= {}
      objects[this.credentials.projectId][objectId][propName] = body
      objects[this.credentials.projectId][objectId][propName].expiresAt = Date.now() + (objects[this.credentials.projectId][objectId][propName]?.ttl || 10000)
      delete objects[this.credentials.projectId][objectId][propName].ttl
      send({ event: 'setItem', payload: { prop: propName, ...objects[this.credentials.projectId][objectId][propName] }, keyVersion })
      return {
        // @ts-ignore
        expiresAt: body?.expiresAt
      }
    }

    // setItems()
    if (pathParts[1] === 'cache' && pathParts.length === 3 && method === 'POST') {
      objects[this.credentials.projectId] ||= {}
      objects[this.credentials.projectId][objectId] ||= {}
      const r = {}
      if (body && typeof body === 'object') {
        Object.keys(body).forEach((name) => {
          objects[this.credentials.projectId][objectId][name] = body[name]
          let expiresAt = Date.now()
          if (typeof body[name] === 'object' && body[name] !== null && (body[name] as any).ttl) {
            expiresAt += body[name].ttl
          } else {
            expiresAt += 10000
          }
          r[name] = {
            expiresAt
          }
          send({ event: 'setItem', payload: { prop: name, value: objects[this.credentials.projectId][objectId][name].value, ...r[name] }, keyVersion })
        })
      }
      return r
    }

    // getItems()
    if (pathParts[1] === 'cache-query' && pathParts.length === 3 && method === 'POST') {
      objects[this.credentials.projectId] ||= {}
      objects[this.credentials.projectId][objectId] ||= {}
      const r = (body as unknown as string[]).reduce((prev, propName) => {
        prev[propName] = objects[this.credentials.projectId][objectId][propName]
        return prev
      }, {})
      return r
    }

    // getAllItems()
    if (pathParts[1] === 'cache' && pathParts.length === 3 && method === 'GET') {
      objects[this.credentials.projectId] ||= {}
      objects[this.credentials.projectId][objectId] ||= {}
      return objects[this.credentials.projectId][objectId]
    }

    // getAllKeys()
    if (pathParts[1] === 'cache-keys' && pathParts.length === 3 && method === 'GET') {
      objects[this.credentials.projectId] ||= {}
      objects[this.credentials.projectId][objectId] ||= {}
      return Object.keys(objects[this.credentials.projectId][objectId])
    }

    // removeItem()
    if (pathParts[1] === 'cache' && pathParts.length === 4 && method === 'DELETE') {
      const propName = pathParts[3]
      objects[this.credentials.projectId] ||= {}
      objects[this.credentials.projectId][objectId] ||= {}
      delete objects[this.credentials.projectId][objectId][propName]
      send({ event: 'removeItem', payload: { prop: propName } })
      return
    }

    // removeItems()
    if (pathParts[1] === 'cache' && pathParts.length === 3 && method === 'DELETE' && body) {
      objects[this.credentials.projectId] ||= {}
      objects[this.credentials.projectId][objectId] ||= {}
      ;(body as unknown as string[]).forEach((propName) => {
        delete objects[this.credentials.projectId][objectId][propName]
        send({ event: 'removeItem', payload: { prop: propName } })
      })
      return
    }

    // clear()
    if (pathParts[1] === 'cache' && pathParts.length === 3 && method === 'DELETE' && !body) {
      objects[this.credentials.projectId] ||= {}
      objects[this.credentials.projectId][objectId] ||= {}
      delete objects[this.credentials.projectId][objectId]
      return
    }

    // send()
    if (pathParts[1] === 'message' && pathParts.length === 3 && method === 'POST' && body) {
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
      // @ts-ignore
      if (typeof NonLocalStorage.getWebSocketServer === 'function') {
        // @ts-ignore
        const srv = NonLocalStorage.getWebSocketServer()
        srv.clients().forEach((client) => {
          client.send(JSON.stringify(msg))
        })
      }
    }
  }
)
