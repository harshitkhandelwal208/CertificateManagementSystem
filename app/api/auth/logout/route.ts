import { NextResponse } from 'next/server';
import { deleteSession } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const token = request.headers.get('cookie')?.match(/(?:^|; )credentia-session=([^;]+)/)?.[1];
    await deleteSession(token);
    const res = new NextResponse(null, { status: 204 });
    res.cookies.delete('credentia-session');
    return res;
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
