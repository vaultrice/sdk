import WebSocketFunctions from './Ws'
import {
  ValueType,
  SetReturnType,
  ItemType,
  ItemsType,
  SetItemsType,
  JSONObj,
  InstanceOptions
} from './types'

export default class NonLocalStorage extends WebSocketFunctions {
  private ttl: number | undefined

  constructor (
    credentials: {
      apiKey: string,
      apiSecret: string,
      projectId: string
    },
    id?: string
  )
  constructor (
    credentials: {
      apiKey: string,
      apiSecret: string,
      projectId: string
    },
    options?: InstanceOptions
  )
  constructor (
    credentials: {
      apiKey: string,
      apiSecret: string,
      projectId: string
    },
    idOrOptions?: string | InstanceOptions | undefined
  ) {
    if (typeof idOrOptions === 'string') {
      super(credentials, idOrOptions)
    } else {
      super(credentials, idOrOptions as InstanceOptions | undefined)
      if (idOrOptions?.ttl) this.ttl = idOrOptions?.ttl
    }
  }

  async setItem (name: string, value: ValueType, options?: { ttl?: number }): Promise<SetReturnType> {
    if (!name) throw new Error('No name passed!')
    if (!value && value !== 0 && value !== '' && value !== false) throw new Error('No value passed!')
    if (this.getEncryptionHandler && !this.encryptionHandler) throw new Error('Call getEncryptionSettings() first!')

    const ttl = options?.ttl || this.ttl

    const valueToStore = this.encryptionHandler ? await this.encryptionHandler.encrypt(JSON.stringify(value)) : value

    let response
    try {
      response = await this.request('POST', `/cache/${this.class}/${this.id}/${name}`, { value: valueToStore, ttl })
    } catch (e) {
      if (!e || (e as any)?.cause?.name !== 'ConflictError') throw e
      this.logger.log('warn', 'Your local keyVersion does not match! Will attempt to fetch the new encryption settings...')
      await this.getEncryptionSettings()
      response = await this.request('POST', `/cache/${this.class}/${this.id}/${name}`, { value: valueToStore, ttl })
    }
    const item = response as JSONObj

    return {
      expiresAt: item?.expiresAt as number,
      keyVersion: item?.keyVersion as number ?? undefined
    }
  }

  async setItems (items: Record<string, { value: ValueType, ttl?: number }>): Promise<SetItemsType | undefined> {
    if (!items || Object.keys(items).length === 0) throw new Error('No items passed!')
    if (this.getEncryptionHandler && !this.encryptionHandler) throw new Error('Call getEncryptionSettings() first!')

    // Process each item, encrypting values if necessary
    for (const name of Object.keys(items)) {
      const valueToStore = this.encryptionHandler
        ? await this.encryptionHandler.encrypt(JSON.stringify(items[name].value))
        : items[name].value
      items[name].value = valueToStore
      items[name].ttl ||= this.ttl
    }

    let response
    try {
      response = await this.request('POST', `/cache/${this.class}/${this.id}`, items)
    } catch (e) {
      if (!e || (e as any)?.cause?.name !== 'ConflictError') throw e
      this.logger.log('warn', 'Your local keyVersion does not match! Will attempt to fetch the new encryption settings...')
      await this.getEncryptionSettings()
      response = await this.request('POST', `/cache/${this.class}/${this.id}`, items)
    }
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
    if (this.getEncryptionHandler && !this.encryptionHandler) throw new Error('Call getEncryptionSettings() first!')

    let response
    try {
      response = await this.request('GET', `/cache/${this.class}/${this.id}/${name}`)
    } catch (e) {
      if (!e || (e as any)?.cause?.name !== 'ConflictError') throw e
      this.logger.log('warn', 'Your local keyVersion does not match! Will attempt to fetch the new encryption settings...')
      await this.getEncryptionSettings()
      response = await this.request('GET', `/cache/${this.class}/${this.id}/${name}`)
    }
    const item = response as JSONObj

    const v = item?.value
    if (!v) return

    const encryptionHandler = await this.getEncryptionHandlerForKeyVersion(item.keyVersion as number)
    const value = encryptionHandler ? JSON.parse(await encryptionHandler.decrypt(v as string)) : v

    const hasOldEncryption = (item?.keyVersion as number) > -1 && item.keyVersion !== (this as any).encryptionSettings?.keyVersion
    if (hasOldEncryption) {
      if (this.autoUpdateOldEncryptedValues) {
        this.logger.log('info', `Item "${name}" has an old encryption and will be automatically updated now by setting it again.`)
        await this.setItem(name, value, { ttl: (item.expiresAt as number) - Date.now() })
      } else {
        this.logger.log('warn', `Item "${name}" has an old encryption and can be updated by setting it again.`)
      }
    }

    return {
      value,
      expiresAt: item.expiresAt as number,
      keyVersion: item.keyVersion as number
    }
  }

