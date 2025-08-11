import Base from './Base.ts'
import { CREDENTIALS, ENCRYPTION_SETTINGS, ERROR_HANDLERS, EVENT_HANDLERS, WEBSOCKET } from './symbols.ts'
import { ItemType, JSONObj, InstanceOptions, JoinedConnections, JoinedConnection, LeavedConnection } from './types.ts'

/**
 * WebSocket-enabled functionality for real-time communication and presence features.
 *
 * @remarks
 * Extends the Base class with WebSocket capabilities including:
 * - Real-time messaging between connected clients
 * - Presence awareness (join/leave notifications)
 * - Live data synchronization events (setItem/removeItem)
 * - Event-driven architecture with automatic encryption/decryption
 */
export default class WebSocketFunctions extends Base {
  /** @internal Whether this instance has joined the presence channel */
  private hasJoined: boolean

  /** @internal Array of error handlers for WebSocket errors */
  private [ERROR_HANDLERS]: ((error: Error) => void)[]

  /** @internal The WebSocket connection instance */
  private [WEBSOCKET]?: WebSocket

  /** @internal Event handlers registry for proper cleanup */
  private [EVENT_HANDLERS]: Map<string, Set<{ handler: Function, wsListener?: Function, itemName?: string }>> = new Map()

  /**
   * Create a WebSocketFunctions instance with string ID.
   * @param credentials - API credentials containing apiKey, apiSecret, and projectId.
   * @param id - Optional unique identifier for this instance.
   */
  constructor (
    credentials: {
      apiKey?: string,
      apiSecret?: string,
      accessToken?: string,
      projectId: string
    },
    id?: string
  )
  /**
   * Create a WebSocketFunctions instance with options.
   * @param credentials - API credentials containing apiKey, apiSecret, and projectId.
   * @param options - Instance configuration options.
   */
  constructor (
    credentials: {
      apiKey?: string,
      apiSecret?: string,
      accessToken?: string,
      projectId: string
    },
    options?: InstanceOptions
  )
  /**
   * Create a WebSocketFunctions instance.
   * @param credentials - API credentials containing apiKey, apiSecret, and projectId.
   * @param idOrOptions - Either a string ID or instance options object.
   */
  constructor (
    credentials: {
      apiKey?: string,
      apiSecret?: string,
      accessToken?: string,
      projectId: string
    },
    idOrOptions?: string | InstanceOptions | undefined
  ) {
    // @ts-ignore
    super(credentials, idOrOptions)
    this.hasJoined = false
    this[ERROR_HANDLERS] = []
    this[EVENT_HANDLERS] = new Map()
  }

  /**
   * Send a message to the server or other clients.
   *
   * @param msg - The message object to send.
   * @param options - Transport options (WebSocket or HTTP).
   * @throws Error if encryption is configured but getEncryptionSettings() not called.
   *
   * @remarks
   * Messages are automatically encrypted if encryption is configured.
   * WebSocket transport is preferred for real-time delivery, but HTTP can be used as fallback.
   *
   * @example
   * ```typescript
   * await instance.send({ type: 'chat', message: 'Hello everyone!' });
   * // Send via HTTP instead of WebSocket
   * await instance.send({ data: 'important' }, { transport: 'http' });
   * ```
   */
  async send (msg: JSONObj, options: { transport?: 'ws' | 'http' } = { transport: 'ws' }): Promise<undefined> {
    if (this.getEncryptionHandler && !this.encryptionHandler) throw new Error('Call getEncryptionSettings() first!')

    const msgToSend = this.encryptionHandler ? await this.encryptionHandler.encrypt(JSON.stringify(msg)) : msg

    if (options.transport === 'http') {
      try {
        await this.request('POST', `/message/${this.class}/${this.id}`, msgToSend)
      } catch (e) {
        if (!e || (e as any)?.cause?.name !== 'ConflictError') throw e
        this.logger.log('warn', 'Your local keyVersion does not match! Will attempt to fetch the new encryption settings...')
        await this.getEncryptionSettings()
        await this.request('POST', `/message/${this.class}/${this.id}`, msgToSend)
      }
      return
    }

    const ws = this.getWebSocket()
    const wrappedMsg = { event: 'message', payload: msgToSend }
    if (this[ENCRYPTION_SETTINGS] && this[ENCRYPTION_SETTINGS]?.keyVersion > -1) (wrappedMsg as any).keyVersion = this[ENCRYPTION_SETTINGS]?.keyVersion
    // coming on ws:// connection via protocols
    // if (this.idSignature && this.idSignatureKeyVersion !== undefined) {
    //   ;(wrappedMsg as any).idSignature = this.idSignature
    //   ;(wrappedMsg as any).idSignatureKeyVersion = this.idSignatureKeyVersion
    // }
    ws.send(JSON.stringify(wrappedMsg))
  }

