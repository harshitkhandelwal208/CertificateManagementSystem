import { NextResponse } from 'next/server'
import { getEventSummaries } from '@/lib/server/certificates'
import { transaction } from '@/lib/server/db'
import { apiError, ApiError, stringField } from '@/lib/server/http'
import crypto from 'node:crypto'
export const dynamic = 'force-dynamic'
export async function GET() {
  try { return NextResponse.json(await getEventSummaries()) } catch (error) { return apiError(error) }
}
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const eventId = stringField(body.eventId, 'event ID', 100).toLowerCase()
    const eventName = stringField(body.eventName, 'event name')
    const templateId = stringField(body.templateId, 'template ID', 180)
    if (!/^[a-z0-9-]+$/.test(eventId) || !/^custom-[a-z0-9_-]+$/.test(templateId)) throw new ApiError('Invalid event or template ID.')
    const eventTemplateId = `custom-event-${eventId}-${crypto.randomUUID()}`
    await transaction(async client => {
      const { rows: [pdf] } = await client.query('SELECT content FROM runtime_files WHERE path = $1', [`templates/${templateId}.pdf`])
      if (!pdf) throw new ApiError('Upload a certificate template before creating an event.')
      await client.query('INSERT INTO events(event_id, event_name, template_id, created_at) VALUES ($1,$2,$3,$4)', [eventId, eventName, eventTemplateId, new Date().toISOString()])
      await client.query('INSERT INTO runtime_files(path, content, updated_at) SELECT $1, content, $2 FROM runtime_files WHERE path = $3', [`templates/${eventTemplateId}.pdf`, new Date().toISOString(), `templates/${templateId}.pdf`])
      await client.query('INSERT INTO runtime_files(path, content, updated_at) SELECT $1, content, $2 FROM runtime_files WHERE path = $3', [`templates/${eventTemplateId}.json`, new Date().toISOString(), `templates/${templateId}.json`])
    })
    return NextResponse.json({ eventId, templateId: eventTemplateId }, { status: 201 })
  } catch (error) { return apiError(error) }
}
