import { NextResponse } from 'next/server';
import { issueSingleCertificate } from '@/lib/server/issuer';
import { query } from '@/lib/server/db';
import { cacheRuntimeFile } from '@/lib/server/files';
import { apiError, ApiError, stringField } from '@/lib/server/http';
import { validateLayout } from '@/lib/server/validation';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { fullName, eventId, eventName, email, phone, templateId, layout } = body;

    if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
      return NextResponse.json({ error: 'FullName is required.' }, { status: 400 });
    }
    if (typeof templateId !== 'string' || !/^custom-[a-z0-9_-]{1,170}$/.test(templateId)) {
      return NextResponse.json({ error: 'An uploaded certificate template is required.' }, { status: 400 });
    }

    if (!await cacheRuntimeFile(`templates/${templateId}.pdf`)) throw new ApiError('Certificate template not found.', 404);
    await cacheRuntimeFile(`templates/${templateId}.json`);
    stringField(fullName, 'recipient name', 200);
    if (email) stringField(email, 'email', 254);
    const result = await issueSingleCertificate({
      fullName: fullName.trim(),
      eventId: eventId ? stringField(eventId, 'event ID', 100) : undefined,
      eventName: eventName ? stringField(eventName, 'event name', 200) : undefined,
      email: email ? stringField(email, 'email', 254) : undefined,
      phone: phone ? stringField(phone, 'phone', 40) : undefined,
      templateId: templateId?.trim(),
      layout: validateLayout(layout),
    });

    if (typeof eventId === 'string') await query('UPDATE events SET template_id = $1 WHERE event_id = $2', [templateId.trim(), eventId.trim()]);

    return NextResponse.json(result);
  } catch (error: any) {
    return apiError(error);
  }
}
