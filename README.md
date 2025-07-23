# NonLocalStorage JS/TS SDK

A secure, real-time, cloud-based storage SDK with a familiar `localStorage`-like API — enhanced for cross-device, cross-domain sync, and optional end-to-end encryption.

> NonLocalStorage is ideal for state sharing between tabs, browsers, devices, or domains — with built-in real-time updates and optional encryption.

---

## 🔧 Installation

```bash
npm install vaultrice
```

---

## 🚀 Quick Start

```ts
import { NonLocalStorage } from 'vaultrice'

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
nls.on('error', error => console.log('Error:', error))

// Remove event listeners
nls.off('connect', connectHandler)
nls.off('setItem', itemHandler)

nls.disconnect()
```

You can also filter by key:

```ts
nls.on('setItem', 'myKey', e => console.log('myKey changed:', e.value))
nls.off('setItem', 'myKey', keySpecificHandler) // Remove specific key listener
```

---

## 👥 Presence API

Track who's online and get notified when users join or leave:

```ts
// Join presence for this object
await nls.join({ userId: 'my-user-id' })

// Leave presence (done automatically also on disconnect)
await nls.leave()

// Get all currently connected clients
const connections = await nls.getJoinedConnections()
console.log(connections) // Array of connection info
// [{ connectionId: 'some-id', joinedAt: 1750961579094, data: { userId: 'my-user-id' } }]

// Listen for presence events
nls.on('presence:join', (joinedConnection) => {
  console.log('User joined:', joinedConnection)
  // { connectionId: 'some-id', joinedAt: 1750961579094, data: { userId: 'my-user-id' } }
})

nls.on('presence:leave', (leavedConnection) => {
  console.log('User left:', leavedConnection)
  // { connectionId: 'some-id', data: { userId: 'my-user-id' } }
})

// Remove presence event listeners
nls.off('presence:join', joinHandler)
nls.off('presence:leave', leaveHandler)
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

Create a two-way reactive object that automatically syncs properties across all connected clients:

```ts
import { createSyncObject } from 'vaultrice'

const obj1 = await createSyncObject({ apiKey, apiSecret, projectId }, 'my-id')
obj1.theme = 'dark'

const obj2 = await createSyncObject({ apiKey, apiSecret, projectId }, 'my-id')
console.log(obj2.theme) // 'dark'

obj2.language = 'fr'
// after a moment...
console.log(obj1.language) // 'fr'
```

### SyncObject with TypeScript

```ts
interface MySettings { 
  theme?: 'light' | 'dark'
  language?: string
  fontSize?: number
}

const userPrefs = await createSyncObject<MySettings>(credentials, 'prefs-id')
userPrefs.theme = 'dark' // Fully typed!
```

### SyncObject Event Handling

SyncObjects expose a limited set of events through `on` and `off` methods:

```ts
const syncObj = await createSyncObject({ apiKey, apiSecret, projectId }, 'room-id')

// Listen for real-time property changes
syncObj.on('setItem', (item) => {
  console.log(`Property ${item.prop} changed to:`, item.value)
})

// Listen for specific property changes
syncObj.on('setItem', 'theme', (item) => {
  console.log('Theme changed to:', item.value)
  updateUI(item.value)
})

// Listen for property removals
syncObj.on('removeItem', (item) => {
  console.log(`Property ${item.prop} was removed`)
})

// Listen for connection events
syncObj.on('connect', () => console.log('Connected to real-time sync'))
syncObj.on('disconnect', () => console.log('Disconnected'))

// Listen for errors
syncObj.on('error', (error) => console.error('Sync error:', error))

// Remove event listeners
const themeHandler = (item) => console.log('Theme:', item.value)
syncObj.on('setItem', 'theme', themeHandler)
syncObj.off('setItem', 'theme', themeHandler) // Remove specific handler
```

**Note:** SyncObjects only support connection, error, and data change events (`setItem`, `removeItem`). For presence awareness and custom messaging, use the full NonLocalStorage API.

### SyncObject with Encryption

```ts
const encryptedSync = await createSyncObject(credentials, {
  id: 'private-notes',
  passphrase: 'my-secret-passphrase'
})

// All properties are automatically encrypted
encryptedSync.secretNote = 'This is encrypted end-to-end'
encryptedSync.apiKey = 'sk-1234567890abcdef'