  /**
   * Register an event handler for WebSocket connection events.
   * @param event - The 'connect' event name.
   * @param handler - Function to call when connected.
   */
  on (event: 'connect', handler: () => void): any
  /**
   * Register an event handler for WebSocket disconnection events.
   * @param event - The 'disconnect' event name.
   * @param handler - Function to call when disconnected.
   */
  on (event: 'disconnect', handler: () => void): any
  /**
   * Register an event handler for presence join events.
   * @param event - The 'presence:join' event name.
   * @param handler - Function to call when a connection joins.
   */
  on (event: 'presence:join', handler: (joinedConnection: JoinedConnection) => void): any
  /**
   * Register an event handler for presence leave events.
   * @param event - The 'presence:leave' event name.
   * @param handler - Function to call when a connection leaves.
   */
  on (event: 'presence:leave', handler: (leavedConnection: LeavedConnection) => void): any
  /**
   * Register an event handler for incoming messages.
   * @param event - The 'message' event name.
   * @param handler - Function to call when a message is received.
   */
  on (event: 'message', handler: (data: JSONObj) => void): any
  /**
   * Register an event handler for WebSocket errors.
   * @param event - The 'error' event name.
   * @param handler - Function to call when an error occurs.
   */
  on (event: 'error', handler: (error: Error) => void): any
  /**
   * Register an event handler for all setItem events.
   * @param event - The 'setItem' event name.
   * @param handler - Function to call when any item is set.
   */
  on (event: 'setItem', handler: (item: ItemType & { prop: string }) => void): any
  /**
   * Register an event handler for specific setItem events.
   * @param event - The 'setItem' event name.
   * @param name - The specific item name to listen for.
   * @param handler - Function to call when the named item is set.
   */
  on (event: 'setItem', name: string, handler: (item: ItemType & { prop: string }) => void): any
  /**
   * Register an event handler for all removeItem events.
   * @param event - The 'removeItem' event name.
   * @param handler - Function to call when any item is removed.
   */
  on (event: 'removeItem', handler: (item: { prop: string }) => void): any
  /**
   * Register an event handler for specific removeItem events.
   * @param event - The 'removeItem' event name.
   * @param name - The specific item name to listen for.
   * @param handler - Function to call when the named item is removed.
   */
  on (event: 'removeItem', name: string, handler: (item: { prop: string }) => void): any
  /**
   * Register event handlers for various WebSocket events.
   *
   * @param event - The event name to listen for.
   * @param handlerOrName - Either an event handler function or a specific item name.
   * @param handler - Optional handler function when handlerOrName is a string.
   * @throws Error if no event handler is provided.
   *
   * @remarks
   * Supports listening to:
   * - Connection events: 'connect', 'disconnect', 'error'
   * - Presence events: 'presence:join', 'presence:leave'
   * - Data events: 'setItem', 'removeItem' (with optional item name filtering)
   * - Custom messages: 'message'
   *
   * All encrypted data is automatically decrypted before passing to handlers.
   *
   * @example
   * ```typescript
   * // Listen for connection events
   * instance.on('connect', () => console.log('Connected!'));
   *
   * // Listen for all setItem events
   * instance.on('setItem', (item) => console.log('Item changed:', item));
   *
   * // Listen for specific item changes
   * instance.on('setItem', 'username', (item) => console.log('Username changed:', item.value));
   * ```
   */
  on (
    event: string,
    handlerOrName: ((item: ItemType & { prop: string }) => void) | ((name: string) => void) | (() => void) | ((error: Error) => void) | ((data: JSONObj) => void) | ((joinedConnection: JoinedConnection) => void) | ((leavedConnection: LeavedConnection) => void) | string,
    handler?: ((item: ItemType & { prop: string }) => void) | (() => void) | ((name: string) => void) | ((error: Error) => void) | ((data: JSONObj) => void)
  ) {
    const ws = this.getWebSocket()

    // Initialize event set if it doesn't exist
    if (!this[EVENT_HANDLERS].has(event)) this[EVENT_HANDLERS].set(event, new Set())
    const eventSet = this[EVENT_HANDLERS].get(event)!

    if (event === 'error') {
      if (typeof handlerOrName !== 'function') throw new Error('No event handler defined!')
      const hndl = handlerOrName as (e: Error) => void
      this[ERROR_HANDLERS].push(hndl)
      const wsListener = (evt: any) => {
        // Handle cases where evt might not have a message property or is undefined
        try {
          const errorMessage = evt?.message || evt?.data || evt?.type || (typeof evt === 'string' ? evt : 'WebSocket error occurred')
          hndl(new Error(errorMessage))
        } catch (e) {
          // Fallback if something goes wrong with error handling
          hndl(new Error('WebSocket error occurred'))
        }
      }
      ws.addEventListener('error', wsListener)
      eventSet.add({ handler: hndl, wsListener })
    }

    if (event === 'connect') {
      if (typeof handlerOrName !== 'function') throw new Error('No event handler defined!')
      const hndl = handlerOrName as () => void
      const wsListener = () => hndl()
      ws.addEventListener('open', wsListener)
      eventSet.add({ handler: hndl, wsListener })
    }

    if (event === 'disconnect') {
      if (typeof handlerOrName !== 'function') throw new Error('No event handler defined!')
      const hndl = handlerOrName as () => void
      const wsListener = () => hndl()
      ws.addEventListener('close', wsListener)
      eventSet.add({ handler: hndl, wsListener })
    }

    const maybeDecryptAndHandle = (msg: any, hndl: any, completePayload: boolean = false) => {
      const keyVersion = completePayload ? msg.keyVersion : msg.payload.keyVersion
      if (keyVersion === undefined) return hndl(msg.payload)
      if (keyVersion > -1) {
        if (!this.getEncryptionHandler) return this[ERROR_HANDLERS].forEach((h: (e: Error) => void) => h(new Error('Encrypted data, but no passphrase or getEncryptionHandler configured!')))
        if (!this.encryptionHandler) return this[ERROR_HANDLERS].forEach((h: (e: Error) => void) => h(new Error('Encrypted data, but getEncryptionSettings() not called!')))

        let toDec = msg.payload.value
        if (completePayload) toDec = msg.payload
        this.getEncryptionHandlerForKeyVersion(keyVersion)
          .then((encryptionHandler) => encryptionHandler?.decrypt(toDec))
          .then((decrypted) => {
            if (completePayload) {
              msg.payload = JSON.parse(decrypted as string)
            } else {
              msg.payload.value = JSON.parse(decrypted as string)
            }
            hndl(msg.payload)
          })
          .catch((err) => {
            this[ERROR_HANDLERS].forEach((h: (e: Error) => void) => h(err))
          })
      }
    }

    if (event === 'message') {
      if (typeof handlerOrName !== 'function') throw new Error('No event handler defined!')
      const hndl = handlerOrName as (msg: JSONObj) => void
      const wsListener = (evt: MessageEvent) => {
        const msg = JSON.parse(evt.data)
        if (msg.event === 'message') {
          maybeDecryptAndHandle(msg, hndl, true)
        }
      }
      ws.addEventListener('message', wsListener)
      eventSet.add({ handler: hndl, wsListener })
    }

    if (event === 'presence:join') {
      if (typeof handlerOrName !== 'function') throw new Error('No event handler defined!')
      const hndl = handlerOrName as (joinedConnection: JoinedConnection) => void
      const wsListener = (evt: MessageEvent) => {
        const msg = JSON.parse(evt.data)
        if (msg.event === 'presence:join') {
          maybeDecryptAndHandle(msg, (p: any) => {
            hndl({
              connectionId: (msg as any)?.connectionId,
              joinedAt: (msg as any)?.joinedAt,
              data: p
            })
          }, true)
        }
      }
      ws.addEventListener('message', wsListener)
      eventSet.add({ handler: hndl, wsListener })
    }

    if (event === 'presence:leave') {
      if (typeof handlerOrName !== 'function') throw new Error('No event handler defined!')
      const hndl = handlerOrName as (leavedConnection: LeavedConnection) => void
      const wsListener = (evt: MessageEvent) => {
        const msg = JSON.parse(evt.data)
        if (msg.event === 'presence:leave') {
          maybeDecryptAndHandle(msg, (p: any) => {
            hndl({
              connectionId: (msg as any)?.connectionId,
              data: p
            })
          }, true)
        }
      }
      ws.addEventListener('message', wsListener)
      eventSet.add({ handler: hndl, wsListener })
    }

    if (event === 'setItem') {
      if (typeof handler === 'undefined') {
        if (typeof handlerOrName !== 'function') throw new Error('No event handler defined!')
        const hndl = handlerOrName as (item: ItemType & { prop: string }) => void
        const wsListener = (evt: MessageEvent) => {
          const msg = JSON.parse(evt.data)
          if (msg.event === 'setItem') maybeDecryptAndHandle(msg, hndl)
        }
        ws.addEventListener('message', wsListener)
        eventSet.add({ handler: hndl, wsListener })
      } else {
        if (typeof handler !== 'function') throw new Error('No event handler defined!')
        const hndl = handler as (item: ItemType & { prop: string }) => void
        const name = handlerOrName as string
        const wsListener = (evt: MessageEvent) => {
          const msg = JSON.parse(evt.data)
          if (msg.event === 'setItem' && msg.payload.prop === name) maybeDecryptAndHandle(msg, hndl)
        }
        ws.addEventListener('message', wsListener)
        eventSet.add({ handler: hndl, wsListener, itemName: name })
      }
    }

    if (event === 'removeItem') {
      if (typeof handler === 'undefined') {
        if (typeof handlerOrName !== 'function') throw new Error('No event handler defined!')
        const hndl = handlerOrName as (prop: { prop: string }) => void
        const wsListener = (evt: MessageEvent) => {
          const msg = JSON.parse(evt.data)
          if (msg.event === 'removeItem') hndl(msg.payload)
        }
        ws.addEventListener('message', wsListener)
        eventSet.add({ handler: hndl, wsListener })
      } else {
        if (typeof handler !== 'function') throw new Error('No event handler defined!')
        const hndl = handler as (prop: { prop: string }) => void
        const name = handlerOrName as string
        const wsListener = (evt: MessageEvent) => {
          const msg = JSON.parse(evt.data)
          if (msg.event === 'removeItem' && msg.payload.prop === name) hndl(msg.payload)
        }
        ws.addEventListener('message', wsListener)
        eventSet.add({ handler: hndl, wsListener, itemName: name })
      }
    }
  }

