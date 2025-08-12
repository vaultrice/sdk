import NonLocalStorage from './NonLocalStorage'
import {
  ItemType,
  InstanceOptions,
  SyncObjectMeta,
  JoinedConnections
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
    apiKey?: string,
    apiSecret?: string,
    accessToken?: string,
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
  let joinedConnections: JoinedConnections = []

  if ((nls as any).getEncryptionHandler) await nls.getEncryptionSettings()

  // Wait for WebSocket connection to be established before proceeding
  const connectedPromise = new Promise<void>((resolve, reject) => {
    // Get the WebSocket to trigger connection
    nls.getWebSocket().then((ws) => {
      // Check if already connected
      if (ws.readyState === WebSocket.OPEN) {
        resolve()
      }
    }).catch(reject)

    const timeout = setTimeout(() => {
      reject(new Error('WebSocket connection timeout after 10 seconds'))
    }, 10000) // 10 second timeout

    const connectHandler = () => {
      clearTimeout(timeout)
      nls.off('connect', connectHandler)
      nls.off('error', errorHandler)
      resolve()
    }

    const errorHandler = (error: Error) => {
      clearTimeout(timeout)
      nls.off('connect', connectHandler)
      nls.off('error', errorHandler)
      reject(error)
    }

    nls.on('connect', connectHandler)
    nls.on('error', errorHandler)
  })

  // Set up event listeners after waiting for connection
  nls.on('setItem', (item) => {
    (store as any)[item.prop] = {
      ...item
    }
    delete (store as any)[item.prop].prop
  })

  nls.on('removeItem', (item) => {
    delete (store as any)[item.prop]
  })

  // Handle presence events to update joinedConnections
  nls.on('presence:join', (joinedConnection) => {
    // Add or update the connection
    const existingIndex = joinedConnections.findIndex(c => c.connectionId === joinedConnection.connectionId)
    if (existingIndex >= 0) {
      joinedConnections[existingIndex] = joinedConnection
    } else {
      joinedConnections.push(joinedConnection)
    }
  })

  nls.on('presence:leave', (leavedConnection) => {
    // Remove the connection
    joinedConnections = joinedConnections.filter(c => c.connectionId !== leavedConnection.connectionId)
  })

  await connectedPromise

  const items = await nls.getAllItems()
  if (items) {
    Object.keys(items).forEach((k) => {
      (store as any)[k] = items[k]
    })
  }

  // Initialize joinedConnections now that WebSocket is connected
  try {
    joinedConnections = await nls.getJoinedConnections()
  } catch (e) {
    // Ignore errors when getting initial connections
    joinedConnections = []
  }

  // Create bound functions - regular join/leave without local state management
  const boundOn = nls.on.bind(nls)
  const boundOff = nls.off.bind(nls)
  const boundSend = nls.send.bind(nls)
  const boundJoin = nls.join.bind(nls)
  const boundLeave = nls.leave.bind(nls)
  const boundUseAccessToken = nls.useAccessToken.bind(nls)
  const boundOnAccessTokenExpiring = nls.onAccessTokenExpiring.bind(nls)
  const boundOffAccessTokenExpiring = nls.offAccessTokenExpiring.bind(nls)
  const boundConnect = nls.connect.bind(nls)
  const boundDisconnect = nls.disconnect.bind(nls)

  const reservedProps = [
    'id',
    'on',
    'off',
    'join',
    'leave',
    'send',
    'joinedConnections',
    'useAccessToken',
    'onAccessTokenExpiring',
    'offAccessTokenExpiring',
    'connect',
    'disconnect'
  ]

  const handler: ProxyHandler<T & SyncObjectMeta> = {
    set (_, prop: string, value) {
      // Prevent overwriting special properties
      if (reservedProps.indexOf(prop) > -1) {
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
      if (prop === 'join') return boundJoin
      if (prop === 'leave') return boundLeave
      if (prop === 'send') return boundSend
      if (prop === 'joinedConnections') return joinedConnections
      if (prop === 'useAccessToken') return boundUseAccessToken
      if (prop === 'onAccessTokenExpiring') return boundOnAccessTokenExpiring
      if (prop === 'offAccessTokenExpiring') return boundOffAccessTokenExpiring
      if (prop === 'connect') return boundConnect
      if (prop === 'disconnect') return boundDisconnect

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
      if (reservedProps.indexOf(prop as string) > -1) return true

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
      // For reserved properties, delegate to the base object to ensure consistency
      if (reservedProps.indexOf(prop as string) > -1) {
        return Reflect.getOwnPropertyDescriptor(_, prop)
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
  const base = {} as SyncObjectMeta

  // Define special properties on the base object to match the proxy descriptor
  Object.defineProperty(base, 'id', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: nls.id
  })

  Object.defineProperty(base, 'on', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: boundOn
  })

  Object.defineProperty(base, 'off', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: boundOff
  })

  Object.defineProperty(base, 'join', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: boundJoin
  })

  Object.defineProperty(base, 'leave', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: boundLeave
  })

  Object.defineProperty(base, 'send', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: boundSend
  })

  Object.defineProperty(base, 'joinedConnections', {
    configurable: false,
    enumerable: true,
    get: () => joinedConnections
  })

  Object.defineProperty(base, 'useAccessToken', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: boundUseAccessToken
  })

  Object.defineProperty(base, 'onAccessTokenExpiring', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: boundOnAccessTokenExpiring
  })

  Object.defineProperty(base, 'offAccessTokenExpiring', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: boundOffAccessTokenExpiring
  })

  Object.defineProperty(base, 'connect', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: boundConnect
  })

  Object.defineProperty(base, 'disconnect', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: boundDisconnect
  })

  // cast the Proxy to T & SyncObjectMeta
  return new Proxy(base, handler) as T & SyncObjectMeta
}
