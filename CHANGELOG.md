# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0](https://github.com/vaultrice/sdk/compare/v0.9.0...v1.0.0) - YYYY-MM-DD

- not released yet

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

[0.9.0]: https://github.com/vaultrice/sdk/releases/tag/v0.9.0