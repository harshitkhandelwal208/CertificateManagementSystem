import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createSession, throttleLogin } from '@/lib/server/session'

export const dynamic = 'force-dynamic'

function matches(a: string, b: string) {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())
}

export async function POST(request: Request) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const { email, password } = await request.json()
    const account = typeof email === 'string' ? email.trim().toLowerCase() : 'invalid'
    if (!await throttleLogin(`ip:${ip}`) || !await throttleLogin(`account:${account}`)) return NextResponse.json({ error: 'Too many sign-in attempts. Try again later.' }, { status: 429 })
    const configuredEmail = process.env.ADMIN_EMAIL
    const configuredPassword = process.env.ADMIN_PASSWORD
    if (!configuredEmail || !configuredPassword || configuredPassword.length < 12 || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
      return NextResponse.json({ error: 'Administrator login is not configured.' }, { status: 503 })
    }
    if (typeof email !== 'string' || typeof password !== 'string' || !matches(email.trim().toLowerCase(), configuredEmail.trim().toLowerCase()) || !matches(password, configuredPassword)) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }
    const res = NextResponse.json({ accessToken: '', refreshToken: '', user: { id: 1, name: 'Administrator', email: configuredEmail, role: 'admin' } })
    res.cookies.set('credentia-session', await createSession(), { path: '/', maxAge: 8 * 60 * 60, httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' })
    return res
  } catch {
    return NextResponse.json({ error: 'Unable to sign in.' }, { status: 400 })
  }
}
