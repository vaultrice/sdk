# Vaultrice JS/TS SDK

[![Tests](https://github.com/vaultrice/sdk/workflows/node/badge.svg)](https://github.com/vaultrice/sdk/actions?query=workflow%3Anode)
[![npm version](https://img.shields.io/npm/v/@vaultrice/sdk.svg?style=flat-square)](https://www.npmjs.com/package/@vaultrice/sdk)

A secure, real-time cloud storage SDK with a familiar `localStorage`-like API — enhanced for cross-device, cross-domain sync, optional end-to-end encryption (E2EE), presence, and optional offline-first usage.

> Vaultrice is ideal for state sharing between tabs, browsers, devices, or domains — with built-in real-time updates and optional encryption... without managing custom backend WebSocket infrastructure.

> **Vaultrice offers a free tier — [get started](https://www.vaultrice.app/register) without having to pay!**  

---

## Table of contents

1. [Install](#-installation)
2. [Quick start](#-quick-start)
3. [Authentication](#-authentication)
4. [Feature overview](#-feature-overview)
4. [API overview](#-api-overview)
6. [Presence & messaging](#-presence--messaging)
7. [End-to-end encryption (E2EE)](#-end-to-end-encryption-e2ee)
8. [SyncObject (reactive object)](#-syncobject-reactive-object)
9. [Offline-first APIs](#-offline-first-apis)
10. [Durable Object Location Strategy](#-durable-object-location-strategy)
11. [Which API Should I Use?](#-which-api-should-i-use)
12. [Real-World Examples](#-real-world-examples)
12. [Support](#-support)

---

## 🔧 Installation

```bash
npm install @vaultrice/sdk
# or
yarn add @vaultrice/sdk
```

---

## 🚀 Quick start

```ts
import { NonLocalStorage } from '@vaultrice/sdk'

const nls = new NonLocalStorage({
  projectId: 'your-project-id',
  apiKey: 'your-api-key',
  apiSecret: 'your-api-secret'
}, 'your-object-id') // optional explicit ID

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
| **Offline-first API**           | `createOfflineNonLocalStorage`, `createOfflineSyncObject`|
| Custom storage adapters         | Use IndexedDB, SQLite, or any custom backend (default: LocalStorage)             |
| Full TypeScript support         | Strong typings, interfaces, autocompletion               |
| Works in browsers and Node.js   | Cross-platform by design                                 |

---

## 📚 API overview

### Constructor

```ts
new NonLocalStorage(credentials, options?)
```

**Parameters:**

* `credentials`: `{ projectId, apiKey, apiSecret }`
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
await nls.getItem('key') // returns { value, expiresAt, createdAt, updatedAt }
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
nls.isConnected // true | false
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
import { createSyncObject } from '@vaultrice/sdk'

const obj1 = await createSyncObject({ projectId, apiKey, apiSecret }, 'my-id')
obj1.theme = 'dark'

const obj2 = await createSyncObject({ projectId, apiKey, apiSecret }, 'my-id')
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

SyncObjects now expose the full event system through `on` and `off` methods:

```ts
const syncObj = await createSyncObject({ projectId, apiKey, apiSecret }, 'room-id')

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
syncObj.isConnected // true | false

// Listen for presence events
syncObj.on('presence:join', (connection) => {
  console.log(`${connection.data.name} joined`)
  showUserAvatar(connection.data)
})

syncObj.on('presence:leave', (connection) => {
  console.log(`${connection.data.name} left`)
  hideUserAvatar(connection.connectionId)
})

// Listen for messages
syncObj.on('message', (msg) => {
  if (msg.type === 'cursor-move') {
    updateCursor(msg.userId, msg.position)
  }
})

// Listen for errors
syncObj.on('error', (error) => console.error('Sync error:', error))

// Remove event listeners
const themeHandler = (item) => console.log('Theme:', item.value)
syncObj.on('setItem', 'theme', themeHandler)
syncObj.off('setItem', 'theme', themeHandler) // Remove specific handler
```

### SyncObject Presence & Messaging

SyncObjects now include built-in presence awareness and real-time messaging:

```ts
const collabDoc = await createSyncObject({ projectId, apiKey, apiSecret }, 'doc-123')

// Join presence with user info
await collabDoc.join({ 
  userId: 'user-123', 
  name: 'Alice',
  avatar: 'avatar1.png',
  cursor: { x: 0, y: 0 }
})

// Access live list of connected users
console.log(`${collabDoc.joinedConnections.length} users online`)
collabDoc.joinedConnections.forEach(user => {
  console.log(`${user.data.name} joined at ${new Date(user.joinedAt)}`)
})

// Send real-time messages
await collabDoc.send({
  type: 'cursor-move',
  userId: 'user-123',
  position: { x: 150, y: 300 }
})

// Send via HTTP fallback instead of WebSocket
await collabDoc.send({ 
  type: 'important-notification',
  message: 'Document saved successfully'
}, { transport: 'http' })

// Leave presence (also automatic on disconnect)
await collabDoc.leave()
```

### SyncObject Features Summary

| Feature | Description |
|---------|-------------|
| **Automatic Sync** | Properties sync instantly across all connected clients |
| **Type Safety** | Full TypeScript support with custom interfaces |
| **Event System** | Complete event system including presence and messaging |
| **Presence Aware** | Know who's online with `joinedConnections` property |
| **Real-time Messaging** | Send and receive custom messages between clients |
| **Encryption Ready** | Optional end-to-end encryption for sensitive data |
| **Protected Properties** | Reserved properties are read-only and cannot be overwritten |
| **TTL Support** | Properties can expire automatically |
| **Cross-Platform** | Works in browsers, Node.js, React Native, etc. |

### When to Use SyncObject vs NonLocalStorage

**Use SyncObject when:**
- You want an object-like interface with property assignment
- You need automatic synchronization of object properties
- You want presence awareness with minimal setup
- You prefer reactive programming patterns
- You're building collaborative applications

**Use NonLocalStorage when:**
- You need fine-grained control over storage operations
- You prefer explicit method calls (setItem, getItem, etc.)
- You're building complex real-time architectures
- You need advanced features like atomic increment/decrement
- You want to separate storage from presence/messaging logic

---

## 🔐 Authentication

The SDK supports **three** authentication approaches — choose based on your threat model and architecture:

1. **apiKey + apiSecret** (SDK automatically fetches and refreshes short-lived `accessToken`)

   * Easiest to use for quick builds and server-side code.
   * If used in clients, combine with origin restrictions or a proxy.

2. **accessToken** (short-lived token, e.g. \~1 hour) — manual refresh

   * Your backend issues a token and the client receives it.
   * You are responsible for refreshing the token before expiry.

3. **getAccessToken** (async function that returns a token) — recommended for production

   * The SDK calls the function when it needs a token or when a token is close to expiry.
   * You can optionally provide an initial `accessToken` together with `getAccessToken` for immediate use (the SDK will validate & auto-refresh as needed).

### Example: token-provider (recommended)

```ts
const nls = new NonLocalStorage({
  projectId: 'my-project-id',
  accessToken: 'initial-token-if-available',
  getAccessToken: async () => {
    // call your backend to get a fresh token
    const r = await fetch('/api/vaultrice-token')
    if (!r.ok) throw new Error('token fetch failed')
    const { accessToken } = await r.json()
    return accessToken
  }
})
```

### Access token expiry hooks (if no getAccessToken defined)

```ts
nls.onAccessTokenExpiring(() => {
  // ~2 minutes before expiry - useful to prefetch a token or show UX
  const token = await refreshTokenFromBackend()
  nls.useAccessToken(token)
})
```

---

### Choosing an approach

| Option                  | Token refresh | Secrets in client? | Example uses                                    |
| ----------------------- | ------------- | ------------------ | ----------------------------------------------- |
| apiKey + apiSecret      | Auto          | Yes (if in client) | Quick setup, automatic renewal, flexible        |
| Short-lived accessToken | Manual        | No                 | Environments where you avoid long-lived secrets |

> **Note:** Both methods are fully supported — it’s up to you to decide which fits your architecture and security model.


---

## 📚 API overview

### Constructor

```ts
new NonLocalStorage(credentials, options?)
```

**credentials**: `{ projectId, apiKey?, apiSecret?, accessToken?, getAccessToken? }`
**options**: `{ id?, class?, ttl?, passphrase?, getEncryptionHandler?, ... }`

### Storage API (familiar)

```ts
await nls.setItem('key', value)
const item = await nls.getItem('key') // { value, createdAt, updatedAt, expiresAt, keyVersion? }
await nls.setItems({ key1: { value }, key2: { value } })
await nls.getItems(['key1','key2'])
await nls.getAllKeys()
await nls.getAllItems()
await nls.removeItem('key')
await nls.removeItems(['k1','k2'])
await nls.clear()
```

### Events & realtime

```ts
nls.on('connect', () => {})
nls.on('disconnect', () => {})
nls.on('message', msg => {})
nls.on('setItem', evt => {})                     // all
nls.on('setItem', 'myKey', evt => {})            // key-specific
nls.on('removeItem', evt => {})
nls.on('error', e => {})
nls.off('setItem', handler)
```

### Send messages

```ts
nls.send({ type: 'chat', message: 'hi' })                 // via WebSocket
await nls.send({ type: 'notice' }, { transport: 'http' }) // via HTTP (also reaches sender)
```


## 👥 Presence & messaging

```ts
await nls.join({ userId: 'u1', name: 'Alice' })  // announces presence
await nls.leave()                                 // leave presence
const conns = await nls.getJoinedConnections()   // get {connectionId, joinedAt, data}
nls.on('presence:join', c => {})                 // listen for joins
nls.on('presence:leave', c => {})                // listen for leaves
```

Messages sent through `nls.send` with `transport: 'ws'` are broadcast to other connected clients (not echoed to sender). `transport: 'http'` reaches all clients including sender.

---

## 🔐 End-to-end encryption (E2EE)

Enable by passing `passphrase` or `getEncryptionHandler` when constructing:

```ts
const nls = new NonLocalStorage(credentials, {
  id: 'object-id',
  passphrase: 'super secret'
})

await nls.getEncryptionSettings()   // fetch salt + key version
await nls.setItem('secret', 'value') // automatically encrypted when needed
```

* The SDK supports key versioning and lazy decryption of previous keys.
* Use `rotateEncryption()` to create a new key version.

---

## 🧩 SyncObject (reactive object)

High-level reactive object API that syncs fields automatically across clients with presence and messaging:

```ts
import { createSyncObject } from '@vaultrice/sdk'

const doc = await createSyncObject(credentials, 'doc-123')
doc.title = 'Hello'             // auto-sync to other clients
console.log(doc.title)          // for another client
doc.on('setItem', (evt) => {})  // or additionally listen to property changes
await doc.join({ name: 'Bob' }) // presence
await doc.send({ type: 'cursor', x: 10 })
```

---

## 📴 Offline-First APIs

Vaultrice now supports **offline-first** storage and sync, making your app resilient to network interruptions.

### OfflineNonLocalStorage

A drop-in replacement for `NonLocalStorage` that works offline and automatically syncs changes when reconnected.

```ts
import { createOfflineNonLocalStorage } from '@vaultrice/sdk'

const nls = await createOfflineNonLocalStorage(
  { projectId: 'your-project-id', apiKey: 'your-api-key', apiSecret: 'your-api-secret' },
  { id: 'your-id', ttl: 60000 }
)

await nls.setItem('key', 'value') // Works offline!
const item = await nls.getItem('key')
console.log(item.value) // 'value'
```

- **Local-first:** Reads/writes use local storage when offline.
- **Automatic sync:** Queues changes and syncs with the server when online.
- **Conflict resolution:** Last-write-wins by default, customizable.
- **Custom storage adapters:** Use your own storage backend (IndexedDB, SQLite, etc).

### OfflineSyncObject

A reactive object that syncs properties locally and remotely, with offline support.

```ts
import { createOfflineSyncObject } from '@vaultrice/sdk'

const obj = await createOfflineSyncObject(
  { projectId: 'your-project-id', apiKey: 'your-api-key', apiSecret: 'your-api-secret' },
  { id: 'your-id', ttl: 60000 }
)

obj.foo = 'bar' // Updates locally and syncs when online
console.log(obj.foo) // 'bar'
```

- **Proxy-based:** Use like a normal JS object.
- **Events:** Listen for changes, removals, presence, and messages.
- **Presence:** Track who’s online, join/leave notifications.
- **Works offline:** Changes are queued and synchronized automatically.


This makes it safe on mobile, airplane mode, or unstable networks.


### 🛠️ Custom Storage Adapter

You can inject your own storage backend for offline mode (for example, IndexedDB, SQLite, or any custom implementation).

Pass your adapter via the `storage` option when creating an offline instance:

```ts
import { createOfflineNonLocalStorage } from '@vaultrice/sdk'

// Example: a minimal custom adapter
class MyAdapter {
  async get(key) { /* ... */ },
  async set(key, value) { /* ... */ },
  async remove(key) { /* ... */ },
  async getAll() { /* ... */ }
}

const nls = await createOfflineNonLocalStorage(
  { projectId: 'your-project-id', apiKey: 'your-api-key', apiSecret: 'your-api-secret' },
  { id: 'your-id', storage: MyAdapter }
)

// Now all offline reads/writes use your adapter!
await nls.setItem('foo', 'bar')
```

**Requirements:**  
Your adapter should implement these async methods:  
- `get(key): Promise<any>`
- `set(key, value): Promise<void>`
- `remove(key): Promise<void>`
- `getAll(): Promise<Record<string, any>>`

This works for both `createOfflineNonLocalStorage` and

---

## 📍 Durable Object Location Strategy

Vaultrice uses Cloudflare Durable Objects. The **first successful request** for an ID fixes its "home" region:

* All subsequent writes for that ID go to that region.
* Useful for data residency & latency considerations.
* To enforce regions, initialize from the right region first:

```ts
const prefsUS = await createSyncObject(credentials, 'prefs-us') // US region
const prefsEU = await createSyncObject(credentials, 'prefs-eu') // EU region
```

---

## 📦 Which API Should I Use?

| Use Case                       | Recommended API           |
| ------------------------------ | ------------------------- |
| Simple, key-based storage      | `NonLocalStorage`         |
| Real-time object sync          | `createSyncObject`        |
| Works offline with auto-resync | `createOfflineSyncObject` or `createOfflineNonLocalStorage` |

---

## 🚀 Real-World Examples

### Collaborative Text Editor (Full SyncObject)

```ts
interface DocumentState {
  content?: string
  title?: string
  lastModified?: number
  selectedText?: { start: number, end: number }
}

const doc = await createSyncObject<DocumentState>(credentials, 'doc-123')

// Join as a user
await doc.join({ 
  userId: 'user-123', 
  name: 'Alice',
  avatar: 'avatar1.png',
  role: 'editor'
})

// Real-time collaborative editing
doc.on('setItem', 'content', (item) => {
  if (item.value !== editor.getText()) {
    editor.setText(item.value) // Update editor with remote changes
  }
})

// Auto-save on edit
editor.on('text-change', () => {
  doc.content = editor.getText()
  doc.lastModified = Date.now()
})

// Show who's editing
doc.on('presence:join', (conn) => {
  showActiveUser(conn.data)
  showNotification(`${conn.data.name} joined the document`)
})

doc.on('presence:leave', (conn) => {
  hideActiveUser(conn.connectionId)
  showNotification(`${conn.data.name} left the document`)
})

// Real-time cursor sharing
doc.on('message', (msg) => {
  if (msg.type === 'cursor-move') {
    updateCursor(msg.userId, msg.position)
  } else if (msg.type === 'selection') {
    showSelection(msg.userId, msg.range)
  }
})

// Send cursor updates
editor.on('cursor-move', (position) => {
  doc.send({ 
    type: 'cursor-move', 
    userId: 'user-123', 
    position,
    timestamp: Date.now()
  })
})

// Send text selection updates
editor.on('selection-change', (range) => {
  doc.send({ 
    type: 'selection', 
    userId: 'user-123', 
    range,
    timestamp: Date.now()
  })
})

// Show live user count
const updateUserCount = () => {
  userCountElement.textContent = `${doc.joinedConnections.length} users online`
}
doc.on('presence:join', updateUserCount)
doc.on('presence:leave', updateUserCount)
updateUserCount() // Initial count
```

### Real-Time Gaming with SyncObject

```ts
interface GameState {
  players?: { [id: string]: { x: number, y: number, score: number, health: number } }
  gameStatus?: 'waiting' | 'playing' | 'finished'
  currentRound?: number
}

const game = await createSyncObject<GameState>(credentials, 'game-room-456')

// Join as player
await game.join({ 
  playerId: 'player-123', 
  name: 'Alice',
  character: 'warrior',
  level: 15
})

// Initialize game state
if (!game.gameStatus) {
  game.gameStatus = 'waiting'
  game.players = {}
  game.currentRound = 1
}

// Update player position
function movePlayer(x: number, y: number) {
  if (!game.players) game.players = {}
  game.players = {
    ...game.players,
    'player-123': { 
      ...(game.players['player-123'] || { score: 0, health: 100 }),
      x, 
      y 
    }
  }
}

// Listen for game state changes
game.on('setItem', 'players', (item) => {
  updateGameBoard(item.value)
})

game.on('setItem', 'gameStatus', (item) => {
  if (item.value === 'playing') {
    startGameLoop()
  } else if (item.value === 'finished') {
    showGameResults()
  }
})

// Handle player actions via messaging
game.on('message', (msg) => {
  switch (msg.type) {
    case 'attack':
      handleAttack(msg.from, msg.target, msg.damage)
      break
    case 'power-up':
      handlePowerUp(msg.playerId, msg.powerUpType)
      break
    case 'chat':
      showChatMessage(msg.from, msg.message)
      break
  }
})

// Send attack action
function attack(targetPlayerId: string, damage: number) {
  game.send({
    type: 'attack',
    from: 'player-123',
    target: targetPlayerId,
    damage,
    timestamp: Date.now()
  })
}

// Show live player list
game.on('presence:join', (conn) => {
  addPlayerToLobby(conn.data)
})

game.on('presence:leave', (conn) => {
  removePlayerFromLobby(conn.connectionId)
  
  // Remove from game state too
  if (game.players && game.players[conn.data.playerId]) {
    const updatedPlayers = { ...game.players }
    delete updatedPlayers[conn.data.playerId]
    game.players = updatedPlayers
  }
})
```

---

## 🧰 Support

Have questions, ideas or feedback? [Open an issue](https://github.com/vaultrice/sdk) or email us at [support@vaultrice.com](mailto:support@vaultrice.com)

---

Made with ❤️ for developers who need real-time storage, without the backend hassle.
