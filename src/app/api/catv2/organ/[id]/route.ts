import { NextResponse } from 'next/server';
import { getOrganTree } from '@/lib/catv2';
export const dynamic = 'force-dynamic';
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  const tree = await getOrganTree(Number(id));
  return NextResponse.json(tree, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
