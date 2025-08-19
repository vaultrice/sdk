import { StorageAdapter } from './types'

const LOCAL_ID_NAME = 'NON_LOCAL_STORAGE_STORAGE_ADAPTER'

/**
 * Storage adapter using browser localStorage (with in-memory fallback).
 *
 * @remarks
 * Implements the {@link StorageAdapter} interface for offline sync.
 * Persists key-value pairs in browser localStorage, or in memory if unavailable (e.g. Node.js).
 *
 * The constructor signature must match:
 * ```typescript
 * constructor(options: { projectId: string; class: string; id: string; ttl: number })
 * ```
 *
 * @example
 * ```typescript
 * import { StorageAdapter } from '@vaultrice/sdk'
 * class MyAdapter implements StorageAdapter {
 *   constructor(options: { projectId: string; class: string; id: string; ttl: number }) { ... }
 *   async get(key: string): Promise<any | null> { ... }
 *   async set(key: string, value: any): Promise<void> { ... }
 *   async remove(key: string): Promise<void> { ... }
 *   async getAll(): Promise<Record<string, any>> { ... }
 * }
 * ```
 */
export default class LocalStorageAdapter implements StorageAdapter {
  private prefix: string
  private ttl?: number
  private memoryStore: Record<string, any>
  private hasLocalStorage: boolean

  /**
   * Create a LocalStorageAdapter instance.
   * @param options - Adapter options: projectId, class, id, ttl.
   */
  constructor (options: { projectId: string, class: string, id: string, ttl: number }) {
    const classPart = options.class
    const idPart = options.id
    this.prefix = `${LOCAL_ID_NAME}:${options.projectId}:${classPart}:${idPart}:`
    this.ttl = options.ttl
    this.hasLocalStorage = typeof window !== 'undefined' && !!window.localStorage
    this.memoryStore = {}
  }

  /**
   * Get a value by key.
   * @param key - The key to retrieve.
   * @returns The value or null if not found.
   */
  async get (key: string): Promise<any | null> {
    if (!this.hasLocalStorage) return this.memoryStore[this.prefix + key] ?? null
    const raw = window.localStorage.getItem(this.prefix + key)
    return raw ? JSON.parse(raw) : null
  }

  /**
   * Set a value by key.
   * The value passed to `set(key, value)` is an object matching the ItemType shape:
   * { value, expiresAt, createdAt, updatedAt, keyVersion? }
   * @param key - The key to set.
   * @param value - The value to store.
   */
  async set (key: string, value: any): Promise<void> {
    if (this.ttl && !value.expiresAt) {
      value.expiresAt = Date.now() + this.ttl
    }
    if (!this.hasLocalStorage) {
      this.memoryStore[this.prefix + key] = value
      return
    }
    window.localStorage.setItem(this.prefix + key, JSON.stringify(value))
  }

  /**
   * Remove a value by key.
   * @param key - The key to remove.
   */
  async remove (key: string): Promise<void> {
    if (!this.hasLocalStorage) {
      delete this.memoryStore[this.prefix + key]
      return
    }
    window.localStorage.removeItem(this.prefix + key)
  }

  /**
   * Get all stored key-value pairs for this adapter instance.
   * @returns An object mapping keys to values.
   */
  async getAll (): Promise<Record<string, any>> {
    const result: Record<string, any> = {}
    if (!this.hasLocalStorage) {
      for (const k in this.memoryStore) {
        if (k.startsWith(this.prefix)) {
          const prop = k.slice(this.prefix.length)
          result[prop] = this.memoryStore[k]
        }
      }
      return result
    }
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (k && k.startsWith(this.prefix)) {
        const prop = k.slice(this.prefix.length)
        result[prop] = JSON.parse(window.localStorage.getItem(k)!)
      }
    }
    return result
  }

  // async clear (): Promise<void> {
  //   if (!this.hasLocalStorage) {
  //     for (const k in this.memoryStore) {
  //       if (k.startsWith(this.prefix)) delete this.memoryStore[k]
  //     }
  //     return
  //   }
  //   const keys: string[] = []
  //   for (let i = 0; i < window.localStorage.length; i++) {
  //     const k = window.localStorage.key(i)
  //     if (k && k.startsWith(this.prefix)) keys.push(k)
  //   }
  //   keys.forEach(k => window.localStorage.removeItem(k))
  // }
}
