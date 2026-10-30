import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { validSession } from '@/lib/server/session'

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const token = request.cookies.get('credentia-session')?.value
  let authenticated = false
  if (token) { try { authenticated = await validSession(token) } catch { authenticated = false } }
  const publicApi = pathname === '/api/health' || pathname === '/api/auth/login' || pathname === '/api/auth/logout' || /^\/api\/certificates\/[^/]+\/download$/.test(pathname)
  if (pathname.startsWith('/api/')) {
    if (!publicApi && !authenticated) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const origin = request.headers.get('origin')
      if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    }
    return NextResponse.next()
  }
  if (pathname === '/login') return authenticated ? NextResponse.redirect(new URL('/events', request.url)) : NextResponse.next()
  if ((pathname === '/' || /^\/(events|certificates)(\/|$)/.test(pathname)) && !authenticated) return NextResponse.redirect(new URL('/login', request.url))
  if (pathname === '/') return NextResponse.redirect(new URL('/events', request.url))
  return NextResponse.next()
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] }
