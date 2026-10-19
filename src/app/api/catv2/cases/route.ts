import { NextResponse } from 'next/server';
import { getCasesFor, NODE_ID_RE } from '@/lib/catv2';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const u = new URL(req.url);
  const id = u.searchParams.get('id') ?? '';
  const page = Math.max(1, parseInt(u.searchParams.get('page') ?? '1', 10) || 1);
  if (!NODE_ID_RE.test(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  const r = await getCasesFor(id, page);
  if (!r) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(r, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
