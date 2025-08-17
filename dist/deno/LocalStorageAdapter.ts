import { StorageAdapter } from './types.ts'

const LOCAL_ID_NAME = 'NON_LOCAL_STORAGE_STORAGE_ADAPTER'

export class LocalStorageAdapter implements StorageAdapter {
  private prefix: string
  private ttl?: number
  private memoryStore: Record<string, any>
  private hasLocalStorage: boolean

  constructor (options: { projectId: string, class?: string, id?: string, ttl?: number }) {
    const classPart = options.class ?? '_'
    const idPart = options.id ?? '_'
    this.prefix = `${LOCAL_ID_NAME}:${options.projectId}:${classPart}:${idPart}:`
    this.ttl = options.ttl
    this.hasLocalStorage = typeof window !== 'undefined' && !!window.localStorage
    this.memoryStore = {}
  }

  async get (key: string): Promise<any | null> {
    if (!this.hasLocalStorage) return this.memoryStore[this.prefix + key] ?? null
    const raw = window.localStorage.getItem(this.prefix + key)
    return raw ? JSON.parse(raw) : null
  }

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

  async remove (key: string): Promise<void> {
    if (!this.hasLocalStorage) {
      delete this.memoryStore[this.prefix + key]
      return
    }
    window.localStorage.removeItem(this.prefix + key)
  }

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
