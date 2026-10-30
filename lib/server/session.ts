import { createHmac, randomBytes } from 'node:crypto'
import { query } from './db'
const lifetime = 8 * 60 * 60
const digest = (token: string) => {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET is required')
  return createHmac('sha256', secret).update(token).digest('hex')
}
export async function createSession(): Promise<string> {
  const token = randomBytes(32).toString('hex')
  await query('INSERT INTO auth_sessions(token_hash, expires_at) VALUES ($1,$2)', [digest(token), new Date(Date.now() + lifetime * 1000).toISOString()])
  return token
}
export async function validSession(token?: string): Promise<boolean> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return false
  const [row] = await query('SELECT 1 FROM auth_sessions WHERE token_hash = $1 AND expires_at > $2', [digest(token), new Date().toISOString()])
  return Boolean(row)
}
export async function deleteSession(token?: string) {
  if (token && /^[a-f0-9]{64}$/.test(token)) await query('DELETE FROM auth_sessions WHERE token_hash = $1', [digest(token)])
}
export async function throttleLogin(clientId: string): Promise<boolean> {
  const keyHash = digest(clientId)
  const now = new Date()
  const windowStart = new Date(now.getTime() - 15 * 60 * 1000).toISOString()
  const [row] = await query<{ attempts: number }>(`INSERT INTO auth_attempts(key_hash, attempts, window_start) VALUES ($1, 1, $2)
    ON CONFLICT(key_hash) DO UPDATE SET attempts = CASE WHEN auth_attempts.window_start < $3 THEN 1 ELSE auth_attempts.attempts + 1 END,
    window_start = CASE WHEN auth_attempts.window_start < $3 THEN $2 ELSE auth_attempts.window_start END RETURNING attempts`, [keyHash, now.toISOString(), windowStart])
  return row.attempts <= 10
}
