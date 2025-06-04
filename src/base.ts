import { getLocalId, setLocalId } from './local'
import { deriveSymmetricKey } from './encryption'
import uuidv4 from './uuidv4'
import { JSONObj, LogLevel } from './types'
import getLogger, { Logger } from './logger'

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
  protected logger: Logger

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
      idSignatureKeyVersion?: number,
      logLevel?: LogLevel
    } = { class: DEFAULT_DURABLE_CACHE_CLASS, logLevel: 'warn' }
  ) {
    this.logger = getLogger(options.logLevel)
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

  private async getSymKey (encryptionSettings: any) {
    return deriveSymmetricKey((this as any).passphrase, this.id, encryptionSettings.salt)
  }

  protected async getSymKeyForKeyVersion (keyVersion?: number) {
    if ((keyVersion as number) > -1) {
      if (keyVersion !== (this as any).encryptionSettings.keyVersion) {
        if (!(this as any).previousEncryptionSettings || (this as any).previousEncryptionSettings.length === 0) {
          await this.getEncryptionSettings()
        }
      }
      if (keyVersion !== (this as any).encryptionSettings.keyVersion) {
        if (!(this as any).previousEncryptionSettings || (this as any).previousEncryptionSettings.length === 0) {
          throw new Error(`Wrong keyVersion! Found ${keyVersion} but you're using ${(this as any).encryptionSettings.keyVersion}`)
        }
        let foundSettings = (this as any).previousEncryptionSettings.find((s: any) => s.keyVersion === keyVersion)
        if (!foundSettings) {
          await this.getEncryptionSettings()
        }
        foundSettings = ((this as any).previousEncryptionSettings || []).find((s: any) => s.keyVersion === keyVersion)
        if (!foundSettings) {
          throw new Error(`Wrong keyVersion! Found ${keyVersion} but you're using ${(this as any).encryptionSettings.keyVersion}`)
        }
        return this.getSymKey(foundSettings)
      }
    }
    return (this as any).symKey
  }

  private async handleEncryptionSettings (metadata: JSONObj) {
    (this as any).encryptionSettings = {
      salt: Uint8Array.from(atob((metadata?.encryptionSettings as any)?.salt as string), c => c.charCodeAt(0)),
      keyVersion: (metadata?.encryptionSettings as any)?.keyVersion as number
    }
    ;(this as any).previousEncryptionSettings = ((metadata?.previousEncryptionSettings as object[]) || []).map((s) => ({
      salt: Uint8Array.from(atob((s as any)?.salt as string), c => c.charCodeAt(0)),
      keyVersion: (s as any)?.keyVersion as number
    }))

    ;(this as any).symKey = await this.getSymKey((this as any).encryptionSettings)
  }

  /**
   * Only mandatory if using e2e encryption
   */
  async getEncryptionSettings (saltLength: number = 16) {
    if (!(this as any).passphrase) throw new Error('No passphrase passed! This function is only allowed with e2e encryption!')

    // fetch object metadata (if not existing on server side, generate salt + keyVersion)
    const response = await this.request('POST', `/cache-encryption/${this.class}/${this.id}`, { saltLength })
    const metadata = response as JSONObj
    // on server side check if the e2e feature is enabled/paid, if not, do not return metadata and throw an error here
    // throw new Error('E2E feature not available!')

    return this.handleEncryptionSettings(metadata)
  }

  /**
   * Only useful if using e2e encryption
   */
  async rotateEncryption (saltLength: number = 16) {
    if (!(this as any).passphrase) throw new Error('No passphrase passed! This function is only allowed with e2e encryption!')

    const response = await this.request('POST', `/cache-encryption-rotate/${this.class}/${this.id}`, { saltLength })
    const metadata = response as JSONObj

    return this.handleEncryptionSettings(metadata)
  }

  async request (method: string, path: string, body?: JSONObj | string | string[]): Promise<string | string[] | JSONObj | undefined> {
    const isStringBody = typeof body === 'string'
    const headers: {
      Authorization: string; [key: string]: string
    } = {
      Authorization: `Basic ${btoa(`${(this as any).credentials.apiKey}:${(this as any).credentials.apiSecret}`)}`
    }
    const keyVersion = (this as any)?.encryptionSettings?.keyVersion
    if (keyVersion !== undefined && keyVersion > -1) {
      headers['X-Enc-KV'] = keyVersion.toString()
    }
    if (this.signedId && this.idSignatureKeyVersion !== undefined) {
      headers['X-Id-Sig'] = this.signedId
      headers['X-Id-Sig-KV'] = this.idSignatureKeyVersion.toString()
    }
    if (body) headers['Content-Type'] = isStringBody ? 'text/plain' : 'application/json'
    const response = await fetch(
      `${Base.basePath}/project/${(this as any).credentials.projectId}${path}`, {
        method,
        headers,
        body: isStringBody ? body : JSON.stringify(body)
      }
    )
    const contentType = response.headers.get('content-type')
    let respBody
    if (contentType) {
      try {
        if (contentType.indexOf('text/plain') === 0) respBody = await response.text()
        else if (contentType.indexOf('application/json') === 0) respBody = await response.json()
      } catch (e) {
        respBody = `${response.status} - ${response.statusText}`
      }
    }
    if (!response.ok) {
      if (typeof respBody === 'string') throw new Error(respBody)
      if (respBody) throw new Error(respBody.message)
    }
    return respBody
  }
}
