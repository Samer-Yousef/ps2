import type { Metadata } from 'next';
import { getRootTree } from '@/lib/catv2';
import Tree4 from './Tree4';
import '../catv2/catv2.css';
import './catv4.css';

export const metadata: Metadata = {
  title: 'Catalogue — outline',
  description: 'Browse the slide catalogue as an outline with guide lines: organ, WHO classification, disease patterns, cases.',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export default async function CatV4Page({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const [root, { n }] = await Promise.all([getRootTree(), searchParams]);
  const total = root.reduce((a, s) => a + s.cases, 0);
  return (
    <div className="cv2 cv4">
      <Tree4 root={root} initial={n ?? null} total={total} />
    </div>
  );
}
