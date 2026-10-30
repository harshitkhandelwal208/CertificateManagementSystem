import { NextResponse } from 'next/server';
import { issueBatchCertificates } from '@/lib/server/issuer';
import { query } from '@/lib/server/db';
import { cacheRuntimeFile } from '@/lib/server/files';
import { apiError, ApiError, stringField } from '@/lib/server/http';
import { validateLayout } from '@/lib/server/validation';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { recipients, eventId, eventName, templateId, layout } = body;

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return NextResponse.json({ error: 'Recipients must be a non-empty array' }, { status: 400 });
    }
    if (typeof templateId !== 'string' || !/^custom-[a-z0-9_-]{1,170}$/.test(templateId)) {
      return NextResponse.json({ error: 'An uploaded certificate template is required.' }, { status: 400 });
    }

    if (recipients.length > 100) throw new ApiError('A batch can contain at most 100 recipients.');
    if (!await cacheRuntimeFile(`templates/${templateId}.pdf`)) throw new ApiError('Certificate template not found.', 404);
    await cacheRuntimeFile(`templates/${templateId}.json`);
    for (const recipient of recipients) { if (!recipient || typeof recipient !== 'object') throw new ApiError('Invalid recipient.'); stringField(recipient.name || recipient.fullName, 'recipient name', 200); if (recipient.email) stringField(recipient.email, 'email', 254); }
    const batchResult = await issueBatchCertificates({
      recipients: recipients.map((r: any) => ({
        name: r.name || r.fullName,
        email: r.email,
        phone: r.phone,
      })),
      eventId: eventId ? stringField(eventId, 'event ID', 100) : undefined,
      eventName: eventName ? stringField(eventName, 'event name', 200) : undefined,
      templateId,
      layout: validateLayout(layout),
    });

    if (typeof eventId === 'string' && batchResult.issuedCount > 0) await query('UPDATE events SET template_id = $1 WHERE event_id = $2', [templateId.trim(), eventId.trim()]);

    // Format for existing frontend components: array of results
    const mapped = batchResult.results.map((r) => ({
      success: r.status === 'Issued',
      name: r.recipientName,
      data: r.status === 'Issued' ? {
        publicId: r.publicId,
        certificateNumber: r.certificateNumber,
        verifyPath: r.verifyPath,
      } : undefined,
      error: r.error,
    }));

    return NextResponse.json(mapped);
  } catch (error: any) {
    return apiError(error);
  }
}