  /**
   * Remove an event handler for WebSocket connection events.
   * @param event - The 'connect' event name.
   * @param handler - Function to remove.
   */
  off (event: 'connect', handler: () => void): any
  /**
   * Remove an event handler for WebSocket disconnection events.
   * @param event - The 'disconnect' event name.
   * @param handler - Function to remove.
   */
  off (event: 'disconnect', handler: () => void): any
  /**
   * Remove an event handler for presence join events.
   * @param event - The 'presence:join' event name.
   * @param handler - Function to remove.
   */
  off (event: 'presence:join', handler: (joinedConnection: JoinedConnection) => void): any
  /**
   * Remove an event handler for presence leave events.
   * @param event - The 'presence:leave' event name.
   * @param handler - Function to remove.
   */
  off (event: 'presence:leave', handler: (leavedConnection: LeavedConnection) => void): any
  /**
   * Remove an event handler for incoming messages.
   * @param event - The 'message' event name.
   * @param handler - Function to remove.
   */
  off (event: 'message', handler: (data: JSONObj) => void): any
  /**
   * Remove an event handler for WebSocket errors.
   * @param event - The 'error' event name.
   * @param handler - Function to remove.
   */
  off (event: 'error', handler: (error: Error) => void): any
  /**
   * Remove an event handler for all setItem events.
   * @param event - The 'setItem' event name.
   * @param handler - Function to remove.
   */
  off (event: 'setItem', handler: (item: ItemType & { prop: string }) => void): any
  /**
   * Remove an event handler for specific setItem events.
   * @param event - The 'setItem' event name.
   * @param name - The specific item name.
   * @param handler - Function to remove.
   */
  off (event: 'setItem', name: string, handler: (item: ItemType & { prop: string }) => void): any
  /**
   * Remove an event handler for all removeItem events.
   * @param event - The 'removeItem' event name.
   * @param handler - Function to remove.
   */
  off (event: 'removeItem', handler: (item: { prop: string }) => void): any
  /**
   * Remove an event handler for specific removeItem events.
   * @param event - The 'removeItem' event name.
   * @param name - The specific item name.
   * @param handler - Function to remove.
   */
  off (event: 'removeItem', name: string, handler: (item: { prop: string }) => void): any
  /**
   * Remove event handlers for various WebSocket events.
   *
   * @param event - The event name to stop listening for.
   * @param handlerOrName - Either an event handler function or a specific item name.
   * @param handler - Optional handler function when handlerOrName is a string.
   *
   * @remarks
   * Removes previously registered event listeners. This properly cleans up
   * all event types including message-based events by maintaining an internal
   * registry of handlers and their corresponding WebSocket listeners.
   *
   * @example
   * ```typescript
   * const connectHandler = () => console.log('Connected!');
   * instance.on('connect', connectHandler);
   * // Later, remove the handler
   * instance.off('connect', connectHandler);
   *
   * const itemHandler = (item) => console.log('Item changed:', item);
   * instance.on('setItem', 'username', itemHandler);
   * // Remove specific item handler
   * instance.off('setItem', 'username', itemHandler);
   * ```
   */
  off (
    event: string,
    handlerOrName: ((item: ItemType & { prop: string }) => void) | ((name: string) => void) | (() => void) | ((error: Error) => void) | ((data: JSONObj) => void) | ((joinedConnection: JoinedConnection) => void) | ((leavedConnection: LeavedConnection) => void) | string,
    handler?: ((item: ItemType & { prop: string }) => void) | (() => void) | ((name: string) => void) | ((error: Error) => void) | ((data: JSONObj) => void)
  ) {
    const eventSet = this[EVENT_HANDLERS].get(event)
    if (!eventSet) return

    if (event === 'error') {
      if (typeof handlerOrName !== 'function') throw new Error('No event handler defined!')
      const hndl = handlerOrName as (e: Error) => void

      // Remove from error handlers array
      const index = this[ERROR_HANDLERS].indexOf(hndl)
      if (index > -1) {
        this[ERROR_HANDLERS].splice(index, 1)
      }

      // Find and remove from registry
      for (const entry of eventSet) {
        if (entry.handler === hndl) {
          if (this[WEBSOCKET] && entry.wsListener) {
            this[WEBSOCKET].removeEventListener('error', entry.wsListener as EventListener)
          }
          eventSet.delete(entry)
          break
        }
      }
    } else {
      // For all other events
      if (!this[WEBSOCKET]) return
      const ws = this[WEBSOCKET]

      // Determine the target handler and item name (if applicable)
      let targetHandler: Function
      let targetItemName: string | undefined

      if (typeof handler === 'undefined') {
        if (typeof handlerOrName !== 'function') throw new Error('No event handler defined!')
        targetHandler = handlerOrName
      } else {
        if (typeof handler !== 'function') throw new Error('No event handler defined!')
        targetHandler = handler
        targetItemName = handlerOrName as string
      }

      // Find matching entry in registry
      for (const entry of eventSet) {
        const handlerMatches = entry.handler === targetHandler
        const itemNameMatches = targetItemName === undefined || entry.itemName === targetItemName

        if (handlerMatches && itemNameMatches) {
          // Remove WebSocket listener
          if (entry.wsListener) {
            const wsEventName = event === 'connect'
              ? 'open'
              : event === 'disconnect'
                ? 'close'
                : event === 'error' ? 'error' : 'message'
            ws.removeEventListener(wsEventName, entry.wsListener as EventListener)
          }

          // Remove from registry
          eventSet.delete(entry)
          break
        }
      }
    }

    // Clean up empty event sets
    if (eventSet.size === 0) {
      this[EVENT_HANDLERS].delete(event)
    }
  }

