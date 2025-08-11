import { vi } from 'vitest'
import Base from '../../../src/Base'
// import { NonLocalStorage } from '../../../src/index'
import { setImmediate } from 'node:timers/promises'

function generateDummyJWT (payload) {
  const header = {
    jti: 'bla bla bla',
    alg: 'ES512',
    kid: 'v0'
  }

  // Base64URL encode a JSON object
  const base64UrlEncode = (obj) => {
    return Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=/g, '')        // Remove padding
      .replace(/\+/g, '-')      // Replace + with -
      .replace(/\//g, '_')      // Replace / with _
  }

  const encodedHeader = base64UrlEncode(header)
  const encodedPayload = base64UrlEncode(payload)
  const dummySignature = base64UrlEncode('dummysignature123') // This can be any string

  return `${encodedHeader}.${encodedPayload}.${dummySignature}`
}

export default () => {
  const mock = vi.spyOn(Base, 'retrieveAccessToken').mockImplementation(
    async function (projectId: string, apiKey: string, apiSecret: string): Promise<string> {
      await setImmediate()
      return generateDummyJWT({
        sub: apiKey,
        iss: 'NonLocalStorage-Api',
        exp: Date.now() + (1 * 60 * 60 * 1000), // 1h
        id: apiKey,
        accountId: 'some-dummy-accountId',
        projectId,
        iat: Math.round(Date.now() / 1000)
      })
    }
  )

  return () => mock.mockRestore()
}
