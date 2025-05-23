import WebSocketFunctions from './ws'
import { encrypt, decrypt } from './encryption'
import {
  ValueType,
  SetReturnType,
  ItemType,
  ItemsType,
  SetItemsType,
  JSONObj
} from './types'

export default class NonLocalStorage extends WebSocketFunctions {
  private ttl: number | undefined

  constructor (credentials: { apiKey: string, apiSecret: string, projectId: string }, id?: string, options?: { ttl?: number, passphrase?: string }) {
    super(credentials, id, options && { passphrase: options?.passphrase })

    if (options?.ttl) this.ttl = options?.ttl
  }

  async setItem (name: string, value: ValueType, options?: { ttl?: number }): Promise<SetReturnType> {
    if (!name) throw new Error('No name passed!')
    if (!value) throw new Error('No value passed!')
    // @ts-ignore
    if (this.passphrase && !this.symKey) throw new Error('Call init() first!')

    const ttl = options?.ttl || this.ttl

    // @ts-ignore
    const valueToStore = this.symKey ? await encrypt(this.symKey, JSON.stringify(value)) : value
    const response = await this.request('POST', `/cache/${this.id}/${name}`, {
      value: valueToStore,
      ttl // @ts-ignore
    }, this?.metadata?.keyVersion)
    const item = response as JSONObj

    return { expiresAt: item?.expiresAt as number }
  }

  async setItems (items: Record<string, { value: ValueType, ttl?: number }>): Promise<SetItemsType | undefined> {
    if (!items || Object.keys(items).length === 0) throw new Error('No items passed!')
    // @ts-ignore
    if (this.passphrase && !this.symKey) throw new Error('Call init() first!')

    // Process each item, encrypting values if necessary
    for (const name of Object.keys(items)) {
      // @ts-ignore
      const valueToStore = this.symKey // @ts-ignore
        ? await encrypt(this.symKey, JSON.stringify(items[name].value))
        : items[name].value
      items[name].value = valueToStore
      items[name].ttl ||= this.ttl
    }

    // @ts-ignore
    const response = await this.request('POST', `/cache/${this.id}`, items, this?.metadata?.keyVersion)
    const r = response as JSONObj
    return Object.keys(r).reduce<SetItemsType>((prev, name) => {
      prev[name] = {
        expiresAt: (r[name] as { expiresAt?: number })?.expiresAt ?? 0
      }
      return prev
    }, {})
  }

  async getItem<T = ValueType> (name: string): Promise<ItemType<T> | undefined> {
    if (!name) throw new Error('No name passed!')
    // @ts-ignore
    if (this.passphrase && !this.symKey) throw new Error('Call init() first!')

    // @ts-ignore
    const response = await this.request('GET', `/cache/${this.id}/${name}`, undefined, this?.metadata?.keyVersion)
    const item = response as JSONObj

    const v = item?.value
    if (!v) return

    // @ts-ignore
    const value = this.symKey ? JSON.parse(await decrypt(this.symKey, v)) : v

    return {
      value,
      expiresAt: item.expiresAt as number
    }
  }

  async getItems (names: string[]): Promise<ItemsType | undefined> {
    if (!names || names.length === 0) throw new Error('No names passed!')
    // @ts-ignore
    if (this.passphrase && !this.symKey) throw new Error('Call init() first!')

    // @ts-ignore
    const response = await this.request('POST', `/cache-query/${this.id}`, names, this?.metadata?.keyVersion)
    const items = response as JSONObj

    if (Object.keys(items).length === 0) return

    const result: ItemsType = {}
    for (const name of Object.keys(items)) {
      const item = items[name] as JSONObj
      const v = item?.value
      if (!v) continue

      // @ts-ignore
      const value = this.symKey ? JSON.parse(await decrypt(this.symKey, v)) : v

      result[name] = {
        value,
        expiresAt: item.expiresAt as number
      }
    }

    return result
  }

  async getAllItems (options?: { prefix?: string }): Promise<ItemsType | undefined> {
    // @ts-ignore
    if (this.passphrase && !this.symKey) throw new Error('Call init() first!')

    // @ts-ignore
    const response = await this.request('GET', `/cache/${this.id}`, undefined, this?.metadata?.keyVersion)
    const items = response as JSONObj

    if (Object.keys(items).length === 0) return

    const result: ItemsType = {}
    for (const name of Object.keys(items)) {
      const item = items[name] as JSONObj
      const v = item?.value
      if (!v) continue

      // @ts-ignore
      const value = this.symKey ? JSON.parse(await decrypt(this.symKey, v)) : v

      result[name] = {
        value,
        expiresAt: item.expiresAt as number
      }
    }

    return result
  }

  async getAllKeys (options?: { prefix?: string }): Promise<string[] | undefined> {
    const response = await this.request('GET', `/cache-keys/${this.id}${options?.prefix ? `?prefix=${options?.prefix}` : ''}`)
    return response as unknown as string[]
  }

  async removeItem (name: string): Promise<undefined> {
    if (!name) throw new Error('No name passed!')

    await this.request('DELETE', `/cache/${this.id}/${name}`)
  }

  async removeItems (names: string[]): Promise<undefined> {
    if (!names || names.length === 0) throw new Error('No names passed!')

    await this.request('DELETE', `/cache/${this.id}`, names)
  }

  async clear (): Promise<undefined> {
    await this.request('DELETE', `/cache/${this.id}`)
  }
}
