import NonLocalStorage from './dist/esm/NonLocalStorage.js'

// Also provide default exports for compatibility
export { NonLocalStorage }
export { default as createOfflineNonLocalStorage } from './dist/esm/OfflineNonLocalStorage.js'
export { default as createSyncObject } from './dist/esm/SyncObject.js'
export { default as createOfflineSyncObject } from './dist/esm/OfflineSyncObject.js'

// Export static helper directly
export const retrieveAccessToken = NonLocalStorage.retrieveAccessToken
