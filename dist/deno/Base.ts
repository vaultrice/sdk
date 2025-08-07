import { getLocalId, setLocalId } from './local.ts'
import { deriveSymmetricKey, encrypt, decrypt } from './encryption.ts'
import uuidv4 from './uuidv4.ts'
import { JSONObj, InstanceOptions, KeyDerivationOptions, EncryptionSettingsInfos, EncryptionSettings, EncryptionHandler } from './types.ts'
import getLogger, { Logger } from './logger.ts'
import decodeJwt from './decodeJwt.ts'
import { CREDENTIALS, ENCRYPTION_SETTINGS, PREVIOUS_ENCRYPTION_SETTINGS } from './symbols.ts'

/**
 * Generate a unique ID for an instance.
 * @param projectId
 * @param className
 * @internal
 * @returns A UUID-based string ID.
 */
function getId (projectId: string, className: string) {
  // if no id provided, try to check if there is one in the real local storage...
  const localId = getLocalId(projectId, className)
  if (localId) return localId
  // if not, generate a new id...
  return `${uuidv4()}-${uuidv4()}`
}

/** @internal */
const DEFAULT_DURABLE_CACHE_CLASS = '_undefined_'

/**
 * Base class providing core API functionality including authentication,
 * encryption settings, and HTTP request handling.
 *
 * @remarks
 * This class handles the low-level communication with the Vaultrice API,
 * including access token management, encryption setup, and request/response processing.
 */
export default class Base {
  /**
   * @internal API base URL
   * @private
   */
  protected static basePath: string = 'https://api.vaultrice.app'

  /**
   * Optional encryption handler factory function
   * @private
   */
  protected getEncryptionHandler?: (encryptionSettings: EncryptionSettings) => Promise<EncryptionHandler>

  /**
   * Whether to automatically update items with old encryption
   * @private
   */
  protected readonly autoUpdateOldEncryptedValues?: boolean

  /**
   * Key derivation options for encryption
   * @private
   */
  protected readonly keyDerivationOptions?: KeyDerivationOptions

  /**
   * ID signature for authentication
   * @private
   */
  protected readonly idSignature?: string

  /**
   * Key version for ID signature
   * @private
   */
  protected readonly idSignatureKeyVersion?: number

  /**
   * Storage class name
   * @private
   */
  protected readonly class: string = DEFAULT_DURABLE_CACHE_CLASS

  /**
   * Logger instance
   * @private
   */
  protected readonly logger: Logger

  /** Unique instance identifier */
  id: string

  /** @internal Current access token */
  protected accessToken?: string

  /** @internal Current encryption handler */
  protected encryptionHandler?: EncryptionHandler

  /** @internal Promise for token acquisition */
  private isGettingAccessToken?: Promise<void>

  /** @internal API credentials */
  private [CREDENTIALS]: { apiKey: string, apiSecret: string, projectId: string }

  /** @internal Current encryption settings */
  private [ENCRYPTION_SETTINGS]?: EncryptionSettings

  /** @internal Previous encryption settings for backwards compatibility */
  private [PREVIOUS_ENCRYPTION_SETTINGS]?: EncryptionSettings[]

