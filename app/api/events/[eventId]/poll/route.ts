import { NextResponse } from 'next/server'
export async function POST() {
  return NextResponse.json({ error: 'Event polling is not configured for this event.' }, { status: 501 })
}
