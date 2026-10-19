import type { Metadata } from 'next';
import { getRootTree } from '@/lib/catv2';
import Tree from './Tree';
import './catv2.css';

export const metadata: Metadata = {
  title: 'Catalogue',
  description: 'Browse the slide catalogue as one tree: organ, WHO classification, disease patterns, cases.',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export default async function CatV2Page({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const [root, { n }] = await Promise.all([getRootTree(), searchParams]);
  const total = root.reduce((a, s) => a + s.cases, 0);
  return (
    <div className="cv2">
      <Tree root={root} initial={n ?? null} total={total} />
    </div>
  );
}
