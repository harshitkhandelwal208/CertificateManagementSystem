import type { AuthResponse, UserInfo } from './types'

const TOKEN_KEY = 'credentia:tokens'
const USER_KEY = 'credentia:user'

// ── Token persistence ─────────────────────────────────────────────────

export interface StoredAuth {
  accessToken: string
  refreshToken: string
  user: UserInfo
}

export function readAuth(): StoredAuth | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(TOKEN_KEY)
    return raw ? (JSON.parse(raw) as StoredAuth) : null
  } catch {
    return null
  }
}

export function writeAuth(auth: StoredAuth | null) {
  if (typeof window === 'undefined') return
  if (!auth) {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    return
  }
  localStorage.setItem(TOKEN_KEY, JSON.stringify(auth))
  // Keep legacy user key for components that read it
  localStorage.setItem(USER_KEY, JSON.stringify({ name: auth.user.name, email: auth.user.email }))
}

export function getAccessToken(): string | null {
  return readAuth()?.accessToken ?? null
}

// ── API calls ─────────────────────────────────────────────────────────

async function authFetch(url: string, body: Record<string, unknown>): Promise<AuthResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    if (res.status === 409) throw new Error('An account with this email already exists.')
    if (res.status === 401) throw new Error('Invalid email or password.')
    throw new Error(data.error || `Authentication failed (${res.status})`)
  }

  return res.json() as Promise<AuthResponse>
}

export async function login(email: string, password: string): Promise<StoredAuth> {
  const resp = await authFetch('/api/auth/login', { email, password })
  const stored: StoredAuth = { accessToken: resp.accessToken, refreshToken: resp.refreshToken, user: resp.user }
  writeAuth(stored)
  return stored
}

export async function register(name: string, email: string, password: string): Promise<StoredAuth> {
  const resp = await authFetch('/api/auth/register', { name, email, password })
  const stored: StoredAuth = { accessToken: resp.accessToken, refreshToken: resp.refreshToken, user: resp.user }
  writeAuth(stored)
  return stored
}

export async function refreshTokens(): Promise<StoredAuth | null> {
  const current = readAuth()
  if (!current?.refreshToken) return null
  try {
    const resp = await authFetch('/api/auth/refresh', { refreshToken: current.refreshToken })
    const stored: StoredAuth = { accessToken: resp.accessToken, refreshToken: resp.refreshToken, user: resp.user }
    writeAuth(stored)
    return stored
  } catch {
    writeAuth(null)
    return null
  }
}

export async function logout(): Promise<void> {
  const current = readAuth()
  if (current) {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    }).catch(() => {}) // best-effort
  }
  writeAuth(null)
}
