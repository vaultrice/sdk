/**
 * Local storage key name for persisting instance IDs.
 * @internal
 */
const LOCAL_ID_NAME = 'NON_LOCAL_STORAGE_LOCAL_ID'

/**
 * Retrieve the persisted instance ID from browser localStorage.
 * @param projectId
 * @param className
 * @returns The stored instance ID, or null if not found or localStorage unavailable.
 *
 * @remarks
 * This function safely checks for browser environment and localStorage availability
 * before attempting to retrieve the stored ID. Returns null in Node.js environments
 * or when localStorage is not supported.
 */
export const getLocalId = (projectId: string, className: string): string | null => {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage.getItem(`${LOCAL_ID_NAME}:${projectId}:${className}`)
  }
  return null
}

/**
 * Persist an instance ID to browser localStorage for future sessions.
 *
 * @param projectId
 * @param className
 * @param id - The instance ID to store locally.
 *
 * @remarks
 * This function safely checks for browser environment and localStorage availability
 * before attempting to store the ID. Does nothing in Node.js environments
 * or when localStorage is not supported.
 *
 * The stored ID allows instances to maintain the same identifier across
 * browser sessions, enabling data persistence and continuity.
 */
export const setLocalId = (projectId: string, className: string, id: string) => {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(`${LOCAL_ID_NAME}:${projectId}:${className}`, id)
  }
}
