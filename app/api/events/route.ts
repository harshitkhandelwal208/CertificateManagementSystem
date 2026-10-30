import { NextResponse } from 'next/server';
import { getEventSummaries } from '@/lib/server/certificates';
import { getDb } from '@/lib/server/db';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const events = getEventSummaries();
    return NextResponse.json(events);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { eventId, eventName, templateId } = await request.json();
    if (typeof eventId !== 'string' || !/^[a-z0-9-]+$/.test(eventId) || typeof eventName !== 'string' || !eventName.trim() || typeof templateId !== 'string' || !/^custom-[a-z0-9_-]+$/.test(templateId)) {
      return NextResponse.json({ error: 'A valid event name, ID, and uploaded template are required.' }, { status: 400 });
    }
    const db = getDb();
    if (getEventSummaries().some(event => event.eventId.toLowerCase() === eventId.toLowerCase())) {
      return NextResponse.json({ error: 'An event with this name already exists.' }, { status: 409 });
    }
    const dataDir = process.env.DATA_DIR && fs.existsSync(process.env.DATA_DIR) ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), 'data');
    const templatesDir = path.join(dataDir, 'templates');
    const sourcePdf = path.join(templatesDir, `${templateId}.pdf`);
    if (!fs.existsSync(sourcePdf)) return NextResponse.json({ error: 'Upload a certificate template before creating an event.' }, { status: 400 });
    const eventTemplateId = `custom-event-${eventId}-${crypto.randomUUID()}`;
    const targetPdf = path.join(templatesDir, `${eventTemplateId}.pdf`);
    const targetLayout = path.join(templatesDir, `${eventTemplateId}.json`);
    const sourceLayout = path.join(templatesDir, `${templateId}.json`);
    let copiedPdf = false;
    let copiedLayout = false;
    try {
      fs.copyFileSync(sourcePdf, targetPdf, fs.constants.COPYFILE_EXCL);
      copiedPdf = true;
      if (fs.existsSync(sourceLayout)) {
        fs.copyFileSync(sourceLayout, targetLayout, fs.constants.COPYFILE_EXCL);
        copiedLayout = true;
      }
      db.prepare('INSERT INTO events (event_id, event_name, template_id, created_at) VALUES (?, ?, ?, ?)').run(eventId, eventName.trim(), eventTemplateId, new Date().toISOString());
    } catch (error) {
      if (copiedPdf) fs.unlinkSync(targetPdf);
      if (copiedLayout) fs.unlinkSync(targetLayout);
      throw error;
    }
    return NextResponse.json({ eventId, templateId: eventTemplateId }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
