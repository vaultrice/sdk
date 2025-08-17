/**
 * Vaultrice SDK - A TypeScript SDK for persistent, encrypted, real-time key-value storage.
 *
 * @packageDocumentation
 */

// Also provide default exports for compatibility
export { default as NonLocalStorage } from './NonLocalStorage'
export { default as createSyncObject } from './SyncObject'
export { default as createOfflineSyncObject } from './OfflineSyncObject'

// Type exports
export type * from './types'
