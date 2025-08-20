/**
 * Vaultrice SDK - A TypeScript SDK for persistent, encrypted, real-time key-value storage.
 *
 * @packageDocumentation
 */

import NonLocalStorage from './NonLocalStorage'

// Also provide default exports for compatibility
export { NonLocalStorage }
export { default as createOfflineNonLocalStorage } from './OfflineNonLocalStorage'
export { default as createSyncObject } from './SyncObject'
export { default as createOfflineSyncObject } from './OfflineSyncObject'

/**
 * Retrieves an access token for a given project using API credentials.
 * See {@link NonLocalStorage.retrieveAccessToken} for details.
 */
export function retrieveAccessToken (
  projectId: string,
  apiKey: string,
  apiSecret: string,
  options?: { origin?: string }
): Promise<string> {
  return NonLocalStorage.retrieveAccessToken(projectId, apiKey, apiSecret, options)
}

// Type exports
export type * from './types'
