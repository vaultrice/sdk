import { KeyDerivationOptions } from './types.ts'

/**
 * Derive a symmetric encryption key from a passphrase using PBKDF2.
 *
 * @param passphrase - The user's passphrase for encryption.
 * @param objectId - Unique object identifier to salt the key derivation.
 * @param salt - Random salt bytes for key derivation.
 * @param options - Key derivation configuration options.
 * @returns Promise resolving to a CryptoKey for AES-GCM encryption/decryption.
 *
 * @remarks
 * This function combines the passphrase with the object ID and uses PBKDF2
 * to derive a cryptographically strong key. The default configuration uses
 * 100,000 iterations with SHA-512 to produce a 256-bit AES-GCM key.
 *
 * @example
 * ```typescript
 * const salt = crypto.getRandomValues(new Uint8Array(16));
 * const key = await deriveSymmetricKey('mySecret123', 'user-456', salt);
 * ```
 */
export async function deriveSymmetricKey (
  passphrase: string,
  objectId: string,
  salt: Uint8Array,
  options: KeyDerivationOptions = {
    iterations: 100000,
    hash: 'SHA-512',
    derivedKeyType: { name: 'AES-GCM', length: 256 }
  }
): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(passphrase + ':' + objectId), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: options?.iterations || 100000, hash: options?.hash || 'SHA-512' },
    baseKey,
    options?.derivedKeyType || { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/**
 * Generate a random initialization vector for AES-GCM encryption.
 * @internal
 * @returns A 12-byte random IV suitable for AES-GCM.
 */
function generateIv () {
  return crypto.getRandomValues(new Uint8Array(12))
}

/**
 * Encrypt plaintext using AES-GCM with the provided key.
 *
 * @param key - The CryptoKey to use for encryption.
 * @param plaintext - The string data to encrypt.
 * @param options - Encryption algorithm options.
 * @returns Promise resolving to a JSON string containing the encrypted data and IV.
 *
 * @remarks
 * The returned string is a JSON object with two base64-encoded fields:
 * - `iv`: The random initialization vector used for this encryption
 * - `data`: The encrypted ciphertext bytes
 *
 * Each encryption operation uses a fresh random IV for security.
 *
 * @example
 * ```typescript
 * const key = await deriveSymmetricKey('password', 'id', salt);
 * const encrypted = await encrypt(key, 'sensitive data');
 * // Returns: '{"iv":"base64...","data":"base64..."}'
 * ```
 */
export async function encrypt (
  key: CryptoKey, plaintext: string,
  options: { algorithm: string } = { algorithm: 'AES-GCM' }
) {
  const enc = new TextEncoder()
  const iv = generateIv()
  const ciphertext = await crypto.subtle.encrypt({ name: options?.algorithm || 'AES-GCM', iv }, key, enc.encode(plaintext))
  return JSON.stringify({ iv: btoa(String.fromCharCode(...iv)), data: btoa(String.fromCharCode(...new Uint8Array(ciphertext))) })
}

/**
 * Decrypt AES-GCM encrypted data using the provided key.
 *
 * @param key - The CryptoKey to use for decryption.
 * @param encryptedString - JSON string containing IV and encrypted data.
 * @param options - Decryption algorithm options.
 * @returns Promise resolving to the original plaintext string.
 *
 * @remarks
 * The encrypted string must be in the format produced by the `encrypt()` function:
 * a JSON object with base64-encoded `iv` and `data` fields.
 *
 * @throws Error if the encrypted string format is invalid or decryption fails.
 *
 * @example
 * ```typescript
 * const key = await deriveSymmetricKey('password', 'id', salt);
 * const decrypted = await decrypt(key, '{"iv":"...","data":"..."}');
 * // Returns: 'sensitive data'
 * ```
 */
export async function decrypt (
  key: CryptoKey, encryptedString: string,
  options: { algorithm: string } = { algorithm: 'AES-GCM' }
) {
  const encrypted = JSON.parse(encryptedString)
  const dec = new TextDecoder()
  const iv = Uint8Array.from(atob(encrypted.iv), c => c.charCodeAt(0))
  const data = Uint8Array.from(atob(encrypted.data), c => c.charCodeAt(0))
  const plaintext = await crypto.subtle.decrypt({ name: options?.algorithm || 'AES-GCM', iv }, key, data)
  return dec.decode(plaintext)
}
