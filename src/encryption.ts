export async function deriveSymmetricKey (passphrase: string, objectId: string, salt: Uint8Array, iterations = 100000): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(passphrase + ':' + objectId), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

function generateIv () {
  return crypto.getRandomValues(new Uint8Array(12))
}

export async function encrypt (key: CryptoKey, plaintext: string) {
  const enc = new TextEncoder()
  const iv = generateIv()
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext))
  return JSON.stringify({ iv: btoa(String.fromCharCode(...iv)), data: btoa(String.fromCharCode(...new Uint8Array(ciphertext))) })
}

export async function decrypt (key: CryptoKey, encryptedString: string) {
  const encrypted = JSON.parse(encryptedString)
  const dec = new TextDecoder()
  const iv = Uint8Array.from(atob(encrypted.iv), c => c.charCodeAt(0))
  const data = Uint8Array.from(atob(encrypted.data), c => c.charCodeAt(0))
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
  return dec.decode(plaintext)
}
