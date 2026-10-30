import { apiError, pageNumber, stringField } from '@/lib/server/http';
import { NextResponse } from 'next/server';
import { getCertificatesPaginated } from '@/lib/server/certificates';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = pageNumber(searchParams.get('page'), 1);
    const pageSize = pageNumber(searchParams.get('pageSize'), 50, 200);
    const eventId = searchParams.get('eventId');
    const status = searchParams.get('status');
    const search = searchParams.get('search');

    const result = await getCertificatesPaginated({
      page,
      pageSize,
      eventId,
      status,
      search,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    return apiError(error);
  }
}
