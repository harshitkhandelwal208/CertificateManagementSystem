import { validateLayout } from '@/lib/server/validation'
import { NextResponse } from 'next/server'
import { DEFAULT_TEMPLATE_LAYOUT, normalizeTemplateId } from '@/lib/template-layout'
import { readRuntimeFile, writeRuntimeFile } from '@/lib/server/files'
import { apiError, ApiError, stringField } from '@/lib/server/http'
export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  try {
    const templateId = normalizeTemplateId(stringField(new URL(request.url).searchParams.get('templateKey'), 'template key', 180))
    const bytes = await readRuntimeFile(`templates/${templateId}.json`)
    return NextResponse.json(bytes ? JSON.parse(bytes.toString('utf8')) : DEFAULT_TEMPLATE_LAYOUT)
  } catch (error) { return apiError(error) }
}
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const templateId = normalizeTemplateId(stringField(body.templateKey, 'template key', 180))
    const layout = validateLayout(body.layout)
    await writeRuntimeFile(`templates/${templateId}.json`, JSON.stringify(layout))
    return NextResponse.json({ success: true, templateId, layout })
  } catch (error) { return apiError(error) }
}