// Events work the same way (data is decrypted automatically)
encryptedSync.on('setItem', (item) => {
  console.log('Decrypted value:', item.value) // Already decrypted!
})
```

### SyncObject Features Summary

| Feature | Description |
|---------|-------------|
| **Automatic Sync** | Properties sync instantly across all connected clients |
| **Type Safety** | Full TypeScript support with custom interfaces |
| **Event System** | Listen for property changes and connection events |
| **Encryption Ready** | Optional end-to-end encryption for sensitive data |
| **Protected Properties** | `id`, `on`, and `off` are read-only and cannot be overwritten |
| **TTL Support** | Properties can expire automatically |
| **Cross-Platform** | Works in browsers, Node.js, React Native, etc. |

### When to Use SyncObject vs NonLocalStorage

**Use SyncObject when:**
- You want an object-like interface with property assignment
- You need automatic synchronization of object properties
- You prefer reactive programming patterns
- You're building simple state synchronization

**Use NonLocalStorage when:**
- You need presence awareness (join/leave events)
- You want to send custom messages between clients
- You need the full event system (presence:join, presence:leave, message)
- You prefer explicit method calls (setItem, getItem, etc.)
- You're building real-time collaboration features

---

## 🧠 Tips & Notes

* **Cross-tab sync**: uses WebSocket broadcasts to update all connected clients.
* **Cross-domain support**: great for multi-brand or multi-site applications.
* **SyncObject limitations**: No presence events or custom messaging. Use NonLocalStorage for these features.
* **Event cleanup**: Always remove event listeners with `off()` to prevent memory leaks.
* **Per-item TTLs** can be optionally added in future.
* **E2EE** means even the server can't read your data.
* **Presence data**: Available only with NonLocalStorage, not SyncObject.

---

## 📌 Comparing with `localStorage`

| Feature                   | `localStorage` | `NonLocalStorage` | `SyncObject` |
| ------------------------- | -------------- | --------------- | ------------ |
| Cross-tab/browser/device  | 🚫             | ✅               | ✅            |
| Cross-domain              | 🚫             | ✅               | ✅            |
| Server-side access        | 🚫             | ✅               | ✅            |
| Real-time sync            | 🚫             | ✅               | ✅            |
| E2E encryption            | 🚫             | ✅               | ✅            |
| Data TTL                  | 🚫             | ✅               | ✅            |
| Event system              | 🚫             | ✅               | ✅ (limited)   |
| Object-like interface     | 🚫             | 🚫               | ✅            |
| Presence awareness        | 🚫             | ✅               | 🚫            |
| Custom messaging          | 🚫             | ✅               | 🚫            |
| Type safety               | 🚫             | ✅               | ✅            |

---

## 🚀 Real-World Examples

### Simple Settings Sync with SyncObject

```ts
interface AppSettings {
  theme?: 'light' | 'dark'
  language?: string
  notifications?: boolean
}

const settings = await createSyncObject<AppSettings>(credentials, 'user-settings')

// Sync theme across all tabs
settings.on('setItem', 'theme', (item) => {
  document.body.className = `theme-${item.value}`
})

// Update from UI
themeToggle.onclick = () => {
  settings.theme = settings.theme === 'light' ? 'dark' : 'light'
}
```

### Collaborative Editor with NonLocalStorage (Full Features)

```ts
interface DocumentState {
  content?: string
  title?: string
  lastModified?: number
}

// Use NonLocalStorage for presence and messaging
const nls = new NonLocalStorage(credentials, 'doc-123')

// Set up the document state
await nls.setItem('content', '')
await nls.setItem('title', 'Untitled Document')

// Listen for content changes
nls.on('setItem', 'content', async (item) => {
  if (item.value !== editor.getText()) {
    editor.setText(item.value) // Update editor with remote changes
  }
})

// Auto-save on edit
editor.on('text-change', async () => {
  await nls.setItem('content', editor.getText())
  await nls.setItem('lastModified', Date.now())
})

// Show who's editing (presence awareness)
await nls.join({ userId: 'user-123', name: 'Alice' })

nls.on('presence:join', (conn) => {
  showActiveUser(conn.data)
})

nls.on('presence:leave', (conn) => {
  hideActiveUser(conn.connectionId)
})

// Real-time cursor positions
nls.on('message', (msg) => {
  if (msg.type === 'cursor') {
    updateCursor(msg.userId, msg.position)
  }
})

// Send cursor updates
editor.on('cursor-move', (position) => {
  nls.send({ type: 'cursor', userId: 'user-123', position })
})
```

### Simple Game State with SyncObject

```ts
interface GameState {
  score?: number
  level?: number
  playerName?: string
}

const game = await createSyncObject<GameState>(credentials, 'game-session')

// Listen for score updates
game.on('setItem', 'score', (item) => {
  updateScoreDisplay(item.value)
})

// Update score
function addScore(points: number) {
  game.score = (game.score || 0) + points
}
```

---

## 🧰 Support

Have questions, ideas or feedback? [Open an issue](https://github.com/vaultrice/sdk) or email us at [support@vaultrice.com](mailto:support@vaultrice.com)

---

Made with ❤️ for developers who need real-time storage, without the backend hassle.
