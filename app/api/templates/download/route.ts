import { NextResponse } from 'next/server'
import { normalizeTemplateId } from '@/lib/template-layout'
import { readRuntimeFile } from '@/lib/server/files'
import { apiError, stringField } from '@/lib/server/http'
export async function GET(request: Request) {
  try {
    const id = normalizeTemplateId(stringField(new URL(request.url).searchParams.get('templateKey'), 'template key', 180))
    const bytes = await readRuntimeFile(`templates/${id}.pdf`)
    if (!bytes) return NextResponse.json({ error: 'Template not found.' }, { status: 404 })
    return new NextResponse(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store' } })
  } catch (error) { return apiError(error) }
}
