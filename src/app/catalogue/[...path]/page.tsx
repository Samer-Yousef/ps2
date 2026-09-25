import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getNodeByPath, getAncestors, getSubtree, getCasesUnder, getSlidesForCases, type Node } from '@/lib/catalogue';
import { Crumbs, CaseRow, SourceChips, Pager, fmt } from '../ui';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ path: string[] }> }): Promise<Metadata> {
  const { path } = await params;
  const n = await getNodeByPath(path.join('/'));
  return { title: n?.name ?? 'Catalogue' };
}

/** Render the subtree below `root` as nested lists with counts. */
function Tree({ root, all, depth = 0 }: { root: Node; all: Node[]; depth?: number }) {
  const kids = all.filter((n) => n.parent_id === root.id);
  if (!kids.length) return null;
  return (
    <ul className={`cat-tree d${depth}`}>
      {kids.map((k) => (
        <li key={k.id}>
          <Link href={`/catalogue/${k.path}`} className={`cat-node lvl-${k.level}${k.kind ? ' k-' + k.kind : ''}`}>
            <span className="nm">{k.name}</span><span className="ct">{fmt(k.n_cases)}</span>
          </Link>
          {k.level !== 'entity' && <Tree root={k} all={all} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

export default async function NodePage({ params, searchParams }: { params: Promise<{ path: string[] }>; searchParams: Promise<{ all?: string; source?: string; page?: string }> }) {
  const { path } = await params;
  const { all, source, page: pageStr } = await searchParams;
  const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1);
  const node = await getNodeByPath(path.join('/'));
  if (!node) notFound();
  const trail = await getAncestors(node);
  const organ = trail.find((n) => n.level === 'organ');
  const subtree = node.level === 'entity' ? [] : await getSubtree(node);
  const listCases = node.level === 'entity' || node.level === 'subgroup' || node.level === 'group' || all === '1' || !!source;
  const { cases, total, sources } = listCases ? await getCasesUnder(node, { source, page }) : { cases: [], total: 0, sources: [] };
  const base = `/catalogue/${node.path}`;
  const slides = await getSlidesForCases(cases.filter((c) => c.n_slides > 1).map((c) => c.id));
  const byCase = new Map<number, typeof slides>();
  for (const s of slides) { const a = byCase.get(s.case_id) ?? []; a.push(s); byCase.set(s.case_id, a); }
  const entityName = new Map(subtree.filter((n) => n.level === 'entity').map((n) => [n.id, n]));

  return (
    <main className="cat-main">
      <Crumbs trail={trail.slice(0, -1)} />
      <h1 className="cat-h1">{node.name || 'General'}</h1>
      <p className="cat-lead">{fmt(node.n_cases)} cases · {fmt(node.n_slides)} slides{node.kind && node.kind !== 'mixed' ? ` · ${node.kind.replace('_', '-')}` : ''}</p>
      {subtree.length > 0 && <Tree root={node} all={subtree} />}
      {!listCases && node.level !== 'entity' && (
        <p className="cat-lead"><Link href={`/catalogue/${node.path}?all=1`} className="cat-link">List all {fmt(node.n_cases)} cases</Link></p>
      )}
      {listCases && (
        <section className="cat-cases">
          {node.level !== 'entity' && <h2 className="cat-h2">Cases <span className="ct">{fmt(total)}</span></h2>}
          <SourceChips base={base} sources={sources} active={source} />
          {cases.map((c) => {
            const e = entityName.get(c.entity_id);
            return <CaseRow key={c.id} c={c} slides={byCase.get(c.id)} showEntity={node.level !== 'entity'} entityName={e?.name} entityPath={e?.path} organName={organ?.name} />;
          })}
          <Pager base={base} total={total} page={page} source={source} />
        </section>
      )}
    </main>
  );
}
