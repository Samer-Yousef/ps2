import Link from 'next/link';
import { getRoots, getAllOrgans, getTotals, getSources } from '@/lib/catalogue';
import { fmt } from './ui';

export const dynamic = 'force-dynamic';

export default async function CatalogueHome() {
  const [systems, organs, totals, sources] = await Promise.all([getRoots(), getAllOrgans(), getTotals(), getSources()]);
  return (
    <main className="cat-main">
      <h1 className="cat-h1">Catalogue</h1>
      <p className="cat-lead">{fmt(totals.c)} cases, {fmt(totals.s)} slides, from {sources.map((s) => s.name).join(', ')}.</p>
      <div className="cat-systems">
        {systems.map((s) => (
          <section key={s.id} className="cat-system">
            <Link href={`/catalogue/${s.path}`} className="cat-system-h"><span>{s.name}</span><span className="ct">{fmt(s.n_cases)}</span></Link>
            <ul>
              {organs.filter((o) => o.parent_id === s.id).map((o) => (
                <li key={o.id}><Link href={`/catalogue/${o.path}`} className="cat-organ"><span>{o.name}</span><span className="ct">{fmt(o.n_cases)}</span></Link></li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
