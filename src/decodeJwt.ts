/**
 * Decode a Base64Url‐encoded string into a UTF-8 string.
 * @param str - Base64Url string (no padding, “-”/“_”).
 * @returns The decoded UTF-8 string.
 */
function base64UrlDecode (str: string): string {
  // 1) Replace URL‐specific characters
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  // 2) Add padding (“=”) until length is a multiple of 4
  while (base64.length % 4 !== 0) {
    base64 += '='
  }
  // 3) atob() decodes from standard Base64 into a binary string
  return atob(base64)
}

/**
 * Convert a binary string (each character code 0–255) into its hex representation.
 * @param binaryStr - The binary string from atob().
 * @returns A lowercase hex string (two chars per byte).
 */
function binaryToHex (binaryStr: string): string {
  let hex = ''
  for (let i = 0; i < binaryStr.length; i++) {
    const byte = binaryStr.charCodeAt(i)
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

/**
 * Decode a JWT (header, payload, signature) without any external dependencies.
 *
 * @param token - The full JWT string: header.payload.signature
 * @returns An object containing:
 *   - header:   the decoded header as a plain object
 *   - payload:  the decoded payload as a plain object
 *   - signatureHex: the signature bytes in hex form
 *
 * @throws Error if the token is not a string, does not have three parts,
 *               or if header/payload JSON parsing fails.
 */
export default function (
  token: string
): { header: Record<string, unknown>; payload: Record<string, unknown>; signatureHex: string } {
  if (typeof token !== 'string') {
    throw new Error('JWT must be a string')
  }

  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new Error('JWT should consist of three parts: header.payload.signature')
  }

  const [headerB64u, payloadB64u, signatureB64u] = parts

  // Decode header → JSON.parse
  const headerJson = base64UrlDecode(headerB64u)
  let header: Record<string, unknown>
  try {
    header = JSON.parse(headerJson)
  } catch (e: any) {
    throw new Error('Invalid JWT header JSON: ' + e.message)
  }

  // Decode payload → JSON.parse
  const payloadJson = base64UrlDecode(payloadB64u)
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(payloadJson)
  } catch (e: any) {
    throw new Error('Invalid JWT payload JSON: ' + e.message)
  }

  // Decode signature (binary) → hex string
  const signatureBinary = base64UrlDecode(signatureB64u)
  const signatureHex = binaryToHex(signatureBinary)

  return { header, payload, signatureHex }
}
