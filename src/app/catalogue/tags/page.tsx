import Link from 'next/link';
import { getTags } from '@/lib/catalogue';
import { fmt } from '../ui';

export const dynamic = 'force-dynamic';

export default async function TagsPage() {
  const tags = await getTags();
  return (
    <main className="cat-main">
      <h1 className="cat-h1">Tags</h1>
      <p className="cat-lead">Cross-cutting filters a learner reaches for: specimen types, subject areas and lesion types that sit across many organs.</p>
      <ul className="cat-tree d0">
        {tags.map((t) => (
          <li key={t.tag}><Link href={`/catalogue/tag/${t.tag}`} className="cat-node lvl-group"><span className="nm">{t.tag_name}</span><span className="ct">{fmt(t.n)}</span></Link></li>
        ))}
      </ul>
    </main>
  );
}
