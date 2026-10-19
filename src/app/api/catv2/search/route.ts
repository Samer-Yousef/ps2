import { NextResponse } from 'next/server';
import { searchTree } from '@/lib/catv2';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 60);
  if (q.length < 2) return NextResponse.json([]);
  return NextResponse.json(await searchTree(q), { headers: { 'Cache-Control': 'public, max-age=600' } });
}
