/**
 * @fileoverview Internal symbols used for private property storage in SDK classes.
 * @internal
 */

/**
 * Symbol for storing API credentials privately within Base class instances.
 * @internal
 */
export const CREDENTIALS = Symbol('vaultrice/credentials')

/**
 * Symbol for storing current encryption settings privately within Base class instances.
 * @internal
 */
export const ENCRYPTION_SETTINGS = Symbol('vaultrice/encryptionSettings')

/**
 * Symbol for storing previous encryption settings privately within Base class instances.
 * Used for backwards compatibility when decrypting data encrypted with older key versions.
 * @internal
 */
export const PREVIOUS_ENCRYPTION_SETTINGS = Symbol('vaultrice/previousEncryptionSettings')

/**
 * Symbol for storing error handler callbacks privately within WebSocketFunctions class instances.
 * @internal
 */
export const ERROR_HANDLERS = Symbol('vaultrice/errorHandlers')

/**
 * Symbol for storing WebSocket connection privately within WebSocketFunctions class instances.
 * @internal
 */
export const WEBSOCKET = Symbol('vaultrice/ws')

/**
 * Symbol for storing event handler callbacks privately within WebSocketFunctions class instances.
 * @internal
 */
export const EVENT_HANDLERS = Symbol('vaultrice/eventHandlers')
