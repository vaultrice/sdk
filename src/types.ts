export type ValueType =
  | string
  | number
  | boolean
  | null
  | ValueType[]
  | { [key: string]: ValueType }
export type SetReturnType = { expiresAt: number, keyVersion?: number }
export type ItemType<T = ValueType> = { value: T } & SetReturnType
export type ItemsType = Record<string, ItemType>
export type SetItemsType = Record<string, SetReturnType>
export type LogLevel =
  | 'error'
  | 'warn'
  | 'info'
  | 'debug'

type JSONObjInner =
  | string
  | number
  | boolean
  | null
  | undefined
  | { [key: string]: JSONObjInner }
  | JSONObjInner[]
export type JSONObj = { [key: string]: JSONObjInner }

export type KeyDerivationOptions = {
  /**
   * @default 100000
   */
  iterations?: number,
  /**
   * @default 'SHA-512'
   */
  hash?: HashAlgorithmIdentifier,
  /**
   * @default { name: 'AES-GCM', length: 256 }
   */
  derivedKeyType?: AesDerivedKeyParams
}

export type EncryptionHandler = {
  encrypt: ((v: string) => Promise<string>)
  decrypt: ((v: string) => Promise<string>)
}

export type InstanceOptions = {
  id?: string,
  /**
   * @default '_undefined_'
   */
  class?: string,
  ttl?: number,
  passphrase?: string,
  /**
   * @default {
   *   iterations: 100000,
   *   hash: 'SHA-512',
   *   derivedKeyType: { name: 'AES-GCM', length: 256 }
   * }
   */
  keyDerivationOptions?: KeyDerivationOptions,
  getEncryptionHandler?: (encryptionSettings: EncryptionSettings) => Promise<EncryptionHandler>
  /**
   * @default true
   */
  autoUpdateOldEncryptedValues?: boolean,
  idSignature?: string,
  idSignatureKeyVersion?: number,
  /**
   * @default 'warn'
   */
  logLevel?: LogLevel
}

export type EncryptionSettings = {
  salt: Uint8Array,
  keyVersion: number,
  createdAt: number
}

export type EncryptionSettingsInfos = {
  encryptionSettings: EncryptionSettings,
  previousEncryptionSettings?: EncryptionSettings[]
}
