import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { query } from './db'
const lifetime = 8 * 60 * 60
function signature(payload: string): Buffer {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET is required')
  return createHmac('sha256', secret).update(payload).digest()
}
export function createSession(): string {
  const payload = `${Math.floor(Date.now() / 1000) + lifetime}.${randomBytes(24).toString('hex')}`
  return `${payload}.${signature(payload).toString('hex')}`
}
export function validSession(token?: string): boolean {
  if (!token) return false
  const [expires, nonce, signed, extra] = token.split('.')
  if (extra || !/^\d+$/.test(expires || '') || !/^[a-f0-9]{48}$/.test(nonce || '') || !/^[a-f0-9]{64}$/.test(signed || '') || Number(expires) <= Date.now() / 1000) return false
  try { return timingSafeEqual(signature(`${expires}.${nonce}`), Buffer.from(signed, 'hex')) } catch { return false }
}
export async function deleteSession(_token?: string) {}
export async function throttleLogin(clientId: string): Promise<boolean> {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET is required')
  const keyHash = createHmac('sha256', secret).update(clientId).digest('hex')
  const now = new Date()
  const windowStart = new Date(now.getTime() - 15 * 60 * 1000).toISOString()
  const [row] = await query<{ attempts: number }>(`INSERT INTO auth_attempts(key_hash, attempts, window_start) VALUES ($1, 1, $2)
    ON CONFLICT(key_hash) DO UPDATE SET attempts = CASE WHEN auth_attempts.window_start < $3 THEN 1 ELSE auth_attempts.attempts + 1 END,
    window_start = CASE WHEN auth_attempts.window_start < $3 THEN $2 ELSE auth_attempts.window_start END RETURNING attempts`, [keyHash, now.toISOString(), windowStart])
  return row.attempts <= 10
}
