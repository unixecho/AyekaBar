import { SignJWT, jwtVerify } from 'jose'

export interface QRPayload {
  businessId: string
  jti: string
  iat: number
  exp: number
}

const QR_EXPIRY_MINUTES = 15

function getSecret(): Uint8Array {
  const secret = process.env.QR_SECRET
  if (!secret) throw new Error('QR_SECRET environment variable is not set')
  return new TextEncoder().encode(secret)
}

/**
 * Generate a signed QR token for staff to display.
 * Expires in 15 minutes. Contains a unique jti so each token can only be used once.
 */
export async function generateQRToken(businessId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + QR_EXPIRY_MINUTES * 60

  const token = await new SignJWT({
    businessId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(crypto.randomUUID())
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(getSecret())

  return token
}

/**
 * Verify a QR token. Returns the payload or null if invalid/expired.
 */
export async function verifyQRToken(token: string): Promise<QRPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ['HS256'],
    })

    return {
      businessId: payload['businessId'] as string,
      jti: payload.jti as string,
      iat: payload.iat as number,
      exp: payload.exp as number,
    }
  } catch {
    return null
  }
}

export function getExpiresAt(minutesFromNow = QR_EXPIRY_MINUTES): Date {
  return new Date(Date.now() + minutesFromNow * 60 * 1000)
}
