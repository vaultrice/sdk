import Base from './Base'
import { CREDENTIALS, ENCRYPTION_SETTINGS, ERROR_HANDLERS, EVENT_HANDLERS, WEBSOCKET } from './symbols'
import { ItemType, JSONObj, InstanceOptions, JoinedConnections, JoinedConnection, LeavedConnection, Credentials } from './types'

// const inMemoryResumeStore: { [key: string]: string } = {}

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
  * Whether automatic reconnection is enabled for the WebSocket.
  * If true, the client will attempt to reconnect on unexpected disconnects.
  * Controlled via InstanceOptions.connectionSettings.autoReconnect.
  */
  private autoReconnect: boolean

  /**
  * Number of consecutive reconnection attempts made after a disconnect.
  * Used for exponential backoff calculation.
  */
  private reconnectAttempts: number = 0

  /**
  * Base delay (in milliseconds) for exponential backoff between reconnect attempts.
  * Controlled via InstanceOptions.connectionSettings.reconnectBaseDelay.
  */
  private reconnectBaseDelay: number = 1000

  /**
  * Maximum delay (in milliseconds) for exponential backoff between reconnect attempts.
  * Controlled via InstanceOptions.connectionSettings.reconnectMaxDelay.
  */
  private reconnectMaxDelay: number = 60000

  /**
  * Stores the last join data used for presence channel re-joining after reconnect.
  * Used to automatically re-join with the same data after a successful reconnection.
  */
  private lastJoinData?: JSONObj

  /**
  * Indicates if the WebSocket connection is currently established.
  * True if connected, false otherwise.
  */
  public isConnected: boolean = false

  /**
   * Interval in milliseconds between WebSocket ping messages to keep the connection alive.
   *
   * @default 20000
   *
   * @remarks
   * The client will send a ping message at this interval. If a pong response is not received within the pongTimeout, the connection will be closed and a reconnect will be attempted if autoReconnect is enabled.
   */
  private pingInterval: number = 20000

  /**
   * Timeout in milliseconds to wait for a pong response after sending a ping.
   *
   * @default 10000
   *
   * @remarks
   * If a pong response is not received within this timeout after a ping, the connection will be considered lost and closed.
   */
  private pongTimeout: number = 10000

  /** @internal Timer reference for periodic ping messages. */
  private pingTimer?: ReturnType<typeof setInterval>

  /** @internal Timer reference for pong response timeout. */
  private pongTimer?: ReturnType<typeof setTimeout>

  /** @internal Storage key for connection resume token. */
  // private resumeStorageKey?: string

  /** @internal connectionId for connection resume token. */
  private connectionId?: string

  /**
   * Create a WebSocketFunctions instance with string ID.
   * @param credentials - API credentials containing apiKey, apiSecret, and projectId.
   * @param id - Optional unique identifier for this instance.
   */
  constructor (
    credentials: Credentials,
    id?: string
  )
  /**
   * Create a WebSocketFunctions instance with options.
   * @param credentials - API credentials containing apiKey, apiSecret, and projectId.
   * @param options - Instance configuration options.
   */
  constructor (
    credentials: Credentials,
    options?: InstanceOptions
  )
  /**
   * Create a WebSocketFunctions instance.
   * @param credentials - API credentials containing apiKey, apiSecret, and projectId.
   * @param idOrOptions - Either a string ID or instance options object.
   */
  constructor (
    credentials: Credentials,
    idOrOptions?: string | InstanceOptions | undefined
  ) {
    // @ts-ignore
    super(credentials, idOrOptions)
    this.hasJoined = false
    this[ERROR_HANDLERS] = []
    this[EVENT_HANDLERS] = new Map()

    const opts = typeof idOrOptions === 'object' ? idOrOptions : {}
    this.autoReconnect = opts.connectionSettings?.autoReconnect ?? true
    this.reconnectBaseDelay = opts.connectionSettings?.reconnectBaseDelay ?? 1000
    this.reconnectMaxDelay = opts.connectionSettings?.reconnectMaxDelay ?? 30000
    this.pingInterval = opts.connectionSettings?.pingInterval ?? 20000
    this.pongTimeout = opts.connectionSettings?.pongTimeout ?? 10000
    // this.resumeStorageKey = `vaultrice:ws:${this[CREDENTIALS].projectId}:${this.class}:${this.id}`
  }

  /**
   * Send a message to the server or other clients.
   *
   * @param msg - The message object to send.
   * @param options - Transport options (WebSocket or HTTP).
   * @throws Error if encryption is configured but getEncryptionSettings() not called.
   *
   * @remarks
   * - If `transport: 'ws'` (WebSocket), the message is delivered to other clients but **not echoed back to the sender**. The sender will not receive their own message via `on('message')`.
   * - If `transport: 'http'`, the message is delivered to all clients **including the sender**. The sender will receive their own message via `on('message')`.
   * - Messages are automatically encrypted if encryption is configured.
   * - WebSocket transport is preferred for real-time delivery, but HTTP can be used as fallback.
   *
   * @example
   * ```typescript
   * // Message sent via WebSocket (not received by sender)
   * await instance.send({ type: 'chat', message: 'Hello!' });
   *
   * // Message sent via HTTP (received by sender)
   * await instance.send({ type: 'chat', message: 'Hello!' }, { transport: 'http' });
   *
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

    const ws = await this.getWebSocket()
    try {
      await this.throttleManager.throttleOperation()
    } catch (error: any) {
      this.logger.log('error', `WebSocket message throttled: ${error?.message}`)
      throw error
    }
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
    this.getWebSocket(false).then((ws) => {
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
    })
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
   * Opens the WebSocket connection.
   *
   * @remarks
   * Does usually not need to be used, since the WebSocke connection is automatically established on WS feature usage.
   */
  async connect () {
    if (this[WEBSOCKET]) return
    await this.getWebSocket()
  }

  /**
   * Close the WebSocket connection and clean up resources.
   *
   * @remarks
   * If the instance has joined the presence channel, it will automatically
   * leave before disconnecting. This ensures proper cleanup and notifies
   * other clients of the departure. All event handlers are also cleaned up.
   */
  async disconnect () {
    this.autoReconnect = false
    if (!this[WEBSOCKET]) return

    if (this.hasJoined) await this.leave()

    this[WEBSOCKET].close()
    delete this[WEBSOCKET]

    // Clear all event handlers
    this[EVENT_HANDLERS].clear()
    this[ERROR_HANDLERS].length = 0
  }

  /**
   * Get or create the WebSocket connection.
   * @internal
   * @param waitForOpen - If `true` (default), returns a Promise that resolves only when the WebSocket connection is fully open.
   *                      If `false`, returns the WebSocket instance immediately (may not be open yet).
   * @returns {Promise<WebSocket>} The active WebSocket instance, or a Promise resolving to it when open.
   *
   * @remarks
   * - If a connection does not exist, a new one is created.
   * - Handles authentication via query parameters and sets up automatic cleanup on close.
   * - Use `waitForOpen = true` if you need to ensure the connection is established before proceeding.
   *
   * @example
   * ```typescript
   * // Returns immediately (WebSocket may not be open yet)
   * const ws = await instance.getWebSocket(false);
   *
   * // Waits for the connection to be open before resolving
   * const ws = await instance.getWebSocket(true);
   * ```
   */
  async getWebSocket (waitForOpen: boolean = true): Promise<WebSocket> {
    if (!this[CREDENTIALS].accessToken && this.isGettingAccessToken) await this.isGettingAccessToken

    if (this[WEBSOCKET]) return this[WEBSOCKET]

    const wsBasePath = WebSocketFunctions.basePath.replace('http', 'ws')

    const basicAuthHeader = (this[CREDENTIALS].apiKey && this[CREDENTIALS].apiSecret) ? `Basic ${btoa(`${this[CREDENTIALS].apiKey}:${this[CREDENTIALS].apiSecret}`)}` : undefined
    const bearerAuthHeader = this[CREDENTIALS].accessToken ? `Bearer ${this[CREDENTIALS].accessToken}` : undefined
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
    this.logger.log('info', 'initializing WebSocket connection...')

    // control message handler — processed before user-level message handlers (safe to run in addition)
    const controlMessageHandler = (evt: MessageEvent) => {
      let parsed: any
      try {
        // only parse string messages (the DO sends JSON text), ignore non-json payloads
        parsed = typeof evt.data === 'string' ? JSON.parse(evt.data) : undefined
      } catch (e) {
        parsed = undefined
      }
      if (!parsed || typeof parsed !== 'object') return

      const evName = parsed.event
      if (!evName) return

      // EXACT match with server auto-response 'pong'
      if (evName === 'pong') {
        // Received pong (possibly from CF edge auto-response) — keep connection alive
        this.logger.log('debug', 'received pong')
        // record last time we got a pong
        // ;(this as any).lastPongAt = Date.now()
        // clear the pong timer
        this.clearPongTimer()
        // prevent user listeners from receiving this control message
        if (typeof (evt as any).stopImmediatePropagation === 'function') {
          try { (evt as any).stopImmediatePropagation() } catch (_) {}
        }
        return
      }

      // Server-side handshake: record/refresh assigned connectionId
      if ((evName === 'connected' || evName === 'resume:ack') && parsed.connectionId) {
        this.connectionId = parsed.connectionId
        // optionally notify user-level 'connected' or 'resume:ack' events:
        // we don't add a custom event emitter; consumers can listen to message events if desired
        // prevent user handlers from getting the handshake messages
        if (typeof (evt as any).stopImmediatePropagation === 'function') {
          try { (evt as any).stopImmediatePropagation() } catch (_) {}
        }
        return
      }

      // Optional: server-side rejection for invalid resume tokens
      // Some servers will close with code 1008; some will reply with an error JSON + close.
      if (evName === 'error') {
        const payload = parsed.payload
        if (typeof payload === 'string' && payload.toLowerCase().includes('invalid resume')) {
          this.logger.log('warn', 'server signalled invalid resume token — clearing saved connectionId')
          this.connectionId = undefined
          if (typeof (evt as any).stopImmediatePropagation === 'function') {
            try { (evt as any).stopImmediatePropagation() } catch (_) {}
          }
        }
      }
    }

    // Attach control handler BEFORE other message listeners so it can process pongs and handshake first:
    ws.addEventListener('message', controlMessageHandler)

    let resolveConnect: Function
    const openProm = new Promise<WebSocket>((resolve) => {
      resolveConnect = resolve
    })
    // When socket opens: send resume if we have a saved connectionId, start heartbeat
    ws.addEventListener('open', () => {
      this.isConnected = true
      this.reconnectAttempts = 0
      if (this.connectionId) {
        // send an immediate resume handshake (server expects: { event: 'resume', connectionId })
        try { ws.send(JSON.stringify({ event: 'resume', connectionId: this.connectionId })) } catch (_) {}
      }
      // start the heartbeat
      this.startHeartbeat()
      if (typeof resolveConnect === 'function') resolveConnect(ws)
    }, { once: true })

    // When socket closes: stop heartbeat and keep your existing reconnect behavior
    ws.addEventListener('close', (ev) => {
      this.isConnected = false
      this.stopHeartbeat()
      // server rejected resume token: clear saved resume id so next connect creates a fresh session
      // if (ev?.code === 1008) {
      //   this.logger.log('warn', 'WebSocket closed with 1008 — clearing saved resume token')
      //   this.connectionId = undefined
      // }
    }, { once: true })

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
    ws.addEventListener('close', (ev) => {
      if (ev?.code === 1008) {
        this.logger.log('warn', 'WebSocket closed with 1008 during reconnection')
        this.connectionId = undefined
      }
      if (ev?.reason && ev?.reason.indexOf('TierLimitExceeded') > -1) {
        this.autoReconnect = false
        this.logger.log('error', ev.reason)
        this[ERROR_HANDLERS].forEach((h: (e: Error) => void) => h(new Error(ev.reason)))
      }
      delete this[WEBSOCKET]
      const wasJoined = this.hasJoined
      const lastJoinData = this.lastJoinData
      if (this.hasJoined) this.hasJoined = false

      if (this.autoReconnect) {
        const tryReconnect = async () => {
          const delay = Math.min(
            this.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts),
            this.reconnectMaxDelay
          )
          setTimeout(async () => {
            this.reconnectAttempts++
            this.logger.log('warn', `${this.reconnectAttempts}. reconnection attempt...`)
            let ws: WebSocket | undefined
            try {
              delete this[WEBSOCKET]
              ws = await this.getWebSocket(false)
            } catch (e: any) {
              this.logger.log('error', e?.message || e?.name || e?.type || e)
              tryReconnect()
              return
            }

            const wireUpAgain = async () => {
              this.reconnectAttempts = 0
              // Reattach all event handlers
              if (!this[WEBSOCKET]) return
              const ws = this[WEBSOCKET]
              // Reattach EVENT_HANDLERS
              for (const [event, handlers] of this[EVENT_HANDLERS]) {
                for (const entry of handlers) {
                  let wsListener: EventListener | undefined
                  if (event === 'connect') {
                    wsListener = () => entry.handler()
                    ws.addEventListener('open', wsListener)
                  } else if (event === 'disconnect') {
                    wsListener = () => entry.handler()
                    ws.addEventListener('close', wsListener)
                  } else if (event === 'error') {
                    wsListener = (evt: any) => {
                      try {
                        const errorMessage = evt?.message || evt?.data || evt?.type || (typeof evt === 'string' ? evt : 'WebSocket error occurred')
                        entry.handler(new Error(errorMessage))
                      } catch (e) {
                        entry.handler(new Error('WebSocket error occurred'))
                      }
                    }
                    ws.addEventListener('error', wsListener)
                  } else if (event === 'message') {
                    wsListener = (evt: Event) => {
                      let msg: any
                      try {
                        msg = typeof (evt as MessageEvent).data === 'string' ? JSON.parse((evt as MessageEvent).data) : undefined
                      } catch { msg = undefined }
                      if (!msg) return
                      if (msg.event === 'message') entry.handler(msg.payload)
                    }
                    ws.addEventListener('message', wsListener)
                  } else if (event === 'presence:join') {
                    wsListener = (evt: Event) => {
                      let msg: any
                      try {
                        msg = typeof (evt as MessageEvent).data === 'string' ? JSON.parse((evt as MessageEvent).data) : undefined
                      } catch { msg = undefined }
                      if (!msg) return
                      if (msg.event === 'presence:join') entry.handler(msg.payload)
                    }
                    ws.addEventListener('message', wsListener)
                  } else if (event === 'presence:leave') {
                    wsListener = (evt: Event) => {
                      let msg: any
                      try {
                        msg = typeof (evt as MessageEvent).data === 'string' ? JSON.parse((evt as MessageEvent).data) : undefined
                      } catch { msg = undefined }
                      if (!msg) return
                      if (msg.event === 'presence:leave') entry.handler(msg.payload)
                    }
                    ws.addEventListener('message', wsListener)
                  } else if (event === 'setItem') {
                    wsListener = (evt: Event) => {
                      let msg: any
                      try {
                        msg = typeof (evt as MessageEvent).data === 'string' ? JSON.parse((evt as MessageEvent).data) : undefined
                      } catch { msg = undefined }
                      if (!msg) return
                      if (msg.event === 'setItem') {
                        if (!entry.itemName || msg.payload.prop === entry.itemName) entry.handler(msg.payload)
                      }
                    }
                    ws.addEventListener('message', wsListener)
                  } else if (event === 'removeItem') {
                    wsListener = (evt: Event) => {
                      let msg: any
                      try {
                        msg = typeof (evt as MessageEvent).data === 'string' ? JSON.parse((evt as MessageEvent).data) : undefined
                      } catch { msg = undefined }
                      if (!msg) return
                      if (msg.event === 'removeItem') {
                        if (!entry.itemName || msg.payload.prop === entry.itemName) entry.handler(msg.payload)
                      }
                    }
                    ws.addEventListener('message', wsListener)
                  }
                  // Update wsListener reference for future removal
                  if (wsListener) entry.wsListener = wsListener
                }
              }
              // Call 'connect' event handlers
              const connectHandlers = this[EVENT_HANDLERS].get('connect')
              if (connectHandlers) {
                for (const entry of connectHandlers) {
                  try {
                    entry.handler()
                  } catch (e: any) {
                    // Optionally log or handle errors
                    this.logger.log('error', e)
                  }
                }
              }
              if (wasJoined && lastJoinData) {
                await this.join(lastJoinData)
              }
            }

            // Always attach listeners, regardless of state
            const removeListeners = () => {
              ws?.removeEventListener('open', openListener)
              ws?.removeEventListener('close', closeListener)
              ws?.removeEventListener('error', errorListener)
            }
            const openListener = async () => {
              await wireUpAgain()
              removeListeners()
            }
            const closeListener = () => {
              removeListeners()
              tryReconnect()
            }
            const errorListener = (e: any) => {
              this.logger.log('error', e?.message || e?.name || e?.type || e)
              removeListeners()
              tryReconnect()
            }
            ws.addEventListener('open', openListener, { once: true })
            ws.addEventListener('close', closeListener, { once: true })
            ws.addEventListener('error', errorListener, { once: true })

            // If ws is closed or closing, retry immediately
            if (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
              tryReconnect()
              return
            }

            // If ws is open, join and reset attempts
            if (ws.readyState === WebSocket.OPEN) {
              await wireUpAgain()
              removeListeners()
            }
          }, delay)
        }
        tryReconnect()
      }
    })
    if (waitForOpen) return openProm
    return ws
  }

  /**
   * Clears the pong response timeout timer.
   *
   * @remarks
   * This stops waiting for a pong response from the server. Should be called
   * whenever a pong is received or when the heartbeat is stopped.
   */
  private clearPongTimer () {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer)
      this.pongTimer = undefined
    }
  }

  /**
   * Starts the pong response timeout timer.
   *
   * @remarks
   * If a pong response is not received within the configured timeout (`pongTimeout`),
   * the WebSocket connection will be closed and a reconnect will be triggered if enabled.
   */
  private startPongTimer () {
    this.clearPongTimer()
    this.pongTimer = setTimeout(() => {
      this.logger.log('warn', 'pong timeout — closing socket to reconnect')
      try { this[WEBSOCKET]?.close(1006, 'pong timeout') } catch (_) {}
      // onclose cleans up and starts reconnect logic
    }, this.pongTimeout)
  }

  /**
   * Stops the heartbeat mechanism.
   *
   * @remarks
   * Clears both the periodic ping timer and the pong timeout timer.
   * Should be called when the WebSocket connection is closed or lost.
   */
  private stopHeartbeat () {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = undefined
    }
    this.clearPongTimer()
  }

  /**
   * Starts the heartbeat mechanism to keep the WebSocket connection alive.
   *
   * @remarks
   * Sends periodic ping messages at the configured interval (`pingInterval`).
   * Each ping starts a pong timeout timer. If a pong is not received in time,
   * the connection will be closed and a reconnect will be attempted if enabled.
   */
  private startHeartbeat () {
    this.stopHeartbeat()
    const ws = this[WEBSOCKET]
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ event: 'ping' })) // must match the DO's WebSocketRequestResponsePair request exactly
        // start a pong timeout; if no pong arrives -> onPongTimeout
        this.startPongTimer()
      } catch (e) {
      /* ignore send error, close will follow */
      }
    }
    this.pingTimer = setInterval(() => {
      const wsInner = this[WEBSOCKET]
      if (!wsInner || wsInner.readyState !== WebSocket.OPEN) return
      try {
        wsInner.send(JSON.stringify({ event: 'ping' }))
        this.startPongTimer()
      } catch (e) {
      /* ignore send error, close will follow */
      }
    }, this.pingInterval)
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
    if (this.getEncryptionHandler && !this.encryptionHandler) throw new Error('Call getEncryptionSettings() first!')

    try {
      await this.throttleManager.throttleOperation()
    } catch (error: any) {
      this.logger.log('error', `Request throttled: ${error?.message}`)
      throw error
    }

    this.hasJoined = true
    this.lastJoinData = data

    const dataToSend = this.encryptionHandler ? await this.encryptionHandler.encrypt(JSON.stringify(data)) : data

    const ws = await this.getWebSocket()
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

    try {
      await this.throttleManager.throttleOperation()
    } catch (error: any) {
      this.logger.log('error', `Request throttled: ${error?.message}`)
      throw error
    }

    this.hasJoined = false

    const ws = await this.getWebSocket()
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
