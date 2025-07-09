import NonLocalStorage from './NonLocalStorage'
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

  const handler: ProxyHandler<T & SyncObjectMeta> = {
    set (_, prop: string, value) {
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

      const item = (store as any)[prop] as ItemType
      if (!item) return undefined
      if (item.expiresAt < Date.now()) {
        delete (store as any)[prop]
        return undefined
      }
      return item.value
    }
  }

  // start from an object that *only* has .id
  const base = { id: nls.id } as SyncObjectMeta

  // cast the Proxy to T & SyncObjectMeta
  return new Proxy(base, handler) as T & SyncObjectMeta
}