  /**
   * Close the WebSocket connection and clean up resources.
   *
   * @remarks
   * If the instance has joined the presence channel, it will automatically
   * leave before disconnecting. This ensures proper cleanup and notifies
   * other clients of the departure. All event handlers are also cleaned up.
   */
  disconnect () {
    if (!this[WEBSOCKET]) return
    if (this.hasJoined) {
      this.leave()
    }
    this[WEBSOCKET].close()
    delete this[WEBSOCKET]

    // Clear all event handlers
    this[EVENT_HANDLERS].clear()
    this[ERROR_HANDLERS].length = 0
  }

  /**
   * Get or create the WebSocket connection.
   * @internal
   * @returns The active WebSocket instance.
   *
   * @remarks
   * Creates a new connection if one doesn't exist. Handles authentication
   * via query parameters and sets up automatic cleanup on close.
   */
  getWebSocket (): WebSocket {
    if (this[WEBSOCKET]) return this[WEBSOCKET]

    const wsBasePath = WebSocketFunctions.basePath.replace('http', 'ws')

    const basicAuthHeader = (this[CREDENTIALS].apiKey && this[CREDENTIALS].apiSecret) ? `Basic ${btoa(`${this[CREDENTIALS].apiKey}:${this[CREDENTIALS].apiSecret}`)}` : undefined
    const bearerAuthHeader = this.accessToken ? `Bearer ${this[CREDENTIALS].accessToken}` : undefined
    const authHeader = this[CREDENTIALS].accessToken ? bearerAuthHeader : basicAuthHeader

    const qs: any = { auth: authHeader }
    if (this.idSignature) {
      qs.idSignature = this.idSignature
      if (this.idSignatureKeyVersion !== undefined) {
        qs.idSignatureKeyVersion = this.idSignatureKeyVersion
      }
    }
    const queryParams = new URLSearchParams(qs as any)
    const ws = this[WEBSOCKET] = new WebSocket(`${wsBasePath}/project/${this[CREDENTIALS].projectId}/ws/${this.class}/${this.id}?${queryParams}`)

    // const protocols = [
    //   this[CREDENTIALS].accessToken
    //     ? encodeURIComponent(bearerAuthHeader)
    //     : encodeURIComponent(basicAuthHeader)
    // ]
    // if (this.idSignature) {
    //   protocols.push(encodeURIComponent(`X-Id-Sig ${this.idSignature}`))
    //   if (this.idSignatureKeyVersion !== undefined) {
    //     protocols.push(encodeURIComponent(`X-Id-Sig-KV ${this.idSignatureKeyVersion.toString()}`))
    //   }
    // }
    // const ws = this[WEBSOCKET] = new WebSocket(
    //   `${wsBasePath}/project/${this[CREDENTIALS].projectId}/ws/${this.class}/${this.id}`,
    //   protocols
    // )
    ws.addEventListener('close', () => {
      delete this[WEBSOCKET]
      if (this.hasJoined) this.hasJoined = false
    })
    return ws
  }

