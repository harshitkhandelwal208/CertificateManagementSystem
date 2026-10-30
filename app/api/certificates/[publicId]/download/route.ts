import { NextResponse } from 'next/server';
import fs from 'node:fs';
import { getCertificatePdfPath } from '@/lib/server/certificates';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ publicId: string }> }
) {
  try {
    const { publicId } = await params;
    const pdfPath = getCertificatePdfPath(publicId);
    
    if (pdfPath && fs.existsSync(pdfPath)) {
      const fileBuffer = fs.readFileSync(pdfPath);
      return new NextResponse(fileBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="certificate-${publicId}.pdf"`,
          'Content-Length': fileBuffer.length.toString(),
        },
      });
    }

    // Remote engine proxy fallback for cloud hosting
    const engineUrl = process.env.ENGINE_URL;
    const apiKey = process.env.ENGINE_API_KEY || process.env.Platform__InternalApiKey || '';
    if (engineUrl && engineUrl.startsWith("http")) {
      const remoteRes = await fetch(`${engineUrl.replace(/\/+$/, '')}/manage/certificates/${publicId}/download`, {
        headers: {
          'X-Api-Key': apiKey,
        },
      });
      if (remoteRes.ok) {
        const remoteBuffer = Buffer.from(await remoteRes.arrayBuffer());
        return new NextResponse(remoteBuffer, {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="certificate-${publicId}.pdf"`,
            'Content-Length': remoteBuffer.length.toString(),
          },
        });
      }
    }

    return NextResponse.json({ error: 'Certificate PDF artifact not found' }, { status: 404 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
