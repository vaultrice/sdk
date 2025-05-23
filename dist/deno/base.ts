import { getLocalId, setLocalId } from './local.ts'
import { deriveSymmetricKey } from './encryption.ts'
import uuidv4 from './uuidv4.ts'
import { JSONObj } from './types.ts'

function getId () {
  // if no id provided, try to check if there is one in the real local storage...
  const localId = getLocalId()
  if (localId) {
    return localId
  }
  // if not, generate a new id...
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${crypto.randomUUID()}-${crypto.randomUUID()}`
  } else {
    return `${uuidv4()}-${uuidv4()}`
  }
}

export default class Base {
  protected static basePath: string = 'http://localhost:5173'

  constructor (credentials: { apiKey: string, apiSecret: string, projectId: string }, readonly id: string = getId(), options?: { passphrase?: string }) {
    if (!credentials ||
      typeof credentials !== 'object' ||
      typeof credentials.apiKey !== 'string' ||
      typeof credentials.apiSecret !== 'string' ||
      typeof credentials.projectId !== 'string'
    ) {
      throw new Error('Invalid credentials!')
    }

    // try to save that id locally
    setLocalId(this.id as string)

    // @ts-ignore
    this.credentials = credentials

    // @ts-ignore
    if (options?.passphrase) this.passphrase = options?.passphrase
  }

  /**
   * Only mandatory if using e2e encryption
   */
  async init () {
    // @ts-ignore
    if (!this.passphrase) throw new Error('No passphrase passed! This function is only allowed with e2e encryption!')

    // fetch object metadata (if not existing on server side, generate salt + keyVersion)
    const response = await this.request('GET', `/cache-meta/${this.id}`)
    const metadata = response as JSONObj
    // on server side check if the e2e feature is enabled/paid, if not, do not return metadata and throw an error here
    // throw new Error('E2E feature not available!')

    // @ts-ignore
    this.metadata = {
      salt: Uint8Array.from(atob(metadata?.salt as string), c => c.charCodeAt(0)),
      keyVersion: metadata?.keyVersion as number
    }

    // @ts-ignore
    this.symKey = await deriveSymmetricKey(this.passphrase, this.id, this.metadata.salt)
  }

  async request (method: string, path: string, body?: JSONObj | string | string[], keyVersion?: number | undefined): Promise<string | string[] | JSONObj | undefined> {
    const isStringBody = typeof body === 'string'
    const headers: {
      Authorization: string; [key: string]: string
    } = { // @ts-ignore
      Authorization: `Basic ${btoa(`${this.credentials.apiKey}:${this.credentials.apiSecret}`)}`
    }
    if (keyVersion !== undefined && keyVersion > -1) {
      headers['X-Enc-KV'] = keyVersion.toString()
    }
    if (body) headers['Content-Type'] = isStringBody ? 'text/plain' : 'application/json'
    const response = await fetch( // @ts-ignore
      `${Base.basePath}/project/${this.credentials.projectId}${path}`, {
        method,
        headers,
        body: isStringBody ? body : JSON.stringify(body)
      }
    )
    const contentType = response.headers.get('content-type')
    let respBody
    if (contentType) {
      if (contentType.indexOf('text/plain') === 0) respBody = await response.text()
      else if (contentType.indexOf('application/json') === 0) respBody = await response.json()
    }
    if (!response.ok) {
      if (typeof respBody === 'string') throw new Error(respBody)
      if (respBody) throw new Error(respBody.message)
    }
    return respBody
  }
}
