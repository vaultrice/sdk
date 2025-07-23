import { vi } from 'vitest'
import { NonLocalStorage } from '../../../src/index'
import { WebSocket, Server } from 'mock-socket'
import conns from './connectionsMock'
import uuid from '../../../src/uuidv4'
import { CREDENTIALS, WEBSOCKET } from '../../../src/symbols'

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
      let connectionId

      // Find which connection this socket belongs to
      Object.keys(ws).forEach((projectIdAndClass) => {
        if (connectionId) return
        const s = projectIdAndClass.split(':')
        projectId = s[0]
        className = s[1]
        Object.keys(ws[projectIdAndClass]).forEach((id) => {
          if (connectionId) return
          Object.keys(ws[projectIdAndClass][id]).forEach((apiKey) => {
            if (connectionId) return
            if (ws[projectIdAndClass][id][apiKey].connectionId === socket.connectionId) {
              objectId = id
              connectionId = socket.connectionId
            }
          })
        })
      })

      if (!connectionId) return

      const conInfo = conns[`${projectId}:${className}`][objectId].find((c) => c.connectionId === connectionId)
      if (!conInfo) return

      socket.on('message', (data) => {
        const parsedData = JSON.parse(data)

        if (parsedData.event === 'presence:join') {
          // Update the connection info with join data
          conInfo.data = parsedData.payload
          conInfo.joinedAt = Date.now()
          conInfo.keyVersion = parsedData.keyVersion

          // Broadcast to ALL WebSocket connections for this server (like the real implementation)
          server.emit('message', JSON.stringify({
            event: parsedData.event,
            connectionId: conInfo.connectionId,
            joinedAt: conInfo.joinedAt,
            keyVersion: conInfo.keyVersion,
            payload: parsedData.payload
          }))
        }

        if (parsedData.event === 'presence:leave') {
          const leavePayload = {
            event: parsedData.event,
            connectionId: conInfo.connectionId,
            keyVersion: conInfo.keyVersion,
            payload: conInfo.data
          }

          // Broadcast to ALL WebSocket connections for this server (like the real implementation)
          server.emit('message', JSON.stringify(leavePayload))

          // Remove the join data from this connection
          delete conInfo.data
          delete conInfo.joinedAt
          delete conInfo.keyVersion
        }

        if (parsedData.event === 'message') {
          const roomKey = `${projectId}:${className}`

          // Broadcast to OTHER WebSocket connections in the same room (exclude sender)
          if (ws[roomKey] && ws[roomKey][objectId]) {
            Object.keys(ws[roomKey][objectId]).forEach(apiKey => {
              const wsConnection = ws[roomKey][objectId][apiKey]
              if (wsConnection &&
                  wsConnection.readyState === WebSocket.OPEN &&
                  wsConnection.connectionId !== socket.connectionId) { // Exclude sender
                // Create a message event and dispatch it directly to the WebSocket
                const messageEvent = new MessageEvent('message', {
                  data: JSON.stringify({
                    event: parsedData.event,
                    payload: parsedData.payload,
                    keyVersion: parsedData.keyVersion
                  })
                })

                // Dispatch the event directly to trigger the message handlers
                wsConnection.dispatchEvent(messageEvent)
              } else if (wsConnection.connectionId === socket.connectionId) {
                console.log(`Skipping sender connection ${wsConnection.connectionId}`)
              }
            })
          } else {
            console.log('No room connections found for broadcasting')
          }
        }
      })
    })
    return server
  }

  const mock = vi.spyOn(NonLocalStorage.prototype, 'getWebSocket').mockImplementation(
    function (): WebSocket {
      const roomKey = `${this[CREDENTIALS].projectId}:${this.class}`
      const apiKey = this[CREDENTIALS].apiKey

      ws[roomKey] ||= {}
      ws[roomKey][this.id] ||= {}

      // Use apiKey to separate different clients connecting to the same room
      if (ws[roomKey][this.id][apiKey]) return ws[roomKey][this.id][apiKey]

      ws[roomKey][this.id][apiKey] = new WebSocket('ws://localhost:1234')
      this[WEBSOCKET] = ws[roomKey][this.id][apiKey]

      conns[roomKey] ||= {}
      conns[roomKey][this.id] ||= []

      const connectionId = uuid()
      conns[roomKey][this.id].push({ connectionId })
      ws[roomKey][this.id][apiKey].connectionId = connectionId

      return ws[roomKey][this.id][apiKey]
    }
  )

  return () => mock.mockRestore()
}
