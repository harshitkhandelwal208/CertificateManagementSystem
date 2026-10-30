import { apiError, pageNumber, stringField } from '@/lib/server/http';
import { NextResponse } from 'next/server';
import { revokeCertificate } from '@/lib/server/certificates';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ publicId: string }> }
) {
  try {
    const { publicId } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = stringField(body?.reason ?? 'Revoked by administrative authority', 'revocation reason', 1000);

    const success = await revokeCertificate(publicId, reason);
    if (!success) {
      return NextResponse.json({ error: 'Certificate not found or already revoked' }, { status: 404 });
    }

    return NextResponse.json({ success: true, status: 'Revoked', revocationReason: reason });
  } catch (error: any) {
    return apiError(error);
  }
}
