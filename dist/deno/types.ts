/**
 * Supported value types for storage.
 */
export type ValueType =
  | string
  | number
  | boolean
  | null
  | ValueType[]
  | { [key: string]: ValueType }

/**
 * Metadata returned after setting a value.
 *
 * @property expiresAt - Timestamp (ms) when the value will expire.
 * @property keyVersion - Optional version of the encryption key used.
 * @property createdAt - Timestamp (ms) when the value was created.
 * @property updatedAt - Timestamp (ms) when the value was last updated.
 */
export type SetReturnType = {
  /** expiresAt - Timestamp (ms) when the value will expire. */
  expiresAt: number,
  /** keyVersion - Optional version of the encryption key used. */
  keyVersion?: number,
  /** createdAt - Timestamp (ms) when the value was created. */
  createdAt: number,
  /** updatedAt - Timestamp (ms) when the value was last updated. */
  updatedAt: number
}

/**
 * An item as returned from storage.
 */
export type ItemType<T = ValueType> = { value: T } & SetReturnType

/**
 * Multiple items as returned from storage.
 */
export type ItemsType = Record<string, ItemType>

/**
 * Metadata for multiple set items.
 */
export type SetItemsType = Record<string, SetReturnType>

/**
 * Log levels for the SDK.
 */
export type LogLevel =
  | 'error'
  | 'warn'
  | 'info'
  | 'debug'

/**
 * JSON object type.
 */
export type JSONObjInner =
  | string
  | number
  | boolean
  | null
  | undefined
  | { [key: string]: JSONObjInner }
  | JSONObjInner[]
export type JSONObj = { [key: string]: JSONObjInner }

/**
 * Options for key derivation.
 */
export type KeyDerivationOptions = {
  /** Number of PBKDF2 iterations. @default 100000 */
  iterations?: number,
  /** Hash algorithm. @default 'SHA-512' */
  hash?: HashAlgorithmIdentifier,
  /** Key type. @default { name: 'AES-GCM', length: 256 } */
  derivedKeyType?: AesDerivedKeyParams
}

/**
 * Encryption handler interface.
 */
export type EncryptionHandler = {
  encrypt: ((v: string) => Promise<string>)
  decrypt: ((v: string) => Promise<string>)
}

/**
 * Options for NonLocalStorage/SyncObject instances.
 */
export type InstanceOptions = {
  id?: string,
  /** Storage class. @default '_undefined_' */
  class?: string,
  /** Time-to-live in milliseconds for this item. @default 3600000 (1 hour) */
  ttl?: number,
  /** Passphrase used for e2e encryption */
  passphrase?: string,
  /** Key derivation options. */
  keyDerivationOptions?: KeyDerivationOptions,
  /** Custom encryption handler. */
  getEncryptionHandler?: (encryptionSettings: EncryptionSettings) => Promise<EncryptionHandler>
  /** Auto-update old encrypted values. @default true */
  autoUpdateOldEncryptedValues?: boolean,
  /** Signature (generated in your backend) of the id. */
  idSignature?: string,
  /** Key version for the signature (generated in your backend) of the id. */
  idSignatureKeyVersion?: number,
  /** Log level. @default 'warn' */
  logLevel?: LogLevel,
  /**
   * Connection settings (mainly for WebSocket connection).
   *
   * @property autoReconnect - If true, automatically reconnect on unexpected disconnects. @default true
   * @property reconnectBaseDelay - Base delay in milliseconds for exponential backoff between reconnect attempts. @default 1000
   * @property reconnectMaxDelay - Maximum delay in milliseconds for exponential backoff between reconnect attempts. @default 60000
   */
  connectionSettings?: {
    /** If true, automatically reconnect on unexpected disconnects. @default true */
    autoReconnect?: boolean,
    /** Base delay in milliseconds for exponential backoff between reconnect attempts. @default 1000 */
    reconnectBaseDelay?: number,
    /** Maximum delay in milliseconds for exponential backoff between reconnect attempts. @default 60000 */
    reconnectMaxDelay?: number
  }
}

/**
 * Encryption settings.
 */
export type EncryptionSettings = {
  salt: Uint8Array,
  keyVersion: number,
  createdAt: number
}

/**
 * Encryption settings info, including previous versions.
 */
export type EncryptionSettingsInfos = {
  encryptionSettings: EncryptionSettings,
  previousEncryptionSettings?: EncryptionSettings[]
}

/**
 * Presence event: connection left.
 *
 * @property connectionId - Unique identifier for the connection.
 * @property data - Optional custom data associated with the connection.
 */