  async getItems (names: string[]): Promise<ItemsType | undefined> {
    if (!names || names.length === 0) throw new Error('No names passed!')
    if (this.getEncryptionHandler && !this.encryptionHandler) throw new Error('Call getEncryptionSettings() first!')

    let response
    try {
      response = await this.request('POST', `/cache-query/${this.class}/${this.id}`, names)
    } catch (e) {
      if (!e || (e as any)?.cause?.name !== 'ConflictError') throw e
      this.logger.log('warn', 'Your local keyVersion does not match! Will attempt to fetch the new encryption settings...')
      await this.getEncryptionSettings()
      response = await this.request('POST', `/cache-query/${this.class}/${this.id}`, names)
    }
    const items = response as JSONObj

    if (Object.keys(items).length === 0) return

    const oldEncryptedItems: Record<string, JSONObj> = {}

    const result: ItemsType = {}
    for (const name of Object.keys(items)) {
      const item = items[name] as JSONObj
      const v = item?.value
      if (!v) continue

      const encryptionHandler = await this.getEncryptionHandlerForKeyVersion(item.keyVersion as number)
      const value = encryptionHandler ? JSON.parse(await encryptionHandler.decrypt(v as string)) : v

      const hasOldEncryption = (item?.keyVersion as number) > -1 && item.keyVersion !== (this as any).encryptionSettings?.keyVersion
      if (hasOldEncryption) oldEncryptedItems[name] = item

      result[name] = {
        value,
        expiresAt: item.expiresAt as number,
        keyVersion: item.keyVersion as number
      }
    }

    const oldEncryptedItemNames = Object.keys(oldEncryptedItems)
    if (oldEncryptedItemNames.length > 0) {
      if (this.autoUpdateOldEncryptedValues) {
        this.logger.log('info', `These items "${oldEncryptedItemNames.join(',')}" have an old encryption and will be automatically updated now by setting them again.`)
        const itemsToSet = oldEncryptedItemNames.reduce((prev, cur) => {
          prev[cur] = {
            value: result[cur].value,
            ttl: (oldEncryptedItems[cur].expiresAt as number) - Date.now()
          }
          return prev
        }, {} as Record<string, { value: ValueType, ttl?: number }>)
        await this.setItems(itemsToSet)
      } else {
        this.logger.log('warn', `These items "${oldEncryptedItemNames.join(',')}" have an old encryption and can be updated by setting them again.`)
      }
    }

    return result
  }

  async getAllItems (options?: { prefix?: string }): Promise<ItemsType | undefined> {
    if (this.getEncryptionHandler && !this.encryptionHandler) throw new Error('Call getEncryptionSettings() first!')

    let response
    try {
      response = await this.request('GET', `/cache/${this.class}/${this.id}${options?.prefix ? `?prefix=${options?.prefix}` : ''}`)
    } catch (e) {
      if (!e || (e as any)?.cause?.name !== 'ConflictError') throw e
      this.logger.log('warn', 'Your local keyVersion does not match! Will attempt to fetch the new encryption settings...')
      await this.getEncryptionSettings()
      response = await this.request('GET', `/cache/${this.class}/${this.id}${options?.prefix ? `?prefix=${options?.prefix}` : ''}`)
    }
    const items = response as JSONObj

    if (Object.keys(items).length === 0) return

    const result: ItemsType = {}
    for (const name of Object.keys(items)) {
      const item = items[name] as JSONObj
      const v = item?.value
      if (!v) continue

      const encryptionHandler = await this.getEncryptionHandlerForKeyVersion(item.keyVersion as number)
      const value = encryptionHandler ? JSON.parse(await encryptionHandler.decrypt(v as string)) : v

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

  async incrementItem (name: string, value: number = 1, options?: { ttl?: number }): Promise<ItemType> {
    if (!name) throw new Error('No name passed!')
    if (value === undefined || value === null) throw new Error('No value passed!')
    if (typeof value !== 'number') throw new Error('Value needs to be a number!')

    const ttl = options?.ttl || this.ttl

    const response = await this.request('POST', `/cache/${this.class}/${this.id}/${name}/increment`, { value, ttl })
    const item = response as JSONObj

    return {
      value: item?.value as number,
      expiresAt: item?.expiresAt as number,
      keyVersion: item?.keyVersion as number ?? undefined
    }
  }

  async decrementItem (name: string, value: number = 1, options?: { ttl?: number }): Promise<ItemType> {
    if (!name) throw new Error('No name passed!')
    if (value === undefined || value === null) throw new Error('No value passed!')
    if (typeof value !== 'number') throw new Error('Value needs to be a number!')

    const ttl = options?.ttl || this.ttl

    const response = await this.request('POST', `/cache/${this.class}/${this.id}/${name}/decrement`, { value, ttl })
    const item = response as JSONObj

    return {
      value: item?.value as number,
      expiresAt: item?.expiresAt as number,
      keyVersion: item?.keyVersion as number ?? undefined
    }
  }

  async clear (): Promise<undefined> {
    await this.request('DELETE', `/cache/${this.class}/${this.id}`)
  }
}
