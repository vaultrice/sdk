import { getLocalId, setLocalId } from './local.ts'
import { deriveSymmetricKey, encrypt, decrypt } from './encryption.ts'
import uuidv4 from './uuidv4.ts'
import { JSONObj, InstanceOptions, KeyDerivationOptions, EncryptionSettingsInfos, EncryptionSettings, EncryptionHandler } from './types.ts'
import getLogger, { Logger } from './logger.ts'
import decodeJwt from './decodeJwt.ts'
import { CREDENTIALS, ENCRYPTION_SETTINGS, PREVIOUS_ENCRYPTION_SETTINGS } from './symbols.ts'

function getId () {
  // if no id provided, try to check if there is one in the real local storage...
  const localId = getLocalId()
  if (localId) return localId
  // if not, generate a new id...
  return `${uuidv4()}-${uuidv4()}`
}

const DEFAULT_DURABLE_CACHE_CLASS = '_undefined_'

export default class Base {
  protected static basePath: string = 'https://api.vaultrice.app'
  protected getEncryptionHandler?: (encryptionSettings: EncryptionSettings) => Promise<EncryptionHandler>
  protected readonly autoUpdateOldEncryptedValues?: boolean
  protected readonly keyDerivationOptions?: KeyDerivationOptions
  protected readonly idSignature?: string
  protected readonly idSignatureKeyVersion?: number
  protected readonly class: string = DEFAULT_DURABLE_CACHE_CLASS
  protected readonly logger: Logger
  id: string
  protected accessToken?: string
  protected encryptionHandler?: EncryptionHandler
  private isGettingAccessToken?: Promise<void>
  private [CREDENTIALS]: { apiKey: string, apiSecret: string, projectId: string }
  private [ENCRYPTION_SETTINGS]?: EncryptionSettings
  private [PREVIOUS_ENCRYPTION_SETTINGS]?: EncryptionSettings[]

  constructor (
    credentials: {
      apiKey: string,
      apiSecret: string,
      projectId: string
    },
    id?: string
  )
  constructor (
    credentials: {
      apiKey: string,
      apiSecret: string,
      projectId: string
    },
    options?: InstanceOptions
  )
  constructor (
    credentials: {
      apiKey: string,
      apiSecret: string,
      projectId: string
    },
    idOrOptions: string | InstanceOptions | undefined = { id: getId(), class: DEFAULT_DURABLE_CACHE_CLASS, autoUpdateOldEncryptedValues: true, logLevel: 'warn' }
  ) {
    let options: InstanceOptions = { class: DEFAULT_DURABLE_CACHE_CLASS, logLevel: 'warn' }
    if (typeof idOrOptions === 'string') {
      this.id = idOrOptions
      options = { class: DEFAULT_DURABLE_CACHE_CLASS, logLevel: 'warn' }
    } else {
      this.id = idOrOptions.id || getId()
      options = idOrOptions
    }

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

    this[CREDENTIALS] = credentials

    this.class = options.class || DEFAULT_DURABLE_CACHE_CLASS

    if (options.passphrase && options.getEncryptionHandler) {
      throw new Error('Either define a passphrase or a getEncryptionHandler, but not both!')
    }
    if (options.getEncryptionHandler) this.getEncryptionHandler = options.getEncryptionHandler

    if (options.passphrase) {
      this.getEncryptionHandler = async (encSettings: EncryptionSettings) => {
        const symKey = await deriveSymmetricKey(
          options.passphrase as string,
          this.id,
          encSettings.salt,
          options.keyDerivationOptions
        )
        const optForEnc = options.keyDerivationOptions?.derivedKeyType?.name ? { algorithm: options.keyDerivationOptions?.derivedKeyType?.name } : undefined
        return {
          encrypt: (value) => encrypt(symKey, value, optForEnc),
          decrypt: (value) => decrypt(symKey, value, optForEnc)
        }
      }
    }

    if (options.autoUpdateOldEncryptedValues === undefined) options.autoUpdateOldEncryptedValues = true
    this.autoUpdateOldEncryptedValues = options.autoUpdateOldEncryptedValues
    if (options.idSignature) this.idSignature = options.idSignature
    if (this.idSignature) this.idSignatureKeyVersion = options.idSignatureKeyVersion || 0

    this.isGettingAccessToken = this.getAccessToken()
    this.isGettingAccessToken.then(() => { this.isGettingAccessToken = undefined }, () => { this.isGettingAccessToken = undefined })
  }

  private async getAccessToken () {
    const response = await this.request('GET', '/auth/token')
    const accessToken = response as string
    const decodedToken = decodeJwt(accessToken)
    this.accessToken = accessToken
    const expiresIn = (decodedToken.payload.exp as number) - Date.now()
    setTimeout(() => this.getAccessToken(), (expiresIn - (2 * 60 * 1000)))
  }

