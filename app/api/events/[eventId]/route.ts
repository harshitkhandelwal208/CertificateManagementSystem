import { apiError, pageNumber, stringField } from '@/lib/server/http';
import { NextResponse } from 'next/server';
import { getEventDetail } from '@/lib/server/certificates';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId } = await params;
    const { searchParams } = new URL(request.url);
    const page = pageNumber(searchParams.get('page'), 1);
    const pageSize = pageNumber(searchParams.get('pageSize'), 50, 200);

    const detail = await getEventDetail(eventId, page, pageSize);
    if (!detail) {
      return NextResponse.json({ error: `Event '${eventId}' not found.` }, { status: 404 });
    }

    return NextResponse.json(detail);
  } catch (error: any) {
    return apiError(error);
  }
}
