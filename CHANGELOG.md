# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.4](https://github.com/vaultrice/sdk/compare/v1.0.3...v1.0.4) - 2025-09-08

- The first element in JoinedConnections is always the own connection

## [1.0.3](https://github.com/vaultrice/sdk/compare/v1.0.2...v1.0.3) - 2025-09-08

- Improve WebSocket connection reliability: `connect` event and `isConnected` property now only trigger after server handshake is complete (when `connectionId` is assigned), ensuring connection is fully ready for presence and messaging

## [1.0.2](https://github.com/vaultrice/sdk/compare/v1.0.1...v1.0.2) - 2025-09-08

- Expose `connectionId` property on all APIs (NonLocalStorage, SyncObject, OfflineNonLocalStorage, OfflineSyncObject) to allow identifying your own connection

## [1.0.1](https://github.com/vaultrice/sdk/compare/v1.0.0...v1.0.1) - 2025-09-08

- Fix WebSocket connection handling when `waitForOpen` is true and connection is still establishing

## [1.0.0](https://github.com/vaultrice/sdk/compare/v0.9.21...v1.0.0) - 2025-09-06

- First official stable release. This marks the SDK as production-ready.
- Added splice() array helper (server + offline behavior) for in-place remove/replace operations on array values.
- Optional Optimistic Concurrency Control (OCC): all write operations can accept an optional `updatedAt` value to enable conflict detection (server returns HTTP 409 on mismatch). Supported across setItem, setItems, increment, decrement, merge, push, setIn, splice.
- Public API is considered stable; any future breaking changes will require a major version bump per SemVer.
- No migration steps required for users upgrading from 0.9.x.
- Thanks to all contributors and early adopters.

## [0.9.21](https://github.com/vaultrice/sdk/compare/v0.9.20...v0.9.21) - 2025-09-05

- add push, merge, setIn functionality

## [0.9.20](https://github.com/vaultrice/sdk/compare/v0.9.19...v0.9.20) - 2025-08-28

- improve OfflineNonLocalStorage

## [0.9.19](https://github.com/vaultrice/sdk/compare/v0.9.18...v0.9.19) - 2025-08-28

- internally handle retrieable requests

## [0.9.18](https://github.com/vaultrice/sdk/compare/v0.9.17...v0.9.18) - 2025-08-27

- internally disconnect from WS if there are no more bound event handlers

## [0.9.17](https://github.com/vaultrice/sdk/compare/v0.9.16...v0.9.17) - 2025-08-25

- intruduce "Rate Limiting & Throttling"

## [0.9.16](https://github.com/vaultrice/sdk/compare/v0.9.15...v0.9.16) - 2025-08-21

- update dependencies

## [0.9.15](https://github.com/vaultrice/sdk/compare/v0.9.14...v0.9.15) - 2025-08-20

- export retrieveAccessToken directly

## [0.9.14](https://github.com/vaultrice/sdk/compare/v0.9.13...v0.9.14) - 2025-08-20

- improve NonLocalStorage.retrieveAccessToken()

## [0.9.13](https://github.com/vaultrice/sdk/compare/v0.9.12...v0.9.13) - 2025-08-20

- setItem(s) now returns also the value

## [0.9.12](https://github.com/vaultrice/sdk/compare/v0.9.11...v0.9.12) - 2025-08-19

- **OfflineNonLocalStorage**: New API for offline-first key-value storage with automatic sync when reconnected.
- **OfflineSyncObject**: New API for offline-first reactive object sync, supporting local changes and automatic server sync.
- **Custom Storage Adapter Support**: You can now inject your own storage backend (e.g. IndexedDB, SQLite) for offline mode via the `storage` option.
- **Authentication Improvements**: Credentials type and docs improved; backend token generation example clarified for secure access token workflows.

## [0.9.11](https://github.com/vaultrice/sdk/compare/v0.9.10...v0.9.11) - 2025-08-13

- return createdAt and updatedAt for items

## [0.9.10](https://github.com/vaultrice/sdk/compare/v0.9.9...v0.9.10) - 2025-08-12

- introduce autoReconnect

## [0.9.9](https://github.com/vaultrice/sdk/compare/v0.9.8...v0.9.9) - 2025-08-12

- dedicated connect() function

## [0.9.8](https://github.com/vaultrice/sdk/compare/v0.9.7...v0.9.8) - 2025-08-12

- improve parallel ws + request execution

## [0.9.7](https://github.com/vaultrice/sdk/compare/v0.9.6...v0.9.7) - 2025-08-11

- improve internal accessToken handling

## [0.9.6](https://github.com/vaultrice/sdk/compare/v0.9.5...v0.9.6) - 2025-08-11

- accessToken usage: onAccessTokenExpiring

## [0.9.5](https://github.com/vaultrice/sdk/compare/v0.9.4...v0.9.5) - 2025-08-11

- optional accessToken only usage

## [0.9.4](https://github.com/vaultrice/sdk/compare/v0.9.3...v0.9.4) - 2025-08-08

- setItem(s) optional `ifAbsent` option

## [0.9.3](https://github.com/vaultrice/sdk/compare/v0.9.2...v0.9.3) - 2025-08-07

- if not signature kv is passed, do not send it

## [0.9.2](https://github.com/vaultrice/sdk/compare/v0.9.1...v0.9.2) - 2025-08-06

- fixed some TypeScript docs

## [0.9.1](https://github.com/vaultrice/sdk/compare/v0.9.0...v0.9.1) - 2025-08-05

- fixed npm package exports for TypeScript

## [0.9.0] - 2025-08-05

### Added
- Initial public (pre-)release of Vaultrice JS/TS SDK
- `NonLocalStorage` class with localStorage-like API
- Real-time synchronization via WebSocket connections
- Optional end-to-end encryption (E2EE) with passphrase support
- TTL (Time To Live) support for automatic key expiration
- Event system for real-time updates (`setItem`, `removeItem`, `connect`, `disconnect`, `message`, `error`)
- Key-specific event filtering
- Presence API for tracking online users
- `SyncObject` API for reactive object synchronization
- Full TypeScript support with strong typing
- Cross-platform support (browsers, Node.js, React Native)
- Multiple build targets (ESM, CJS, UMD)
- Deno support

### Features
- **Storage Methods**: `setItem`, `getItem`, `setItems`, `getItems`, `getAllKeys`, `getAllItems`, `removeItem`, `removeItems`, `clear`
- **Real-time Communication**: WebSocket with HTTP fallback, message sending/receiving
- **Presence System**: `join`, `leave`, `getJoinedConnections` with real-time events
- **Encryption**: Automatic client-side encryption, key rotation, version management
- **SyncObject Features**:
  - Automatic property synchronization
  - Full event system integration
  - Built-in presence awareness
  - Real-time messaging
  - TypeScript interface support
  - Protected properties system

### Developer Experience
- Comprehensive documentation with real-world examples
- Collaborative text editor example
- Real-time gaming example
- ESLint configuration with neostandard
- Vitest for testing with integration test modes
- TypeDoc for API documentation
- Rollup for optimized builds
- Automated version management with git hooks

### Initial API Surface
```typescript
// NonLocalStorage
new NonLocalStorage(credentials, options?)
await nls.setItem(key, value)
await nls.getItem(key)
nls.on(event, handler)
nls.send(message)
await nls.join(data)

// SyncObject
const obj = await createSyncObject<T>(credentials, id)
obj.property = value // Auto-syncs
obj.on(event, handler)
await obj.join(data)
await obj.send(message)
```
