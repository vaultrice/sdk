import { vi } from 'vitest'
import NonLocalStorage from '../../../src/index'
import { WebSocket, Server } from 'mock-socket'

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
    return server
  }

  const mock = vi.spyOn(NonLocalStorage.prototype, 'getWebSocket').mockImplementation(
    function (): WebSocket {
      ws[`${this.credentials.projectId}:${this.class}`] ||= {}
      if (ws[`${this.credentials.projectId}:${this.class}`][this.id]) return ws[`${this.credentials.projectId}:${this.class}`][this.id]
      ws[`${this.credentials.projectId}:${this.class}`][this.id] ||= new WebSocket('ws://localhost:1234')
      return ws[`${this.credentials.projectId}:${this.class}`][this.id]
    }
  )

  return () => mock.mockRestore()
}
