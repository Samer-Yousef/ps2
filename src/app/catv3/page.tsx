import type { Metadata } from 'next';
import { getOrganZoom } from '@/lib/catv3';
import Zoom from './Zoom';
import './catv3.css';

export const metadata: Metadata = { title: 'Catalogue — zoom', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function CatV3Page({ searchParams }: { searchParams: Promise<{ o?: string }> }) {
  const { o } = await searchParams;
  const organId = Number(o) || 786; // Breast
  const root = await getOrganZoom(organId);
  return <div className="cv3"><Zoom root={root} /></div>;
}
