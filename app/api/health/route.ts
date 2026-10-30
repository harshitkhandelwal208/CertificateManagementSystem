import { NextResponse } from 'next/server'
import { getDb } from '@/lib/server/db'

export const dynamic = 'force-dynamic'
export async function GET() {
  try {
    getDb().prepare('SELECT 1').get()
    return NextResponse.json({ status: 'ok' })
  } catch {
    return NextResponse.json({ status: 'unavailable' }, { status: 503 })
  }
}
