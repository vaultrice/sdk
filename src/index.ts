import WebSocketFunctions from './ws'
import { encrypt, decrypt } from './encryption'
import {
  ValueType,
  SetReturnType,
  ItemType,
  ItemsType,
  SetItemsType,
  JSONObj,
  LogLevel
} from './types'

export default class NonLocalStorage extends WebSocketFunctions {
  private ttl: number | undefined

  constructor (
    credentials: {
      apiKey: string,
      apiSecret: string,
      projectId: string
    },
    id?: string | undefined,
    options?: {
      class?: string,
      ttl?: number,
      passphrase?: string,
      signedId?: string,
      idSignatureKeyVersion?: number,
      logLevel?: LogLevel
    }
  ) {
    super(credentials, id, options)

    if (options?.ttl) this.ttl = options?.ttl
  }

  async setItem (name: string, value: ValueType, options?: { ttl?: number }): Promise<SetReturnType> {
    if (!name) throw new Error('No name passed!')
    if (!value) throw new Error('No value passed!')
    if ((this as any).passphrase && !(this as any).symKey) throw new Error('Call getEncryptionSettings() first!')

    const ttl = options?.ttl || this.ttl

    const valueToStore = (this as any).symKey ? await encrypt((this as any).symKey, JSON.stringify(value)) : value
    const response = await this.request('POST', `/cache/${this.class}/${this.id}/${name}`, {
      value: valueToStore,
      ttl
    })
    const item = response as JSONObj

    return {
      expiresAt: item?.expiresAt as number,
      keyVersion: item?.keyVersion as number ?? undefined
    }
  }

  async setItems (items: Record<string, { value: ValueType, ttl?: number }>): Promise<SetItemsType | undefined> {
    if (!items || Object.keys(items).length === 0) throw new Error('No items passed!')
    if ((this as any).passphrase && !(this as any).symKey) throw new Error('Call getEncryptionSettings() first!')

    // Process each item, encrypting values if necessary
    for (const name of Object.keys(items)) {
      const valueToStore = (this as any).symKey
        ? await encrypt((this as any).symKey, JSON.stringify(items[name].value))
        : items[name].value
      items[name].value = valueToStore
      items[name].ttl ||= this.ttl
    }

    const response = await this.request('POST', `/cache/${this.class}/${this.id}`, items)
    const r = response as JSONObj
    return Object.keys(r).reduce<SetItemsType>((prev, name) => {
      prev[name] = {
        expiresAt: (r[name] as { expiresAt?: number })?.expiresAt ?? 0,
        keyVersion: (r[name] as { keyVersion?: number })?.keyVersion ?? undefined
      }
      return prev
    }, {})
  }

  async getItem<T = ValueType> (name: string): Promise<ItemType<T> | undefined> {
    if (!name) throw new Error('No name passed!')
    if ((this as any).passphrase && !(this as any).symKey) throw new Error('Call getEncryptionSettings() first!')

    const response = await this.request('GET', `/cache/${this.class}/${this.id}/${name}`)
    const item = response as JSONObj

    const v = item?.value
    if (!v) return

    const symKey = await this.getSymKeyForKeyVersion(item.keyVersion as number)
    const value = symKey ? JSON.parse(await decrypt(symKey, v as string)) : v

    const hasOldEncryption = (item?.keyVersion as number) > -1 && item.keyVersion !== (this as any).encryptionSettings?.keyVersion
    if (hasOldEncryption) {
      this.logger.log('warn', `Item "${name}" has an old encryption and can be updated by storing it again.`)
    }

    return {
      value,
      expiresAt: item.expiresAt as number,
      keyVersion: item.keyVersion as number
    }
  }

  async getItems (names: string[]): Promise<ItemsType | undefined> {
    if (!names || names.length === 0) throw new Error('No names passed!')
    if ((this as any).passphrase && !(this as any).symKey) throw new Error('Call getEncryptionSettings() first!')

    const response = await this.request('POST', `/cache-query/${this.class}/${this.id}`, names)
    const items = response as JSONObj

    if (Object.keys(items).length === 0) return

    const result: ItemsType = {}
    for (const name of Object.keys(items)) {
      const item = items[name] as JSONObj
      const v = item?.value
      if (!v) continue

      const symKey = await this.getSymKeyForKeyVersion(item.keyVersion as number)
      const value = symKey ? JSON.parse(await decrypt(symKey, v as string)) : v

      const hasOldEncryption = (item?.keyVersion as number) > -1 && item.keyVersion !== (this as any).encryptionSettings?.keyVersion
      if (hasOldEncryption) {
        this.logger.log('warn', `Item "${name}" has an old encryption and can be updated by storing it again.`)
      }

      result[name] = {
        value,
        expiresAt: item.expiresAt as number,
        keyVersion: item.keyVersion as number
      }
    }

    return result
  }

  async getAllItems (options?: { prefix?: string }): Promise<ItemsType | undefined> {
    if ((this as any).passphrase && !(this as any).symKey) throw new Error('Call getEncryptionSettings() first!')

    const response = await this.request('GET', `/cache/${this.class}/${this.id}${options?.prefix ? `?prefix=${options?.prefix}` : ''}`)
    const items = response as JSONObj

    if (Object.keys(items).length === 0) return

    const result: ItemsType = {}
    for (const name of Object.keys(items)) {
      const item = items[name] as JSONObj
      const v = item?.value
      if (!v) continue

      const symKey = await this.getSymKeyForKeyVersion(item.keyVersion as number)
      const value = symKey ? JSON.parse(await decrypt(symKey, v as string)) : v

      result[name] = {
        value,
        expiresAt: item.expiresAt as number,
        keyVersion: item.keyVersion as number ?? undefined
      }
    }

    return result
  }

  async getAllKeys (options?: { prefix?: string }): Promise<string[] | undefined> {
    const response = await this.request('GET', `/cache-keys/${this.class}/${this.id}${options?.prefix ? `?prefix=${options?.prefix}` : ''}`)
    return response as unknown as string[]
  }

  async removeItem (name: string): Promise<undefined> {
    if (!name) throw new Error('No name passed!')

    await this.request('DELETE', `/cache/${this.class}/${this.id}/${name}`)
  }

  async removeItems (names: string[]): Promise<undefined> {
    if (!names || names.length === 0) throw new Error('No names passed!')

    await this.request('DELETE', `/cache/${this.class}/${this.id}`, names)
  }

  async clear (): Promise<undefined> {
    await this.request('DELETE', `/cache/${this.class}/${this.id}`)
  }
}