export type LeavedConnection = {
  connectionId: string
  data?: JSONObj
}

/**
 * Presence event: connection joined.
 *
 * @property joinedAt - Timestamp (ms) when the connection joined.
 */
export type JoinedConnection = LeavedConnection & {
  joinedAt: number
}

/**
 * List of joined connections.
 */
export type JoinedConnections = JoinedConnection[]

/**
 * Metadata for a SyncObject.
 *
 * @property id - The unique identifier for the SyncObject.
 * @property joinedConnections - List of currently joined connections.
 * @property join - Join the presence channel with custom data.
 * @property leave - Leave the presence channel.
 * @property send - Send a message to other clients.
 * @property on - Register an event handler.
 * @property off - Unregister an event handler.
 * @property useAccessToken - Set a new access token for authentication.
 * @property onAccessTokenExpiring - Register a handler for access token expiring events.
 * @property offAccessTokenExpiring - Unregister a handler for access token expiring events.
 * @property connect - Manually connect the SyncObject.
 * @property disconnect - Manually disconnect the SyncObject.
 * @property isConnected - Indicates if the SyncObject is currently connected.
 */
export interface SyncObjectMeta {
  readonly id: string
  readonly joinedConnections: JoinedConnections
  readonly join: (data: JSONObj) => Promise<undefined>
  readonly leave: () => Promise<undefined>
  readonly send: (msg: JSONObj, options?: { transport?: 'ws' | 'http' }) => Promise<undefined>
  /**
   * Register an event handler.
   *
   * @param event - The event name.
   * @param handler - The handler function.
   */
  readonly on: {
    (event: 'connect', handler: () => void): any
    (event: 'disconnect', handler: () => void): any
    (event: 'presence:join', handler: (joinedConnection: JoinedConnection) => void): any
    (event: 'presence:leave', handler: (leavedConnection: LeavedConnection) => void): any
    (event: 'message', handler: (data: JSONObj) => void): any
    (event: 'error', handler: (error: Error) => void): any
    (event: 'setItem', handler: (item: ItemType & { prop: string }) => void): any
    (event: 'setItem', name: string, handler: (item: ItemType & { prop: string }) => void): any
    (event: 'removeItem', handler: (item: { prop: string }) => void): any
    (event: 'removeItem', name: string, handler: (item: { prop: string }) => void): any
    (
      event: string,
      handlerOrName: ((item: ItemType & { prop: string }) => void) | ((name: string) => void) | (() => void) | ((error: Error) => void) | ((data: JSONObj) => void) | ((joinedConnection: JoinedConnection) => void) | ((leavedConnection: LeavedConnection) => void) | string,
      handler?: ((item: ItemType & { prop: string }) => void) | (() => void) | ((name: string) => void) | ((error: Error) => void) | ((data: JSONObj) => void)
    ): any
  }
  /**
   * Unregister an event handler.
   *
   * @param event - The event name.
   * @param handler - The handler function.
   */
  readonly off: {
    (event: 'connect', handler: () => void): any
    (event: 'disconnect', handler: () => void): any
    (event: 'presence:join', handler: (joinedConnection: JoinedConnection) => void): any
    (event: 'presence:leave', handler: (leavedConnection: LeavedConnection) => void): any
    (event: 'message', handler: (data: JSONObj) => void): any
    (event: 'error', handler: (error: Error) => void): any
    (event: 'setItem', handler: (item: ItemType & { prop: string }) => void): any
    (event: 'setItem', name: string, handler: (item: ItemType & { prop: string }) => void): any
    (event: 'removeItem', handler: (item: { prop: string }) => void): any
    (event: 'removeItem', name: string, handler: (item: { prop: string }) => void): any
    (
      event: string,
      handlerOrName: ((item: ItemType & { prop: string }) => void) | ((name: string) => void) | (() => void) | ((error: Error) => void) | ((data: JSONObj) => void) | ((joinedConnection: JoinedConnection) => void) | ((leavedConnection: LeavedConnection) => void) | string,
      handler?: ((item: ItemType & { prop: string }) => void) | (() => void) | ((name: string) => void) | ((error: Error) => void) | ((data: JSONObj) => void)
    ): any
  }
  /**
   * Set a new access token for authentication.
   *
   * @param accessToken - The new access token.
   */
  readonly useAccessToken: (accessToken: string) => void
  /**
   * Register a handler for access token expiring events.
   *
   * @param handler - The handler function.
   */
  readonly onAccessTokenExpiring: (handler: () => void) => void
  /**
   * Unregister a handler for access token expiring events.
   *
   * @param handler - The handler function.
   */
  readonly offAccessTokenExpiring: (handler: () => void) => void
  /**
   * Manually connect the SyncObject.
   */
  readonly connect: () => Promise<void>
  /**
   * Manually disconnect the SyncObject.
   */
  readonly disconnect: () => Promise<void>
  /**
   * Indicates if the SyncObject is currently connected.
   */
  readonly isConnected: boolean
}