  /**
   * Create a Base instance with string ID.
   * @param credentials - API credentials containing apiKey, apiSecret, and projectId.
   * @param id - Optional unique identifier for this instance.
   */
  constructor (
    credentials: {
      apiKey: string,
      apiSecret: string,
      projectId: string
    },
    id?: string
  )
  /**
   * Create a Base instance with options.
   * @param credentials - API credentials containing apiKey, apiSecret, and projectId.
   * @param options - Instance configuration options.
   */
  constructor (
    credentials: {
      apiKey: string,
      apiSecret: string,
      projectId: string
    },
    options?: InstanceOptions
  )
  /**
   * Create a Base instance.
   * @param credentials - API credentials containing apiKey, apiSecret, and projectId.
   * @param idOrOptions - Either a string ID or instance options object.
   */
  constructor (
    credentials: {
      apiKey: string,
      apiSecret: string,
      projectId: string
    },
    idOrOptions: string | InstanceOptions | undefined = { class: DEFAULT_DURABLE_CACHE_CLASS, autoUpdateOldEncryptedValues: true, logLevel: 'warn' }
  ) {
    let options: InstanceOptions = { class: DEFAULT_DURABLE_CACHE_CLASS, logLevel: 'warn' }
    if (typeof idOrOptions === 'string') {
      this.id = idOrOptions
      options = { class: DEFAULT_DURABLE_CACHE_CLASS, logLevel: 'warn' }
    } else {
      this.id = idOrOptions.id || getId(credentials.projectId, idOrOptions.class || DEFAULT_DURABLE_CACHE_CLASS)
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

    if (typeof idOrOptions !== 'string' && !idOrOptions?.id) {
      // try to save that id locally
      setLocalId(credentials.projectId, idOrOptions.class || DEFAULT_DURABLE_CACHE_CLASS, this.id as string)
    }

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
    if (this.idSignature) this.idSignatureKeyVersion = options.idSignatureKeyVersion

    this.isGettingAccessToken = this.getAccessToken()
    this.isGettingAccessToken.then(() => { this.isGettingAccessToken = undefined }, () => { this.isGettingAccessToken = undefined })
  }

  /**
   * Acquire and manage access tokens for API authentication.
   * @internal
   * @remarks
   * Automatically refreshes tokens before expiry and handles JWT decoding.
   */
  private async getAccessToken () {
    const response = await this.request('GET', '/auth/token')
    const accessToken = response as string
    const decodedToken = decodeJwt(accessToken)
    this.accessToken = accessToken
    const expiresIn = (decodedToken.payload.exp as number) - Date.now()
    setTimeout(() => this.getAccessToken(), (expiresIn - (2 * 60 * 1000)))
  }

  /**
   * Get encryption handler for a specific key version.
   * @internal
   * @param keyVersion - The encryption key version.
   * @returns The appropriate encryption handler or undefined.
   * @throws Error if key version mismatch cannot be resolved.
   */
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

  /**
   * Process and store encryption settings.
   * @internal
   * @param metadata - Encryption settings information.
   * @throws Error if no encryption handler is defined.
   */
  private async handleEncryptionSettings (metadata: EncryptionSettingsInfos) {
    if (!this.getEncryptionHandler) throw new Error('No getEncryptionHandler defined!')
    this[ENCRYPTION_SETTINGS] = metadata.encryptionSettings
    this[PREVIOUS_ENCRYPTION_SETTINGS] = metadata.previousEncryptionSettings
    this.encryptionHandler = await this.getEncryptionHandler(metadata.encryptionSettings)
  }

  /**
   * Convert raw encryption metadata to typed settings.
   * @internal
   * @param metadata - Raw encryption metadata from API.
   * @returns Typed encryption settings information.
   */
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
   * Retrieve or initialize encryption settings for end-to-end encryption.
   * @param saltLength - Optional salt length in bytes (default: 16).
   * @returns Promise resolving to encryption settings information.
   * @throws Error if called without encryption configuration.
   * @remarks
   * This method is mandatory when using end-to-end encryption. It fetches
   * the encryption salt and key version from the server, then initializes
   * the encryption handler.
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
   * Rotate encryption keys to enhance security.
   * @param saltLength - Optional salt length in bytes (default: 16).
   * @returns Promise resolving to new encryption settings information.
   * @throws Error if called without encryption configuration.
   * @remarks
   * This generates new encryption settings while preserving access to data
   * encrypted with previous keys. Useful for periodic security rotation.
   */
  async rotateEncryption (saltLength?: number): Promise<EncryptionSettingsInfos> {
    if (!this.getEncryptionHandler) throw new Error('No passphrase and no getEncryptionHandler passed! This function is only allowed with e2e encryption!')

    const response = await this.request('POST', `/cache-encryption-rotate/${this.class}/${this.id}`, (saltLength && saltLength > 0) ? { saltLength } : {})
    const metadata = response as JSONObj

    const encryptionSettingsInfos = this.prepareEncryptionSettings(metadata)
    await this.handleEncryptionSettings(encryptionSettingsInfos)
    return encryptionSettingsInfos
  }

  /**
   * Make authenticated HTTP requests to the Vaultrice API.
   * @param method - HTTP method (GET, POST, DELETE, etc.).
   * @param path - API endpoint path.
   * @param body - Optional request body (JSON object, string, or string array).
   * @returns Promise resolving to the response data.
   * @throws Error if the request fails or returns an error status.
   * @remarks
   * Handles authentication, content-type headers, encryption key versions,
   * and response parsing automatically.
   * @private
   */
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
    if (this.idSignature) {
      headers['X-Id-Sig'] = this.idSignature
      if (this.idSignatureKeyVersion !== undefined) {
        headers['X-Id-Sig-KV'] = this.idSignatureKeyVersion.toString()
      }
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
