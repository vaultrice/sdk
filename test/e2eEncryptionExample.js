// e2eEncryptionExample.js
// Demonstrates E2E encryption flow in the browser/Node.js using Web Crypto API
// Includes export/import of symmetric key for client-side storage.

// --------------------------------------------------------------------------------
// 1. Utility: generates a random salt
//    -> SALT is safe to store server-side (metadata).
function generateSalt () {
  return crypto.getRandomValues(new Uint8Array(16))
}

// --------------------------------------------------------------------------------
// 2. Derive symmetric key from passphrase + salt via PBKDF2
//    -> PASSPHRASE must NOT be stored server-side.
//    -> SALT & iterations safe server-side.
async function deriveSymmetricKey (passphrase, objectId, salt, iterations = 100000) {
  const enc = new TextEncoder()
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase + ':' + objectId), 'PBKDF2', false, ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-512' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true,               // extractable to allow export
    ['encrypt', 'decrypt']
  )
}

// --------------------------------------------------------------------------------
// 3. Export symmetric key for client-side storage
//    -> Export raw key material as Base64 string
async function exportSymKey (key) {
  // console.log('---> export:')
  // console.log(await crypto.subtle.exportKey('raw', key))
  // console.log(await crypto.subtle.exportKey('jwk', key))
  // console.log('<---')
  const raw = await crypto.subtle.exportKey('raw', key) // Uint8Array
  return btoa(String.fromCharCode(...new Uint8Array(raw))) // safe to store in localStorage
}

// 4. Import symmetric key back into CryptoKey
//    -> Takes Base64 string from client storage
async function importSymKey (rawBase64) {
  const raw = Uint8Array.from(atob(rawBase64), c => c.charCodeAt(0))
  return crypto.subtle.importKey(
    'raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
  )
}

// --------------------------------------------------------------------------------
// 5. Utility: generate random IV
function generateIv () {
  return crypto.getRandomValues(new Uint8Array(12))
}

// --------------------------------------------------------------------------------
// 6. Encrypt plaintext with symmetric key
async function encryptData (key, plaintext) {
  const enc = new TextEncoder()
  const iv = generateIv()
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, enc.encode(plaintext)
  )
  return { iv: btoa(String.fromCharCode(...iv)), data: btoa(String.fromCharCode(...new Uint8Array(ciphertext))) }
}

// --------------------------------------------------------------------------------
// 7. Decrypt ciphertext with symmetric key
async function decryptData (key, encrypted) {
  const dec = new TextDecoder()
  const iv = Uint8Array.from(atob(encrypted.iv), c => c.charCodeAt(0))
  const data = Uint8Array.from(atob(encrypted.data), c => c.charCodeAt(0))
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
  return dec.decode(plaintext)
}

// --------------------------------------------------------------------------------
// 8. Generate asymmetric key pair (ECDH) for wrapping
async function generateAsymmetricKeyPair () {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']
  )
}

// --------------------------------------------------------------------------------
// 9. Wrap symmetric key for recipient
async function wrapKey (symKey, senderPrivKey, recipientPubKey) {
  const sharedKey = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: recipientPubKey }, senderPrivKey,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  )
  const iv = generateIv()
  const rawKey = await crypto.subtle.exportKey('raw', symKey)
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sharedKey, rawKey)
  return { iv: btoa(String.fromCharCode(...iv)), wrappedKey: btoa(String.fromCharCode(...new Uint8Array(wrapped))) }
}

// 10. Unwrap symmetric key
async function unwrapKey (wrappedObj, recipientPrivKey, senderPubKey) {
  const iv = Uint8Array.from(atob(wrappedObj.iv), c => c.charCodeAt(0))
  const wrappedKey = Uint8Array.from(atob(wrappedObj.wrappedKey), c => c.charCodeAt(0))
  const sharedKey = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: senderPubKey }, recipientPrivKey,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  )
  const rawKey = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sharedKey, wrappedKey)
  return crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

// ==== Example Usage ====
(async () => {
  const objectId = '123412341234'
  // 1. Setup: derive symmetric key
  const passphrase = 'super secret' // never store this server-side
  const salt = generateSalt()      // store salt server-side with metadata
  const saltToStoreOnServer = btoa(String.fromCharCode(...salt))
  console.log('salt to store on server side:', saltToStoreOnServer)
  const symKey = await deriveSymmetricKey(passphrase, objectId, salt)
  const exported = await exportSymKey(symKey)
  console.log('Exported symKey (store client-side):', exported)

  // // Import key later
  const importedKey = await importSymKey(exported)

  // simulate user passing passphrase again
  const symKeyAgain = await deriveSymmetricKey(passphrase, objectId, salt)

  // 2. Encrypt data before sending to server
  const plaintext = JSON.stringify({ message: 'Hello, world!' }) // client-only
  const encrypted = await encryptData(symKey, plaintext)
  console.log('Encrypted payload saved to server:', encrypted)

  const encryptedWithImportedKey = await encryptData(importedKey, plaintext)
  console.log('Encrypted payload saved to server (with importedKey):', encryptedWithImportedKey)

  // 3. Decrypt data after fetching from server
  const decrypted = await decryptData(symKey, encrypted)
  console.log('Decrypted payload:', JSON.parse(decrypted))

  const decryptedWithImportedKey = await decryptData(importedKey, encrypted)
  console.log('Decrypted payload (with importedKey):', JSON.parse(decryptedWithImportedKey))

  const decryptedWithNewGeneratedSymKey = await decryptData(symKeyAgain, encrypted)
  console.log('Decrypted payload (with symKeyAgain):', JSON.parse(decryptedWithNewGeneratedSymKey))

  // 4. Key sharing example via ECDH
  const userA = await generateAsymmetricKeyPair()
  const userB = await generateAsymmetricKeyPair()

  // Wrap symmetric key for user B
  const wrappedForB = await wrapKey(symKey, userA.privateKey, userB.publicKey)
  console.log('Wrapped key for B stored server-side:', wrappedForB)

  // User B unwraps the key
  const unwrappedByB = await unwrapKey(wrappedForB, userB.privateKey, userA.publicKey)
  console.log({ unwrappedByB })
  const recovered = await decryptData(unwrappedByB, encrypted)
  console.log('Recovered by B:', JSON.parse(recovered))
})()
