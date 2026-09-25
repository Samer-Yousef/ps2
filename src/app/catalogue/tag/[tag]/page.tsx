import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCasesForTag, getSlidesForCases } from '@/lib/catalogue';
import { CaseRow, SourceChips, Pager, fmt } from '../../ui';

export const dynamic = 'force-dynamic';

export default async function TagPage({ params, searchParams }: { params: Promise<{ tag: string }>; searchParams: Promise<{ source?: string; page?: string }> }) {
  const { tag } = await params;
  const { source, page: pageStr } = await searchParams;
  const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1);
  const { cases, total, sources } = await getCasesForTag(tag, { source, page });
  if (!total) notFound();
  const base = `/catalogue/tag/${tag}`;
  const slides = await getSlidesForCases(cases.filter((c) => c.n_slides > 1).map((c) => c.id));
  const byCase = new Map<number, typeof slides>();
  for (const s of slides) { const a = byCase.get(s.case_id) ?? []; a.push(s); byCase.set(s.case_id, a); }
  const organs: { name: string; path: string; cases: typeof cases }[] = [];
  for (const c of cases) {
    let o = organs[organs.length - 1];
    if (!o || o.path !== c.organ_path) { o = { name: c.organ_name, path: c.organ_path, cases: [] }; organs.push(o); }
    o.cases.push(c);
  }
  const name = tag.replace(/_/g, ' ');
  return (
    <main className="cat-main">
      <nav className="cat-crumbs"><Link href="/catalogue">Catalogue</Link><span className="sep">/</span><Link href="/catalogue/tags">Tags</Link></nav>
      <h1 className="cat-h1" style={{ textTransform: 'capitalize' }}>{name}</h1>
      <p className="cat-lead">{fmt(total)} cases</p>
      <SourceChips base={base} sources={sources} active={source} />
      {organs.map((o) => (
        <section key={o.path} className="cat-cases">
          <h2 className="cat-h2"><Link href={`/catalogue/${o.path}`}>{o.name}</Link> <span className="ct">{fmt(o.cases.length)}</span></h2>
          {o.cases.map((c) => <CaseRow key={c.id} c={c} slides={byCase.get(c.id)} showEntity entityName={c.entity_name} entityPath={c.entity_path} organName={c.organ_name} />)}
        </section>
      ))}
      <Pager base={base} total={total} page={page} source={source} />
    </main>
  );
}
