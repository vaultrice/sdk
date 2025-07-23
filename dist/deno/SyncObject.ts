import NonLocalStorage from './NonLocalStorage.ts'
import {
  ItemType,
  InstanceOptions,
  SyncObjectMeta
} from './types'

/**
 * Create a proxy object that syncs its properties to NonLocalStorage.
 *
 * @param credentials - API credentials.
 * @param idOrOptions - Optional ID or instance options.
 * @returns Proxy object with live sync and an `id` property.
 */
export default async function createSyncObject<T extends object> (
  credentials: {
    apiKey: string
    apiSecret: string
    projectId: string
  },
  idOrOptions?: string | InstanceOptions
): Promise<T & SyncObjectMeta> {
  const nls =
    typeof idOrOptions === 'string'
      ? new NonLocalStorage(credentials, idOrOptions)
      : new NonLocalStorage(credentials, idOrOptions)

  const ttl = (nls as any).ttl || 60 * 60 * 1000

  const store: Partial<T> = {}

  if ((nls as any).getEncryptionHandler) await nls.getEncryptionSettings()

  nls.on('setItem', (item) => {
    (store as any)[item.prop] = {
      ...item
    }
    delete (store as any)[item.prop].prop
  })

  nls.on('removeItem', (item) => {
    delete (store as any)[item.prop]
  })

  const items = await nls.getAllItems()
  if (items) {
    Object.keys(items).forEach((k) => {
      (store as any)[k] = items[k]
    })
  }

  // Create bound functions once and reuse them
  const boundOn = nls.on.bind(nls)
  const boundOff = nls.off.bind(nls)

  const handler: ProxyHandler<T & SyncObjectMeta> = {
    set (_, prop: string, value) {
      // Prevent overwriting special properties
      if (prop === 'id' || prop === 'on' || prop === 'off') {
        throw new Error(`Cannot set property '${prop}' - it is a reserved property`)
      }

      if (value === undefined) {
        nls.removeItem(prop)
        delete (store as any)[prop]
        return true
      }
      if (typeof value === 'number' && isNaN(value)) value = 0
      nls.setItem(prop, value)
      ;(store as any)[prop] = { value, expiresAt: Date.now() + ttl }
      return true
    },
    get (_, prop: string | symbol) {
      if (prop === 'id') return nls.id
      if (prop === 'on') return boundOn
      if (prop === 'off') return boundOff

      const item = (store as any)[prop] as ItemType
      if (!item) return undefined
      if (item.expiresAt < Date.now()) {
        delete (store as any)[prop]
        return undefined
      }
      return item.value
    },
    has (_, prop: string | symbol) {
      // Make sure special properties are always considered as existing
      if (prop === 'id' || prop === 'on' || prop === 'off') return true

      const item = (store as any)[prop] as ItemType
      if (!item) return false
      if (item.expiresAt < Date.now()) {
        delete (store as any)[prop]
        return false
      }
      return true
    },
    ownKeys (_) {
      // Get all keys from the target (base object) first
      const targetKeys = Reflect.ownKeys(_)

      // Get all non-expired keys from the store
      const storeKeys = Object.keys(store).filter(k => {
        const item = (store as any)[k] as ItemType
        if (!item) return false
        if (item.expiresAt < Date.now()) {
          delete (store as any)[k]
          return false
        }
        return true
      })

      // Combine both, ensuring no duplicates
      const allKeys = new Set([...targetKeys, ...storeKeys])
      return Array.from(allKeys)
    },
    getOwnPropertyDescriptor (_, prop: string | symbol) {
      // Define special properties as non-configurable and non-writable
      if (prop === 'id' || prop === 'on' || prop === 'off') {
        return {
          configurable: false,
          enumerable: true, // Make them enumerable so they appear in Object.keys()
          writable: false,
          value: prop === 'id'
            ? nls.id
            : prop === 'on'
              ? boundOn
              : boundOff
        }
      }

      const item = (store as any)[prop] as ItemType
      if (!item) return undefined
      if (item.expiresAt < Date.now()) {
        delete (store as any)[prop]
        return undefined
      }

      return {
        configurable: true,
        enumerable: true,
        writable: true,
        value: item.value
      }
    }
  }

  // Create a base object with properly defined special properties using the same bound functions
  const base = { id: nls.id } as SyncObjectMeta

  // Define special properties on the base object to match the proxy descriptor
  Object.defineProperty(base, 'id', {
    configurable: false,
    enumerable: true, // Match the proxy descriptor
    writable: false,
    value: nls.id
  })

  Object.defineProperty(base, 'on', {
    configurable: false,
    enumerable: true, // Match the proxy descriptor
    writable: false,
    value: boundOn
  })

  Object.defineProperty(base, 'off', {
    configurable: false,
    enumerable: true, // Match the proxy descriptor
    writable: false,
    value: boundOff
  })

  // cast the Proxy to T & SyncObjectMeta
  return new Proxy(base, handler) as T & SyncObjectMeta
}
