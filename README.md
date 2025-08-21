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
3. [Feature overview](#-feature-overview)
4. [Authentication](#-authentication)
5. [API overview](#-api-overview)
6. [Presence & messaging](#-presence--messaging)
7. [End-to-end encryption (E2EE)](#-end-to-end-encryption-e2ee)
8. [SyncObject (reactive object)](#-syncobject-reactive-object)
9. [Offline-first APIs](#-offline-first-apis)
10. [Durable Object Location Strategy](#-durable-object-location-strategy)
11. [Which API Should I Use?](#-which-api-should-i-use)
12. [Real-World Examples](#-real-world-examples)
12. [Support](#-support)

---

<span id="-installation"></span>

## 🔧 Installation

```bash
npm install @vaultrice/sdk
# or
yarn add @vaultrice/sdk
```

---

<span id="-quick-start"></span>

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

<span id="-feature-overview"></span>

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
| Offline-first API           | `createOfflineNonLocalStorage`, `createOfflineSyncObject`|
| Custom storage adapters         | Use IndexedDB, SQLite, or any custom backend (default: LocalStorage)             |
| Full TypeScript support         | Strong typings, interfaces, autocompletion               |
| Works in browsers and Node.js   | Cross-platform by design                                 |

---

<span id="-authentication"></span>

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

### Server-side: Retrieve an access token on the backend

You can securely mint access tokens on your backend using:

```ts
import { retrieveAccessToken } from '@vaultrice/sdk'

const accessToken = await retrieveAccessToken('projectId', 'apiKey', 'apiSecret')
// Optionally pass origin if the api key has origin restriction:
// const accessToken = await retrieveAccessToken('projectId', 'apiKey', 'apiSecret', { origin: 'https://your-app.com' })
```

---

### Choosing an approach

| Option                  | Token refresh | Secrets in client? | Example uses                                    |
| ----------------------- | ------------- | ------------------ | ----------------------------------------------- |
| apiKey + apiSecret      | Auto          | Yes (if in client) | Quick setup, automatic renewal, flexible        |
| Short-lived accessToken | Manual        | No                 | Environments where you avoid long-lived secrets |

> **Note:** Both methods are fully supported — it’s up to you to decide which fits your architecture and security model.

Read more about it [here](https://www.vaultrice.com/docs/security/#authentication-methods).


---

<span id="-api-overview"></span>

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

<span id="-presence--messaging"></span>

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

<span id="-end-to-end-encryption-e2ee"></span>

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

<span id="-syncobject-reactive-object"></span>

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

<span id="-offline-first-apis"></span>

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

<span id="-durable-object-location-strategy"></span>

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

<span id="-which-api-should-i-use"></span>

## 📦 Which API Should I Use?

| Use Case                       | Recommended API           |
| ------------------------------ | ------------------------- |
| Simple, key-based storage      | `NonLocalStorage`         |
| Real-time object sync          | `createSyncObject`        |
| Works offline with auto-resync | `createOfflineSyncObject` or `createOfflineNonLocalStorage` |

---

<span id="-real-world-examples"></span>

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

<span id="-support"></span>

## 🧰 Support

Have questions, ideas or feedback? [Open an issue](https://github.com/vaultrice/sdk) or email us at [support@vaultrice.com](mailto:support@vaultrice.com)

---

Made with ❤️ for developers who need real-time storage, without the backend hassle.
