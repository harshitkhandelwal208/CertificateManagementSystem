import { createHmac, timingSafeEqual } from 'node:crypto'

const lifetime = 8 * 60 * 60

export function createSession(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters')
  const expires = String(Math.floor(Date.now() / 1000) + lifetime)
  return `${expires}.${createHmac('sha256', secret).update(expires).digest('hex')}`
}

export function validSession(token?: string): boolean {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32 || !token) return false
  const [expires, signature, extra] = token.split('.')
  if (extra || !/^\d+$/.test(expires || '') || !/^[a-f0-9]{64}$/.test(signature || '') || Number(expires) <= Date.now() / 1000) return false
  const expected = createHmac('sha256', secret).update(expires).digest()
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'))
}