  protected async getEncryptionHandlerForKeyVersion (keyVersion?: number): Promise<EncryptionHandler | undefined> {
    if ((keyVersion as number) > -1) {
      if (keyVersion !== this[ENCRYPTION_SETTINGS]?.keyVersion) {
        if (!this[PREVIOUS_ENCRYPTION_SETTINGS] || this[PREVIOUS_ENCRYPTION_SETTINGS].length === 0) {
          await this.getEncryptionSettings()
        }
      }
      if (keyVersion !== this[ENCRYPTION_SETTINGS]?.keyVersion) {
        if (!this[PREVIOUS_ENCRYPTION_SETTINGS] || this[PREVIOUS_ENCRYPTION_SETTINGS].length === 0) {
          throw new Error(`Wrong keyVersion! Found ${keyVersion} but you're using ${this[ENCRYPTION_SETTINGS]?.keyVersion}`)
        }
        let foundSettings = this[PREVIOUS_ENCRYPTION_SETTINGS].find((s: any) => s.keyVersion === keyVersion)
        if (!foundSettings) {
          await this.getEncryptionSettings()
        }
        foundSettings = (this[PREVIOUS_ENCRYPTION_SETTINGS] || []).find((s: any) => s.keyVersion === keyVersion)
        if (!foundSettings) {
          throw new Error(`Wrong keyVersion! Found ${keyVersion} but you're using ${this[ENCRYPTION_SETTINGS]?.keyVersion}`)
        }
        if (!this.getEncryptionHandler) return
        return this.getEncryptionHandler(foundSettings)
      }
    }
    return this.encryptionHandler
  }

  private async handleEncryptionSettings (metadata: EncryptionSettingsInfos) {
    if (!this.getEncryptionHandler) throw new Error('No getEncryptionHandler defined!')
    this[ENCRYPTION_SETTINGS] = metadata.encryptionSettings
    this[PREVIOUS_ENCRYPTION_SETTINGS] = metadata.previousEncryptionSettings
    this.encryptionHandler = await this.getEncryptionHandler(metadata.encryptionSettings)
  }

  private prepareEncryptionSettings (metadata: JSONObj): EncryptionSettingsInfos {
    return {
      encryptionSettings: {
        salt: Uint8Array.from(atob((metadata?.encryptionSettings as any)?.salt as string), c => c.charCodeAt(0)),
        keyVersion: (metadata?.encryptionSettings as any)?.keyVersion as number,
        createdAt: (metadata?.encryptionSettings as any)?.createdAt as number
      },
      previousEncryptionSettings: ((metadata?.previousEncryptionSettings as object[]) || []).map((s) => ({
        salt: Uint8Array.from(atob((s as any)?.salt as string), c => c.charCodeAt(0)),
        keyVersion: (s as any)?.keyVersion as number,
        createdAt: (s as any)?.createdAt as number
      }))
    }
  }

  /**
   * Only mandatory if using e2e encryption
   * @param [saltLength=16]
   */
  async getEncryptionSettings (saltLength?: number): Promise<EncryptionSettingsInfos> {
    if (!this.getEncryptionHandler) throw new Error('No passphrase and no getEncryptionHandler passed! This function is only allowed with e2e encryption!')

    const response = await this.request('POST', `/cache-encryption/${this.class}/${this.id}`, (saltLength && saltLength > 0) ? { saltLength } : {})
    const metadata = response as JSONObj

    const encryptionSettingsInfos = this.prepareEncryptionSettings(metadata)
    await this.handleEncryptionSettings(encryptionSettingsInfos)
    return encryptionSettingsInfos
  }

  /**
   * Only useful if using e2e encryption
   * @param [saltLength=16]
   */
  async rotateEncryption (saltLength?: number): Promise<EncryptionSettingsInfos> {
    if (!this.getEncryptionHandler) throw new Error('No passphrase and no getEncryptionHandler passed! This function is only allowed with e2e encryption!')

    const response = await this.request('POST', `/cache-encryption-rotate/${this.class}/${this.id}`, (saltLength && saltLength > 0) ? { saltLength } : {})
    const metadata = response as JSONObj

    const encryptionSettingsInfos = this.prepareEncryptionSettings(metadata)
    await this.handleEncryptionSettings(encryptionSettingsInfos)
    return encryptionSettingsInfos
  }

  async request (method: string, path: string, body?: JSONObj | string | string[]): Promise<string | string[] | JSONObj | undefined> {
    if (!this.accessToken && this.isGettingAccessToken) await this.isGettingAccessToken
    const headers: {
      Authorization: string; [key: string]: string
    } = {
      Authorization: this.accessToken
        ? `Bearer ${this.accessToken}`
        : `Basic ${btoa(`${this[CREDENTIALS].apiKey}:${this[CREDENTIALS].apiSecret}`)}`
    }
    const isStringBody = typeof body === 'string'
    const keyVersion = this[ENCRYPTION_SETTINGS]?.keyVersion
    if (keyVersion !== undefined && keyVersion > -1) {
      headers['X-Enc-KV'] = keyVersion.toString()
    }
    if (this.idSignature && this.idSignatureKeyVersion !== undefined) {
      headers['X-Id-Sig'] = this.idSignature
      headers['X-Id-Sig-KV'] = this.idSignatureKeyVersion.toString()
    }
    if (body) headers['Content-Type'] = isStringBody ? 'text/plain' : 'application/json'
    const response = await fetch(
      `${Base.basePath}/project/${this[CREDENTIALS].projectId}${path}`, {
        method,
        headers,
        body: !body ? undefined : isStringBody ? body : JSON.stringify(body)
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
      if (respBody) throw respBody
      if (response.status !== 404) throw new Error(`${response.status} - ${response.statusText}`)
    }
    return respBody
  }
}
