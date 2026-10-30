import { NextResponse } from 'next/server'
import { getCertificateRecordByPublicId } from '@/lib/server/certificates'
import { readRuntimeFile } from '@/lib/server/files'
import { apiError } from '@/lib/server/http'
export const dynamic = 'force-dynamic'
export async function GET(request: Request, { params }: { params: Promise<{ publicId: string }> }) {
  try {
    const { publicId } = await params
    const cert = await getCertificateRecordByPublicId(publicId)
    if (!cert || cert.status !== 'Issued' || !cert.artifact_path) return NextResponse.json({ error: 'Certificate not found or unavailable.' }, { status: 404 })
    const bytes = await readRuntimeFile(cert.artifact_path)
    if (!bytes) return NextResponse.json({ error: 'Certificate artifact not found.' }, { status: 404 })
    return new NextResponse(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="certificate-${publicId}.pdf"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' } })
  } catch (error) { return apiError(error) }
}
