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
 */
export type SetReturnType = { expiresAt: number, keyVersion?: number }

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
  passphrase?: string,
  /** Key derivation options. */
  keyDerivationOptions?: KeyDerivationOptions,
  /** Custom encryption handler. */
  getEncryptionHandler?: (encryptionSettings: EncryptionSettings) => Promise<EncryptionHandler>
  /** Auto-update old encrypted values. @default true */
  autoUpdateOldEncryptedValues?: boolean,
  idSignature?: string,
  idSignatureKeyVersion?: number,
  /** Log level. @default 'warn' */
  logLevel?: LogLevel
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
 */
export type LeavedConnection = {
  connectionId: string,
  data?: JSONObj
}

/**
 * Presence event: connection joined.
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
 */
export interface SyncObjectMeta {
  readonly id: string
  readonly joinedConnections: JoinedConnections
  readonly join: (data: JSONObj) => Promise<undefined>
  readonly leave: () => Promise<undefined>
  readonly send: (msg: JSONObj, options?: { transport?: 'ws' | 'http' }) => Promise<undefined>
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
}
