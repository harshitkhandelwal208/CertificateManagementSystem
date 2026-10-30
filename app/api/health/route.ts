import { NextResponse } from 'next/server'
import { query } from '@/lib/server/db'
import { getVerificationUrl } from '@/lib/api'
export const dynamic = 'force-dynamic'
export async function GET() {
  try {
    await query('SELECT 1 FROM certificates LIMIT 1')
    const res = await fetch(`${getVerificationUrl()}/health`, { cache: 'no-store', signal: AbortSignal.timeout(10000) })
    if (!res.ok) throw new Error('Verifier unavailable')
    return NextResponse.json({ status: 'ok' })
  } catch { return NextResponse.json({ status: 'unavailable' }, { status: 503 }) }
}