/**
 * Interface for pluggable storage adapters.
 *
 * @remarks
 * Implement this interface to provide custom storage backends for offline sync.
 * Adapters should handle serialization and deserialization of values.
 *
 * @example
 * ```typescript
 * class MyAdapter implements StorageAdapter {
 *   async get(key: string): Promise<any | null> { ... }
 *   async set(key: string, value: any): Promise<void> { ... }
 *   async remove(key: string): Promise<void> { ... }
 *   async getAll(): Promise<Record<string, any>> { ... }
 * }
 * ```
 */
export interface StorageAdapter {
  /**
   * Retrieve a value by key.
   * @param key - The key to look up.
   * @returns The value, or null if not found.
   */
  get(key: string): Promise<any | null>
  /**
   * Store a value by key.
   * @param key - The key to store under.
   * @param value - The value to store.
   */
  set(key: string, value: any): Promise<void>
  /**
   * Remove a value by key.
   * @param key - The key to remove.
   */
  remove(key: string): Promise<void>
  /**
   * Retrieve all key-value pairs.
   * @returns An object mapping keys to values.
   */
  getAll(): Promise<Record<string, any>>
}

/**
 * Options for creating an offline sync object.
 *
 * @remarks
 * Use this interface to configure offline-first behavior, including storage backend and conflict resolution.
 *
 * @property storage - The storage adapter to use for local persistence.
 * @property resolveConflict - Optional function to resolve conflicts between local and remote items.
 *
 * @example
 * ```typescript
 * const offlineSync = await createOfflineSyncObject(credentials, {
 *   id: 'my-id',
 *   storage: new LocalStorageAdapter({ projectId, className, id }),
 *   resolveConflict: (local, remote) => {
 *     // Custom merge logic
 *     return local.updatedAt > remote.updatedAt ? local : remote
 *   }
 * })
 * ```
 */
export interface OfflineSyncOptions extends InstanceOptions {
  /**
   * The storage adapter to use for local persistence.
   * Can be an instance or a factory function/constructor.
   * If not provided, a localStorage (if available) based adapter will be used automatically.
   *
   * @remarks
   * The default localStorage adapter uses browser localStorage (if available) or an in-memory fallback.
   *
   * @example
   * ```typescript
   * // Use default localStorage
   * const offlineSync = await createOfflineSyncObject(credentials)
   *
   * // Provide a custom adapter
   * const offlineSync = await createOfflineSyncObject(credentials, {
   *   storage: new MyCustomAdapter({ projectId, class: 'myClass', id: 'myId' })
   * })
   * ```
   */
  storage?:
    | (new (options: { projectId: string; class?: string; id?: string; ttl?: number }) => StorageAdapter)
    | ((options: { projectId: string; class?: string; id?: string; ttl?: number }) => StorageAdapter)
  /**
   * Optional function to resolve conflicts between local and remote items during synchronization.
   * If provided, this function will be called with the local and remote versions of an item.
   * The function should return the resolved item to be stored.
   *
   * @param local - The local item from offline storage.
   * @param remote - The remote item from the server.
   * @returns The resolved item to use.
   *
   * @example
   * ```typescript
   * resolveConflict: (local, remote) => {
   *   // Prefer the item with the latest update
   *   return local.updatedAt > remote.updatedAt ? local : remote
   * }
   * ```
   */
  resolveConflict?: (
    local: ItemType,
    remote: ItemType
  ) => ItemType

  /**
   * Interval in milliseconds for periodic expiration sweep.
   * Expired items will be removed from local storage at this interval.
   * Defaults to 15 minutes (900000 ms).
   *
   * @default 900000
   *
   * @example
   * ```typescript
   * expirationSweepInterval: 60000 // Sweep every minute
   * ```
   */
  expirationSweepInterval?: number

  /**
   * If true, expired items will be actively deleted from the remote SyncObject
   * during synchronization. By default, expired remote items are ignored but not deleted.
   *
   * @default false
   *
   * @example
   * ```typescript
   * cleanupExpiredRemote: true // Actively delete expired remote items
   * ```
   */
  // cleanupExpiredRemote?: boolean
}

export type OfflineSyncOptionsExtra = Omit<OfflineSyncOptions, keyof InstanceOptions>
