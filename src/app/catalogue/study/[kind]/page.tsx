import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getStudyGroups } from '@/lib/catalogue';
import { fmt } from '../../ui';

export const dynamic = 'force-dynamic';
const categories: Record<string, { name: string; description: string }> = {
  normal: { name: 'Normal histology', description: 'Choose an organ to review normal tissue before comparing it with disease.' },
  neoplastic: { name: 'Neoplastic', description: 'Choose an organ to browse neoplasms in the WHO hierarchy.' },
  non_neoplastic: { name: 'Non-neoplastic', description: 'Choose an organ to browse Pathology Outlines based headings and supplementary teaching categories.' },
};
export default async function StudyPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const category = Object.hasOwn(categories, kind) ? categories[kind] : null;
  if (!category) notFound();
  const groups = await getStudyGroups(kind);
  return <main className="cat-main">
    <div className="cat-crumbs"><Link href="/catalogue">Catalogue</Link></div>
    <h1 className="cat-h1">{category.name}</h1>
    <p className="cat-lead">{category.description}</p>
    <p className="cat-reference">{fmt(groups.reduce((n, g) => n + g.n_cases, 0))} cases · Numbers beside organs are case counts.</p>
    <div className="cat-systems">{groups.map(g => <Link className="cat-organ" href={`/catalogue/${g.path.split('/').slice(0, -1).join('/')}#${kind === 'non_neoplastic' ? 'non-neoplastic' : kind}`} key={g.id}><span>{g.organ_name}</span><span className="ct">{g.n_cases ? fmt(g.n_cases) : 'None yet'}</span></Link>)}</div>
  </main>;
}
