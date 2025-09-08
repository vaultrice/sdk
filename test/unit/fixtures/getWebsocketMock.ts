import { vi } from 'vitest'
import { NonLocalStorage } from '../../../src/index'
import { WebSocket, Server } from 'mock-socket'
import conns from './connectionsMock'
import uuid from '../../../src/uuidv4'
import { CREDENTIALS, WEBSOCKET, EVENT_HANDLERS } from '../../../src/symbols'

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

      // If we found the matching client-side connection metadata, associate it on server-side socket
      if (!connectionId) {
        // No mapping found — we still keep socket but we can't identify it for room broadcasts
        // (possible in tests that create sockets before server mapping exists)
      } else {
        // set on the server-side socket for convenience (so we can easily compare later)
        socket.connectionId = connectionId
      }

      // Immediately notify this socket that it is connected (server DO sends this)
      if (connectionId) {
        try {
          socket.send(JSON.stringify({ event: 'connected', connectionId }))
        } catch (_) { /* ignore send errors during tests */ }
      }

      socket.on('message', (data) => {
        let parsedData
        try {
          parsedData = typeof data === 'string' ? JSON.parse(data) : undefined
        } catch (e) {
          parsedData = undefined
        }
        if (!parsedData || typeof parsedData !== 'object') return

        // PING/PONG — reply only to the sender
        if (parsedData.event === 'ping') {
          try {
            socket.send(JSON.stringify({ event: 'pong' }))
          } catch (_) {}
          return
        }

        // RESUME handshake — client requests resume with connectionId
        if (parsedData.event === 'resume' && parsedData.connectionId) {
          const resumeId = parsedData.connectionId
          // If we know about this connectionId in conns, ack it (simulate DO accept resume)
          const roomKey = `${projectId}:${className}`
          const sessions = conns[roomKey] && conns[roomKey][objectId]
          const known = sessions && sessions.find(c => c.connectionId === resumeId)
          if (known) {
            // Associate server socket with this connection id for subsequent broadcasts
            socket.connectionId = resumeId
            // ack resume only to this socket
            try { socket.send(JSON.stringify({ event: 'resume:ack', connectionId: resumeId })) } catch (_) {}
          } else {
            // unknown resume -> send error and/or close (tests may assert clearing saved token)
            try { socket.send(JSON.stringify({ event: 'error', payload: 'Invalid resume token' })) } catch (_) {}
            // optionally close the socket to simulate server rejecting resume (client will clear on close 1008)
            try { socket.close(1008, 'Invalid resume token') } catch (_) {}
          }
          return
        }

        // PRESENCE JOIN / LEAVE (same as before — update state + broadcast)
        if (parsedData.event === 'presence:join') {
          if (!projectId || !className || !objectId || !socket.connectionId) return
          const conInfo = conns[`${projectId}:${className}`][objectId].find((c) => c.connectionId === socket.connectionId)
          if (!conInfo) return

          // Update the connection info with join data
          conInfo.data = parsedData.payload
          conInfo.joinedAt = Date.now()
          conInfo.keyVersion = parsedData.keyVersion

          // Broadcast to ALL WebSocket connections for this room (like the real implementation)
          server.emit('message', JSON.stringify({
            event: parsedData.event,
            connectionId: conInfo.connectionId,
            joinedAt: conInfo.joinedAt,
            keyVersion: conInfo.keyVersion,
            payload: parsedData.payload
          }))
          return
        }

        if (parsedData.event === 'presence:leave') {
          if (!projectId || !className || !objectId || !socket.connectionId) return
          const conInfo = conns[`${projectId}:${className}`][objectId].find((c) => c.connectionId === socket.connectionId)
          if (!conInfo) return

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
          return
        }

        // MESSAGE broadcast (exclude sender)
        if (parsedData.event === 'message') {
          if (!projectId || !className || !objectId) return
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
              }
            })
          }
        }

        // fallback: ignore unknown events
      })
    })

    return server
  }

  const mock = vi.spyOn(NonLocalStorage.prototype, 'getWebSocket').mockImplementation(
    async function (waitForOpen: boolean = true): Promise<WebSocket> {
      const roomKey = `${this[CREDENTIALS].projectId}:${this.class}`
      const apiKey = this[CREDENTIALS].apiKey

      ws[roomKey] ||= {}
      ws[roomKey][this.id] ||= {}

      // Use apiKey to separate different clients connecting to the same room
      if (ws[roomKey][this.id][apiKey]) {
        if (waitForOpen) {
          // If already open, resolve immediately, else wait for open event
          if (ws[roomKey][this.id][apiKey].readyState === WebSocket.OPEN) {
            return ws[roomKey][this.id][apiKey]
          }
          return new Promise<WebSocket>((resolve) => {
            ws[roomKey][this.id][apiKey].addEventListener('open', () => {
              // this.isConnected = true
              // Don't set isConnected = true here - wait for handshake
              resolve(ws[roomKey][this.id][apiKey])
            }, { once: true })
          })
        }
        return ws[roomKey][this.id][apiKey]
      }

      ws[roomKey][this.id][apiKey] = new WebSocket('ws://localhost:1234')
      this[WEBSOCKET] = ws[roomKey][this.id][apiKey]

      let resolveConnect: Function
      const openProm = new Promise<WebSocket>((resolve) => {
        resolveConnect = resolve
      })
      this[WEBSOCKET].addEventListener('open', () => {
        // this.isConnected = true
        // Don't set isConnected = true here - wait for handshake
        if (typeof resolveConnect === 'function') resolveConnect(ws[roomKey][this.id][apiKey])
      }, { once: true })
      this[WEBSOCKET].addEventListener('close', () => {
        this.isConnected = false
      }, { once: true })

      // Set up the control message handler to process server handshake
      this[WEBSOCKET].addEventListener('message', (evt) => {
        let parsed: any
        try {
          parsed = typeof evt.data === 'string' ? JSON.parse(evt.data) : undefined
        } catch (e) {
          return
        }
        if (!parsed || typeof parsed !== 'object') return

        const evName = parsed.event
        if (!evName) return

        // Handle server handshake - set connectionId and fire connect event
        if ((evName === 'connected' || evName === 'resume:ack') && parsed.connectionId) {
          this.connectionId = parsed.connectionId
          this.isConnected = true

          // Fire the 'connect' event now that we have a connectionId
          const connectHandlers = this[EVENT_HANDLERS]?.get('connect')
          if (connectHandlers) {
            for (const entry of connectHandlers) {
              try {
                entry.handler()
              } catch (e: any) {
                this.logger?.log('error', e)
              }
            }
          }
        }
      })

      conns[roomKey] ||= {}
      conns[roomKey][this.id] ||= []

      const connectionId = uuid()
      conns[roomKey][this.id].push({ connectionId })
      ws[roomKey][this.id][apiKey].connectionId = connectionId

      return waitForOpen ? openProm : ws[roomKey][this.id][apiKey]
    }
  )

  return () => mock.mockRestore()
}
