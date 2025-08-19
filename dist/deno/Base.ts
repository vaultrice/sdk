import { getLocalId, setLocalId } from './local.ts'
import { deriveSymmetricKey, encrypt, decrypt } from './encryption.ts'
import uuidv4 from './uuidv4.ts'
import { JSONObj, InstanceOptions, KeyDerivationOptions, EncryptionSettingsInfos, EncryptionSettings, EncryptionHandler } from './types.ts'
import getLogger, { Logger } from './logger.ts'
import decodeJwt from './decodeJwt.ts'
import { CREDENTIALS, ENCRYPTION_SETTINGS, PREVIOUS_ENCRYPTION_SETTINGS, ACCESS_TOKEN_EXPIRING_HANDLERS } from './symbols.ts'

/**
 * Generate a unique ID for an instance.
 * @param projectId
 * @param className
 * @internal
 * @returns A UUID-based string ID.
 */
export function getId (projectId: string, className: string) {
  // if no id provided, try to check if there is one in the real local storage...
  const localId = getLocalId(projectId, className)
  if (localId) return localId
  // if not, generate a new id...
  return `${uuidv4()}-${uuidv4()}`
}

/** @internal */
export const DEFAULT_DURABLE_CACHE_CLASS = '_undefined_'

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
  protected isGettingAccessToken?: Promise<void>

  /** @internal API credentials */
  private [CREDENTIALS]: { projectId: string, apiKey?: string, apiSecret?: string, accessToken?: string }

  /** @internal Current encryption settings */
  private [ENCRYPTION_SETTINGS]?: EncryptionSettings

  /** @internal Previous encryption settings for backwards compatibility */
  private [PREVIOUS_ENCRYPTION_SETTINGS]?: EncryptionSettings[]

  /** @internal Handlers for access token expiring event */
  private [ACCESS_TOKEN_EXPIRING_HANDLERS]: Array<() => void> = []

  /**
   * Create a Base instance with string ID.
   * @param credentials - API credentials containing apiKey, apiSecret, and projectId.
   * @param id - Optional unique identifier for this instance.
   */
  constructor (
    credentials: {
      apiKey?: string,
      apiSecret?: string,
      accessToken?: string,
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
      apiKey?: string,
      apiSecret?: string,
      accessToken?: string,
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
      apiKey?: string,
      apiSecret?: string,
      accessToken?: string,
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
      typeof credentials.projectId !== 'string'
    ) {
      throw new Error('Invalid credentials!')
    }

    if (
      typeof credentials.apiKey !== 'string' &&
      typeof credentials.apiSecret !== 'string' &&
      typeof credentials.accessToken !== 'string'
    ) {
      throw new Error('Invalid credentials! (apiKey + apiSecret or accessToken)')
    }

    if (
      (typeof credentials.apiKey === 'string' &&
      typeof credentials.apiSecret !== 'string') ||
      (typeof credentials.apiKey !== 'string' &&
      typeof credentials.apiSecret === 'string')
    ) {
      throw new Error('Invalid credentials! (apiKey and apiSecret necessary)')
    }

    if (typeof idOrOptions !== 'string' && !idOrOptions?.id) {
      // try to save that id locally
      setLocalId(credentials.projectId, idOrOptions.class || DEFAULT_DURABLE_CACHE_CLASS, this.id as string)
    }

    this[CREDENTIALS] = { ...credentials }

    if (
      typeof this[CREDENTIALS].apiKey !== 'string' &&
      typeof this[CREDENTIALS].apiSecret !== 'string' &&
      typeof this[CREDENTIALS].accessToken === 'string'
    ) {
      delete this[CREDENTIALS].apiKey
      delete this[CREDENTIALS].apiSecret
    }

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

    if (!this[CREDENTIALS].accessToken) {
      this.isGettingAccessToken = this.getAccessToken()
      this.isGettingAccessToken.then(() => { this.isGettingAccessToken = undefined }).catch(() => { this.isGettingAccessToken = undefined })
    }
  }

  /**
   * Retrieves an access token for a given project using API credentials.
   *
   * @param projectId - The unique identifier of the project.
   * @param apiKey - The API key associated with the project.
   * @param apiSecret - The API secret associated with the project.
   * @returns {Promise<string>} A promise that resolves to the access token as a string.
   *
   * @example
   * ```javascript
   * const token = await NonLocalStorage.retrieveAccessToken('projectId', 'apiKey', 'apiSecret');
   * ```
   */
  public static async retrieveAccessToken (projectId: string, apiKey: string, apiSecret: string): Promise<string> {
    if (typeof projectId !== 'string' || !projectId) throw new Error('projectId not valid!')
    if (typeof apiKey !== 'string' || !apiKey) throw new Error('apiKey not valid!')
    if (typeof apiSecret !== 'string' || !apiSecret) throw new Error('apiSecret not valid!')

    const basicAuthHeader = `Basic ${btoa(`${apiKey}:${apiSecret}`)}`

    const response = await fetch(
      `${Base.basePath}/project/${projectId}/auth/token`, {
        method: 'GET',
        headers: {
          Authorization: basicAuthHeader
        }
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
    const accessToken = respBody as string
    return accessToken
  }

  /**
   * Acquire and manage access tokens for API authentication.
   * @internal
   * @remarks
   * Automatically refreshes tokens before expiry and handles JWT decoding.
   */
  private async getAccessToken () {
    try {
      const response = await Base.retrieveAccessToken(this[CREDENTIALS].projectId, this[CREDENTIALS].apiKey as string, this[CREDENTIALS].apiSecret as string)
      const expiresIn = this.useAccessToken(response)
      setTimeout(() => this.getAccessToken(), (expiresIn - (2 * 60 * 1000)))
    } catch (e: any) {
      this.logger.log('error', `Retrieving access token failed: ${e?.message || e?.name || e?.type || e}`)
      throw e
    }
  }

  /**
   * Sets the access token to be used for authentication.
   *
   * @param accessToken - The access token string to set.
   * @returns {number} token expiration in milliseconds from now
   */
  public useAccessToken (accessToken: string): number {
    if (typeof accessToken !== 'string' || !accessToken) throw new Error('accessToken not valid!')
    const decodedToken = decodeJwt(accessToken)
    this[CREDENTIALS].accessToken = accessToken
    const expiresIn = (decodedToken.payload.exp as number) - Date.now()
    setTimeout(() => {
      this[ACCESS_TOKEN_EXPIRING_HANDLERS].forEach((h: () => void) => h())
    }, (expiresIn - (2 * 60 * 1000)))
    return expiresIn
  }

  /**
   * Registers a handler function to be called when the access token is about to expire.
   *
   * @param handler - A callback function that will be invoked before the access token expires.
   */
  public onAccessTokenExpiring (handler: (() => void)) {
    this[ACCESS_TOKEN_EXPIRING_HANDLERS].push(handler)
  }

  /**
   * Removes a previously registered handler for the access token expiring event.
   *
   * @param handler - The callback function to remove from the access token expiring handlers list.
   */
  public offAccessTokenExpiring (handler: (() => void)) {
    const idx = this[ACCESS_TOKEN_EXPIRING_HANDLERS].indexOf(handler)
    if (idx !== -1) {
      this[ACCESS_TOKEN_EXPIRING_HANDLERS].splice(idx, 1)
    }
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
   * @returns {Promise<string | string[] | JSONObj | undefined>} Promise resolving to the response data.
   * @throws Error if the request fails or returns an error status.
   * @remarks
   * Handles authentication, content-type headers, encryption key versions,
   * and response parsing automatically.
   * @private
   */
  async request (method: string, path: string, body?: JSONObj | string | string[]): Promise<string | string[] | JSONObj | undefined> {
    if (!this[CREDENTIALS].accessToken && this.isGettingAccessToken) await this.isGettingAccessToken

    const basicAuthHeader = (this[CREDENTIALS].apiKey && this[CREDENTIALS].apiSecret) ? `Basic ${btoa(`${this[CREDENTIALS].apiKey}:${this[CREDENTIALS].apiSecret}`)}` : undefined
    const bearerAuthHeader = this[CREDENTIALS].accessToken ? `Bearer ${this[CREDENTIALS].accessToken}` : undefined
    let authHeader = this[CREDENTIALS].accessToken ? bearerAuthHeader : basicAuthHeader
    if (path === '/auth/token') authHeader = basicAuthHeader

    if (!authHeader) throw new Error('No authentication option provided! (apiKey + apiSecret or accessToken)')

    const headers: {
      Authorization: string; [key: string]: string
    } = {
      Authorization: authHeader
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
