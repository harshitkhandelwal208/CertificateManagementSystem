import { NextResponse } from 'next/server';
import { issueBatchCertificates } from '@/lib/server/issuer';
import { getDb } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { recipients, eventId, eventName, templateId, layout } = body;

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return NextResponse.json({ error: 'Recipients must be a non-empty array' }, { status: 400 });
    }
    if (typeof templateId !== 'string' || !templateId.startsWith('custom-')) {
      return NextResponse.json({ error: 'An uploaded certificate template is required.' }, { status: 400 });
    }

    const batchResult = await issueBatchCertificates({
      recipients: recipients.map((r: any) => ({
        name: r.name || r.fullName,
        email: r.email,
        phone: r.phone,
      })),
      eventId,
      eventName,
      templateId,
      layout,
    });

    if (typeof eventId === 'string' && batchResult.issuedCount > 0) getDb().prepare('UPDATE events SET template_id = ? WHERE event_id = ?').run(templateId.trim(), eventId.trim());

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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
