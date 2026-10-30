import { NextResponse } from 'next/server'
export async function POST() {
  return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
}
