# NonLocalStorage JS/TS SDK

A secure, real-time, cloud-based storage SDK with a familiar `localStorage`-like API — enhanced for cross-device, cross-domain sync, and optional end-to-end encryption.

> NonLocalStorage is ideal for state sharing between tabs, browsers, devices, or domains — with built-in real-time updates and optional encryption.

---

## 🔧 Installation

```bash
npm install non-local-storage
````

---

## 🚀 Quick Start

```ts
import { NonLocalStorage } from 'non-local-storage'

const nls = new NonLocalStorage({
  apiKey: 'your-api-key',
  apiSecret: 'your-api-secret',
  projectId: 'your-project-id'
}, 'your-id') // optional unique object ID

await nls.setItem('key', 'value')

const item = await nls.getItem('key')
console.log(item?.value) // 'value'
```

---

## 📋 Feature Overview

| Feature                         | Description                                              |
| ------------------------------- | -------------------------------------------------------- |
| `localStorage`-like API         | Familiar `setItem`, `getItem`, `removeItem`, etc.        |
| Cross-tab/browser/device/domain | Seamless state sharing across environments               |
| Real-time sync                  | WebSocket-based updates, instant across clients          |
| Optional end-to-end encryption  | Data encrypted client-side, never readable on the server |
| TTL support                     | Auto-expiry per key or object                            |
| Event system                    | Listen to changes, removals, messages                    |
| SyncObject API                  | Reactive object that syncs automatically                 |
| Full TypeScript support         | Strong typings, interfaces, autocompletion               |
| Works in browsers and Node.js   | Cross-platform by design                                 |

---

## 📚 API Reference

### Constructor

```ts
new NonLocalStorage(credentials, options?)
```

**Parameters:**

* `credentials`: `{ apiKey, apiSecret, projectId }`
* `options` *(optional)*:

  * `id`: custom object ID (defaults to random)
  * `class`: namespace for logical separation (default: `_undefined_`)
  * `ttl`: default expiration in ms (default: 1h)
  * `passphrase`: enables end-to-end encryption
  * `idSignature`, `idSignatureKeyVersion`: for signed object ID access

---

### Storage Methods

```ts
await nls.setItem('key', 'value')
await nls.getItem('key') // returns { value, expiresAt }
await nls.setItems({ key1: { value: 'v1' }, key2: { value: 'v2' } })
await nls.getItems(['key1', 'key2'])
await nls.getAllKeys()
await nls.getAllItems()
await nls.removeItem('key')
await nls.removeItems(['key1', 'key2'])
await nls.clear()
```

---

### 🔄 Real-Time & WebSocket

```ts
nls.send({ message: 'hello' }) // via WS
await nls.send({ message: 'hello' }, { transport: 'http' }) // fallback

nls.on('connect', () => console.log('Connected'))
nls.on('disconnect', () => console.log('Disconnected'))
nls.on('message', msg => console.log('Received:', msg))
nls.on('setItem', event => console.log('Item set:', event))
nls.on('removeItem', event => console.log('Item removed:', event))
nls.disconnect()
```

You can also filter by key:

```ts
nls.on('setItem', 'myKey', e => console.log('myKey changed:', e.value))
```

---

## 🔐 End-to-End Encryption (E2EE)

Enable by passing a `passphrase` when constructing:

```ts
const nls = new NonLocalStorage(credentials, {
  id: 'object-id',
  passphrase: 'secret-passphrase'
})

await nls.getEncryptionSettings() // retrieves salt and version
await nls.setItem('privateKey', 'encrypted-data')
await nls.rotateEncryption()     // rotate key/salt
```

* Encryption is automatic after setup.
* Key versioning and lazy re-encryption on read are supported.

---

## 🔁 SyncObject API

Create a two-way reactive object:

```ts
import { createSyncObject } from 'non-local-storage'

const obj1 = await createSyncObject({ apiKey, apiSecret, projectId }, 'my-id')
obj1.theme = 'dark'

const obj2 = await createSyncObject({ apiKey, apiSecret, projectId }, 'my-id')
console.log(obj2.theme) // 'dark'

obj2.language = 'fr'
// after a moment...
console.log(obj1.language) // 'fr'
```

With TypeScript:

```ts
interface MySettings { theme?: string, language?: string }
const userPrefs = await createSyncObject<MySettings>(credentials, 'prefs-id')
```

---

## 🧠 Tips & Notes

* **Cross-tab sync**: uses WebSocket broadcasts to update all connected clients.
* **Cross-domain support**: great for multi-brand or multi-site applications.
* **Per-item TTLs** can be optionally added in future.
* **E2EE** means even the server can’t read your data.

---

## 📌 Comparing with `localStorage`

| Feature                  | `localStorage` | NonLocalStorage |
| ------------------------ | -------------- | --------------- |
| Cross-tab/browser/device | 🚫             | ✅               |
| Cross-domain             | 🚫             | ✅               |
| Server-side access       | 🚫             | ✅               |
| Real-time sync           | 🚫             | ✅               |
| E2E encryption           | 🚫             | ✅               |
| Data TTL                 | 🚫             | ✅               |


---

## 🧰 Support

Have questions, ideas or feedback? [Open an issue](https://github.com/your-org/non-local-storage) or email us at [support@yourdomain.com](mailto:support@yourdomain.com)

---

Made with ❤️ for developers who need real-time storage, without the backend hassle.
