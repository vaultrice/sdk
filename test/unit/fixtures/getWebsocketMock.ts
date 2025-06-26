import { vi } from 'vitest'
import { NonLocalStorage } from '../../../src/index'
import { WebSocket, Server } from 'mock-socket'
import conns from './connectionsMock'
import uuid from '../../../src/uuidv4'

const ws = {}
let server

export default () => {
  // @ts-ignore
  NonLocalStorage.getWebSocketServer = function (): WS {
    if (server) return server
    server = new Server('ws://localhost:1234')
    const originalStop = server.stop.bind(server)
    server.stop = (clb) => {
      originalStop(clb)
      server = undefined
    }
    server.on('connection', (socket) => {
      let projectId
      let className
      let objectId
      Object.keys(ws).forEach((projectIdAndClass) => {
        if (objectId) return
        const s = projectIdAndClass.split(':')
        projectId = s[0]
        className = s[1]
        Object.keys(ws[projectIdAndClass]).forEach((id) => {
          if (objectId) return
          if (ws[projectIdAndClass][id].connectionId === socket.connectionId) {
            objectId = id
          }
        })
      })
      const conInfo = conns[`${projectId}:${className}`][objectId].find((c) => c.connectionId === socket.connectionId)
      socket.on('message', (data) => {
        const parsedData = JSON.parse(data)
        if (parsedData.event === 'presence:join') {
          conInfo.data = parsedData.payload
          conInfo.joinedAt = Date.now()
          conInfo.keyVersion = parsedData.keyVersion
          server.emit('message', JSON.stringify({
            event: parsedData.event,
            connectionId: conInfo.connectionId,
            joinedAt: conInfo.joinedAt,
            keyVersion: conInfo.keyVersion,
            payload: parsedData.payload
          }))
        }
        if (parsedData.event === 'presence:leave') {
          server.emit('message', JSON.stringify({
            event: parsedData.event,
            connectionId: conInfo.connectionId,
            keyVersion: conInfo.keyVersion,
            payload: conInfo.data
          }))
          delete conInfo.data
          delete conInfo.joinedAt
          delete conInfo.keyVersion
        }
      })
    })
    return server
  }

  const mock = vi.spyOn(NonLocalStorage.prototype, 'getWebSocket').mockImplementation(
    function (): WebSocket {
      ws[`${this.credentials.projectId}:${this.class}`] ||= {}
      if (ws[`${this.credentials.projectId}:${this.class}`][this.id]) return ws[`${this.credentials.projectId}:${this.class}`][this.id]
      ws[`${this.credentials.projectId}:${this.class}`][this.id] ||= new WebSocket('ws://localhost:1234')
      ;(this as any).ws = ws[`${this.credentials.projectId}:${this.class}`][this.id]
      conns[`${this.credentials.projectId}:${this.class}`] ||= {}
      conns[`${this.credentials.projectId}:${this.class}`][this.id] ||= []
      const connectionId = uuid()
      conns[`${this.credentials.projectId}:${this.class}`][this.id].push({ connectionId })
      ws[`${this.credentials.projectId}:${this.class}`][this.id].connectionId = connectionId
      return ws[`${this.credentials.projectId}:${this.class}`][this.id]
    }
  )

  return () => mock.mockRestore()
}
