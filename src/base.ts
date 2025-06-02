import { getLocalId, setLocalId } from './local'
import { deriveSymmetricKey } from './encryption'
import uuidv4 from './uuidv4'
import { JSONObj } from './types'

function getId () {
  // if no id provided, try to check if there is one in the real local storage...
  const localId = getLocalId()
  if (localId) return localId
  // if not, generate a new id...
  return `${uuidv4()}-${uuidv4()}`
}

const DEFAULT_DURABLE_CACHE_CLASS = '_undefined_'

export default class Base {
  protected static basePath: string = 'http://localhost:5173'
  protected readonly signedId?: string
  protected readonly idSignatureKeyVersion?: number
  protected readonly class: string = DEFAULT_DURABLE_CACHE_CLASS

  constructor (
    credentials: {
      apiKey: string,
      apiSecret: string,
      projectId: string
    },
    readonly id: string = getId(),
    options: {
      class?: string,
      passphrase?: string,
      signedId?: string,
      idSignatureKeyVersion?: number
    } = { class: DEFAULT_DURABLE_CACHE_CLASS }
  ) {
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

    ;(this as any).credentials = credentials

    this.class = options.class || DEFAULT_DURABLE_CACHE_CLASS

    if (options.passphrase) (this as any).passphrase = options.passphrase
    if (options.signedId) this.signedId = options.signedId
    if (this.signedId) this.idSignatureKeyVersion = options.idSignatureKeyVersion || 0
  }

  /**
   * Only mandatory if using e2e encryption
   */
  async init () {
    if (!(this as any).passphrase) throw new Error('No passphrase passed! This function is only allowed with e2e encryption!')

    // fetch object metadata (if not existing on server side, generate salt + keyVersion)
    const response = await this.request('GET', `/cache-meta/${this.id}`)
    const metadata = response as JSONObj
    // on server side check if the e2e feature is enabled/paid, if not, do not return metadata and throw an error here
    // throw new Error('E2E feature not available!')

    (this as any).metadata = {
      salt: Uint8Array.from(atob(metadata?.salt as string), c => c.charCodeAt(0)),
      keyVersion: metadata?.keyVersion as number
    }

    ;(this as any).symKey = await deriveSymmetricKey((this as any).passphrase, this.id, (this as any).metadata.salt)
  }

  async request (method: string, path: string, body?: JSONObj | string | string[]): Promise<string | string[] | JSONObj | undefined> {
    const isStringBody = typeof body === 'string'
    const headers: {
      Authorization: string; [key: string]: string
    } = {
      Authorization: `Basic ${btoa(`${(this as any).credentials.apiKey}:${(this as any).credentials.apiSecret}`)}`
    }
    const keyVersion = (this as any)?.metadata?.keyVersion
    if (keyVersion !== undefined && keyVersion > -1) {
      headers['X-Enc-KV'] = keyVersion.toString()
    }
    if (this.signedId && this.idSignatureKeyVersion !== undefined) {
      headers['X-Id-Sig'] = this.signedId
      headers['X-Id-Sig-KV'] = this.idSignatureKeyVersion.toString()
    }
    if (body) headers['Content-Type'] = isStringBody ? 'text/plain' : 'application/json'
    const response = await fetch(
      `${Base.basePath}/project/${(this as any).credentials.projectId}/${this.class}${path}`, {
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