  /**
   * Join the presence channel to announce this connection to others.
   *
   * @param data - Optional data to associate with this connection.
   * @throws Error if encryption is configured but getEncryptionSettings() not called.
   *
   * @remarks
   * After joining, this connection will:
   * - Appear in getJoinedConnections() results for other clients
   * - Trigger 'presence:join' events for other connected clients
   * - Automatically send 'presence:leave' when disconnecting
   *
   * @example
   * ```typescript
   * await instance.join({
   *   username: 'Alice',
   *   status: 'online',
   *   avatar: 'avatar1.png'
   * });
   * ```
   */
  async join (data: JSONObj): Promise<undefined> {
    this.hasJoined = true
    if (this.getEncryptionHandler && !this.encryptionHandler) throw new Error('Call getEncryptionSettings() first!')

    const dataToSend = this.encryptionHandler ? await this.encryptionHandler.encrypt(JSON.stringify(data)) : data

    const ws = this.getWebSocket()
    const msg = { event: 'presence:join', payload: dataToSend }
    if (this[ENCRYPTION_SETTINGS] && this[ENCRYPTION_SETTINGS]?.keyVersion > -1) (msg as any).keyVersion = this[ENCRYPTION_SETTINGS]?.keyVersion
    ws.send(JSON.stringify(msg))
  }

