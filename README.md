# NonLocalStorage JS/TS-SDK

A cloud-based storage SDK that provides localStorage-like API with real-time synchronization, WebSocket support, and end-to-end encryption capabilities.

## Features

- **localStorage-like API** - Familiar methods for storing and retrieving data
- **Real-time synchronization** - WebSocket support for live data updates
- **End-to-end encryption** - Optional client-side encryption with key rotation
- **Event system** - Listen for storage changes and custom messages
- **TypeScript support** - Full type definitions included
- **Cross-platform** - Works in browsers and Node.js environments

## Installation

```bash
npm install non-local-storage
```

## Quick Start

```javascript
import NonLocalStorage from 'non-local-storage'

// Initialize with your credentials
const nls = new NonLocalStorage({
  apiKey: 'your-api-key',
  apiSecret: 'your-api-secret',
  projectId: 'your-project-id'
}, 'your-id') // if not provided it will generate a new id

// Basic usage
await nls.setItem('key', 'value')
const item = await nls.getItem('key')
console.log(item.value) // 'value'
```

## API Reference

### Constructor

```javascript
new NonLocalStorage(credentials, options?)
```

**Parameters:**
- `credentials` - Object containing `apiKey`, `apiSecret`, and `projectId`
- `options` - Optional configuration object
  - `id` - Custom instance ID
  - `class` - Storage class/namespace, defaults to `_undefined_`
  - `ttl`- Default time-to-live (in ms), defaults to 1h = 60 * 60 * 1000
  - `passphrase` - Passphrase for end-to-end encryption
  - `idSignature` - Used for object id signature verification
  - `idSignatureKeyVersion` - Used for object id signature verification

### Storage Methods

#### `setItem(key, value, options?)`
Store a value with the specified key.

```javascript
const result = await nls.setItem('myKey', 'myValue')
console.log(result.expiresAt) // Expiration timestamp in ms
```

#### `getItem(key)`
Retrieve a value by key.

```javascript
const item = await nls.getItem('myKey')
if (item) {
  console.log(item.value) // The stored value
  console.log(item.expiresAt) // Expiration timestamp in ms
}
```

#### `setItems(items)`
Store multiple key-value pairs at once.

```javascript
const results = await nls.setItems({
  'key1': { value: 'value1' },
  'key2': { value: 'value2' }
})
```

#### `getItems(keys)`
Retrieve multiple values by their keys.

```javascript
const items = await nls.getItems(['key1', 'key2'])
console.log(items.key1.value) // 'value1'
```

#### `removeItem(key)`
Remove a single item.

```javascript
await nls.removeItem('myKey')
```

#### `removeItems(keys)`
Remove multiple items.

```javascript
await nls.removeItems(['key1', 'key2'])
```

#### `getAllItems()`
Retrieve all stored items.

```javascript
const allItems = await nls.getAllItems()
```

#### `getAllKeys()`
Get all stored keys.

```javascript
const keys = await nls.getAllKeys()
```

#### `clear()`
Remove all stored items.

```javascript
await nls.clear()
```

### WebSocket Methods

#### `send(message, options?)`
Send a message through WebSocket or HTTP.

```javascript
// Send via WebSocket (default)
nls.send({ message: 'Hello' })

// Send via HTTP
await nls.send({ message: 'Hello' }, { transport: 'http' })
```

#### `on(event, callback)` / `on(event, key, callback)`
Listen for events.

```javascript
// Listen for connection events
nls.on('connect', () => console.log('Connected'))
nls.on('disconnect', () => console.log('Disconnected'))
nls.on('error', (error) => console.log('Error:', error))

// Listen for messages
nls.on('message', (message) => console.log('Received:', message))

// Listen for storage events
nls.on('setItem', (event) => {
  console.log(`Item set: ${event.prop} = ${event.value}`)
})

// Listen for specific key changes
nls.on('setItem', 'myKey', (event) => {
  console.log(`myKey updated: ${event.value}`)
})

nls.on('removeItem', (event) => {
  console.log(`Item removed: ${event.prop}`)
})
```

#### `disconnect()`
Close the WebSocket connection.

```javascript
nls.disconnect()
```

## End-to-End Encryption

Enable client-side encryption by providing a passphrase:

```javascript
const storage = new NonLocalStorage({
  apiKey: 'your-api-key',
  apiSecret: 'your-api-secret',
  projectId: 'your-project-id'
}, {
  id: 'unique-client-id',
  passphrase: 'your-secret-passphrase'
})

// Initialize encryption settings
await nls.getEncryptionSettings()

// All data will now be encrypted before sending to the server
await nls.setItem('secret', 'encrypted-data')

// Rotate encryption keys
await nls.rotateEncryption()
```

## Events

The SDK emits various events you can listen to:

- `connect` - WebSocket connection established
- `disconnect` - WebSocket connection closed
- `error` - Error occurred
- `message` - Custom message received
- `setItem` - Item was stored (with optional key filter)
- `removeItem` - Item was removed (with optional key filter)
