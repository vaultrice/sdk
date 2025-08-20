import NonLocalStorage from './dist/deno/NonLocalStorage.ts'

// Also provide default exports for compatibility
export { NonLocalStorage }
export { default as createOfflineNonLocalStorage } from './dist/deno/OfflineNonLocalStorage.ts'
export { default as createSyncObject } from './dist/deno/SyncObject.ts'
export { default as createOfflineSyncObject } from './dist/deno/OfflineSyncObject.ts'

// Export static helper directly
export const retrieveAccessToken = NonLocalStorage.retrieveAccessToken

// Type exports
export type * from './dist/deno/types.ts'
