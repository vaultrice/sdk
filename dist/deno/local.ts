/**
 * Local storage key name for persisting instance IDs.
 * @internal
 */
const LOCAL_ID_NAME = 'NON_LOCAL_STORAGE_LOCAL_ID'

/**
 * Retrieve the persisted instance ID from browser localStorage.
 *
 * @returns The stored instance ID, or null if not found or localStorage unavailable.
 *
 * @remarks
 * This function safely checks for browser environment and localStorage availability
 * before attempting to retrieve the stored ID. Returns null in Node.js environments
 * or when localStorage is not supported.
 *
 * @example
 * ```typescript
 * const storedId = getLocalId();
 * if (storedId) {
 *   console.log('Found existing ID:', storedId);
 * } else {
 *   console.log('No stored ID found');
 * }
 * ```
 */
export const getLocalId = (): string | null => {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage.getItem(LOCAL_ID_NAME)
  }
  return null
}

/**
 * Persist an instance ID to browser localStorage for future sessions.
 *
 * @param id - The instance ID to store locally.
 *
 * @remarks
 * This function safely checks for browser environment and localStorage availability
 * before attempting to store the ID. Does nothing in Node.js environments
 * or when localStorage is not supported.
 *
 * The stored ID allows instances to maintain the same identifier across
 * browser sessions, enabling data persistence and continuity.
 *
 * @example
 * ```typescript
 * const newId = 'user-123-session-456';
 * setLocalId(newId);
 * // ID will be available in future sessions via getLocalId()
 * ```
 */
export const setLocalId = (id: string) => {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(LOCAL_ID_NAME, id)
  }
}
