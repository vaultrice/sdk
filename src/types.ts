export type ValueType = string | number | boolean
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

export type InstanceOptions = {
  id?: string,
  class?: string,
  ttl?: number,
  passphrase?: string,
  autoUpdateOldEncryptedValues?: boolean,
  idSignature?: string,
  idSignatureKeyVersion?: number,
  logLevel?: LogLevel
}
