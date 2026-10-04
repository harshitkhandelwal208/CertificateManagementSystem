import { NextResponse } from 'next/server';
import { getDb } from '@/lib/server/db';
import { getVerificationUrl } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const row = db.prepare("SELECT count(*) as count FROM certificates").get() as { count: number };

    let verificationOnline = false;
    try {
      const vRes = await fetch(`${getVerificationUrl()}/health`, { cache: 'no-store' });
      verificationOnline = vRes.ok;
    } catch {
      try {
        const vRes = await fetch(`${getVerificationUrl()}/favicon.ico`, { cache: 'no-store' });
        verificationOnline = vRes.ok;
      } catch {
        verificationOnline = false;
      }
    }

    return NextResponse.json({
      status: 'ok',
      mode: 'ngo-admin-direct',
      totalCertificates: row.count,
      services: {
        adminConsole: 'online',
        independentVerification: verificationOnline ? 'online' : 'unreachable',
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
