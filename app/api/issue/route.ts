import { NextResponse } from 'next/server';
import { issueSingleCertificate } from '@/lib/server/issuer';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { fullName, eventId, eventName, email, phone, templateId, layout } = body;

    if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
      return NextResponse.json({ error: 'FullName is required.' }, { status: 400 });
    }

    const result = await issueSingleCertificate({
      fullName: fullName.trim(),
      eventId: eventId?.trim(),
      eventName: eventName?.trim(),
      email: email?.trim(),
      phone: phone?.trim(),
      templateId: templateId?.trim(),
      layout,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
