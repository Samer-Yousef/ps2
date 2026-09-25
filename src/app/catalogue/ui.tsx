import Link from 'next/link';
import type { Case, Node, Slide } from '@/lib/catalogue';
import { PAGE } from '@/lib/catalogue';

export const fmt = (n: number) => n.toLocaleString('en-GB');

export function Crumbs({ trail }: { trail: Node[] }) {
  return (
    <nav className="cat-crumbs" aria-label="Breadcrumb">
      <Link href="/catalogue">Catalogue</Link>
      {trail.map((n) => (
        <span key={n.id}><span className="sep">/</span><Link href={`/catalogue/${n.path}`}>{n.name}</Link></span>
      ))}
    </nav>
  );
}

export function NodeRow({ n }: { n: Node }) {
  return (
    <Link href={`/catalogue/${n.path}`} className={`cat-node lvl-${n.level}`}>
      <span className="nm">{n.name}</span>
      <span className="ct">{fmt(n.n_cases)}</span>
    </Link>
  );
}

function stainSummary(c: Case) {
  const stains: string[] = JSON.parse(c.stains || '[]');
  const parts: string[] = [];
  if (c.n_he) parts.push(c.n_he > 1 ? `${c.n_he} × H&E` : 'H&E');
  if (stains.length) parts.push(stains.length <= 3 ? stains.join(', ') : `${stains.length} stains`);
  return parts.join(' + ');
}

export function CaseRow({ c, slides, showEntity, entityName, entityPath, organName }: { c: Case; slides?: Slide[]; showEntity?: boolean; entityName?: string; entityPath?: string; organName?: string }) {
  const tags: string[] = JSON.parse(c.tags || '[]');
  const site = c.site_detail && organName && c.site_detail.toLowerCase() === organName.toLowerCase() ? null : c.site_detail;
  const meta = [c.age, c.sex === 'M' ? 'male' : c.sex === 'F' ? 'female' : null, c.specimen, site].filter(Boolean).join(' · ');
  // On an entity page every row shares the entity name, so lead with what distinguishes the case instead.
  const rawDiffers = c.diagnosis_raw && c.diagnosis_raw.toLowerCase() !== c.title.toLowerCase();
  const lead = showEntity ? c.title : (c.qualifiers || (rawDiffers ? c.diagnosis_raw : null) || c.source_label || c.title);
  const sub = showEntity ? c.qualifiers : (c.qualifiers && rawDiffers ? c.diagnosis_raw : null);
  const multi = c.n_slides > 1 && slides && slides.length > 1;
  const body = (
    <>
      <span className="cat-case-main">
        <a href={c.url} target="_blank" rel="noopener noreferrer" className="ttl">{lead}</a>
        {sub && <span className="q">{sub}</span>}
        {showEntity && entityPath && entityName && entityName.toLowerCase() !== c.title.toLowerCase() && <Link href={`/catalogue/${entityPath}`} className="ent">{entityName}</Link>}
      </span>
      <span className="cat-case-meta">
        {meta && <span className="m">{meta}</span>}
        <span className="st">{stainSummary(c) || `${c.n_slides} slide${c.n_slides > 1 ? 's' : ''}`}</span>
        <span className="src">{c.source_name}</span>
        {tags.filter((t) => !['haematolymphoid_neoplasm'].includes(t)).slice(0, 3).map((t) => <span key={t} className="tg">{t.replace(/_/g, ' ')}</span>)}
      </span>
    </>
  );
  if (!multi) return <div className="cat-case">{body}</div>;
  return (
    <details className="cat-case multi">
      <summary>{body}<span className="more">{c.n_slides} slides</span></summary>
      <ul className="cat-slides">
        {slides!.map((s) => (
          <li key={s.id}>
            <a href={s.url} target="_blank" rel="noopener noreferrer">{s.stain || s.label || 'slide'}</a>
            {s.label && s.stain && s.label !== s.stain && <span className="lb">{s.label}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Removable source filter chips (one click to select, one click on the active chip to clear). */
export function SourceChips({ base, sources, active }: { base: string; sources: { source: string; source_name: string; n: number }[]; active?: string }) {
  if (sources.length < 2 && !active) return null;
  return (
    <div className="cat-chips">
      {sources.map((s) => (
        <Link key={s.source} href={active === s.source ? base : `${base}?source=${s.source}`} className={`chip${active === s.source ? ' on' : ''}`}>
          {s.source_name} <span className="ct">{fmt(s.n)}</span>{active === s.source && <span className="x">×</span>}
        </Link>
      ))}
    </div>
  );
}

export function Pager({ base, total, page, source }: { base: string; total: number; page: number; source?: string }) {
  const pages = Math.ceil(total / PAGE);
  if (pages <= 1) return null;
  const href = (p: number) => `${base}?${source ? `source=${source}&` : ''}page=${p}`;
  return (
    <nav className="cat-pager">
      {page > 1 && <Link href={href(page - 1)}>← Previous</Link>}
      <span className="ct">Page {page} of {pages}</span>
      {page < pages && <Link href={href(page + 1)}>Next →</Link>}
    </nav>
  );
}