  /**
   * Leave the presence channel.
   *
   * @remarks
   * Notifies other connected clients that this connection has left.
   * This is automatically called when disconnecting if the connection
   * had previously joined.
   */
  async leave (): Promise<undefined> {
    if (!this.hasJoined) return
    this.hasJoined = false

    const ws = this.getWebSocket()
    const msg = { event: 'presence:leave' }
    if (this[ENCRYPTION_SETTINGS] && this[ENCRYPTION_SETTINGS]?.keyVersion > -1) (msg as any).keyVersion = this[ENCRYPTION_SETTINGS]?.keyVersion
    ws.send(JSON.stringify(msg))
  }

  /**
   * Get a list of all currently connected clients in the presence channel.
   *
   * @returns Promise resolving to an array of connected clients with their data.
   * @throws Error if encryption is configured but getEncryptionSettings() not called.
   *
   * @remarks
   * Each connection object includes:
   * - connectionId: Unique identifier for the connection
   * - joinedAt: Timestamp when the connection joined
   * - data: Custom data provided when joining (automatically decrypted)
   *
   * @example
   * ```typescript
   * const connections = await instance.getJoinedConnections();
   * console.log(`${connections.length} users online`);
   * connections.forEach(conn => {
   *   console.log(`User: ${conn.data.username}, joined: ${new Date(conn.joinedAt)}`);
   * });
   * ```
   */
  async getJoinedConnections (): Promise<JoinedConnections> {
    if (this.getEncryptionHandler && !this.encryptionHandler) throw new Error('Call getEncryptionSettings() first!')
    let response
    try {
      response = await this.request('GET', `/presence-list/${this.class}/${this.id}`)
    } catch (e) {
      if (!e || (e as any)?.cause?.name !== 'ConflictError') throw e
      this.logger.log('warn', 'Your local keyVersion does not match! Will attempt to fetch the new encryption settings...')
      await this.getEncryptionSettings()
      response = await this.request('GET', `/presence-list/${this.class}/${this.id}`)
    }

    const joined = response as any[]
    return Promise.all(joined?.map(async (c) => {
      const encryptionHandler = await this.getEncryptionHandlerForKeyVersion(c.keyVersion as number)
      const data = encryptionHandler ? JSON.parse(await encryptionHandler.decrypt(c.data as string)) : c.data
      return {
        connectionId: c.connectionId,
        joinedAt: c.joinedAt,
        data
      }
    }) || [])
  }
}
