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

SyncObjects now expose the full event system through `on` and `off` methods:

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
const collabDoc = await createSyncObject({ apiKey, apiSecret, projectId }, 'doc-123')

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

The key improvements with this implementation:

1. **Full Feature Parity**: SyncObject now has all the capabilities of NonLocalStorage
2. **Automatic Presence Management**: `joinedConnections` is automatically updated via events
3. **Simplified API**: Direct method access (`obj.join()`, `obj.send()`) instead of going through the underlying NLS instance
4. **Protected Properties**: All reserved properties are properly protected
5. **Live Updates**: The `joinedConnections` property updates in real-time as users join/leave
6. **Type Safety**: Full TypeScript support for all new methods and properties

This makes SyncObject a complete solution for real-time collaborative applications while maintaining the simple object-like interface that makes it appealing.

---

## 🧰 Support

Have questions, ideas or feedback? [Open an issue](https://github.com/vaultrice/sdk) or email us at [support@vaultrice.com](mailto:support@vaultrice.com)

---

Made with ❤️ for developers who need real-time storage, without the backend hassle.
