// Data layer for /catv2 — the zoomable catalogue tree.
// Reads data-catalogue/site.sqlite (server-only). Node ids are strings the client understands:
//   s<id>            system            o<id>             organ
//   o<id>:normal     study mode        o<id>:neo | o<id>:non
//   w<organ>:<src>   WHO heading       w<organ>:<src>#rest   cases filed at a family but not at any child
//   t<id>            study topic       x<organ>          "other WHO volumes"   v<organ>:<n>  one such volume
import { createClient, type Client, type InValue } from '@libsql/client';
import path from 'path';

let client: Client | null = null;
function db(): Client {
  if (!client) client = createClient({ url: `file:${path.join(process.cwd(), 'data-catalogue', 'site.sqlite')}` });
  return client;
}
export async function rows<T>(sql: string, args: InValue[] = []): Promise<T[]> {
  return (await db().execute({ sql, args })).rows as unknown as T[];
}

export interface TNode {
  id: string;
  name: string;
  cases: number;        // cases under this node (0 allowed: WHO heading without slides)
  kind?: 'system' | 'organ' | 'mode' | 'who' | 'topic' | 'volume' | 'rest';
  mode?: 'normal' | 'neo' | 'non';
  note?: string;        // small muted suffix, e.g. WHO volume
  leaf?: boolean;       // true = expanding lists cases instead of children
  lazy?: boolean;       // true = children fetched from /api/catv2/organ/<id>
  children?: TNode[];
}

const RE_VOL = /\s*\((\d+)(?:st|nd|rd|th) ed\.\)\s*$/;
const volShort = (v: string) => v.replace(/\s+/g, ' ').replace(RE_VOL, ' $1e').trim();

/** Systems → organs. Organs are lazy: their subtree comes from getOrganTree(). */
export async function getRootTree(): Promise<TNode[]> {
  const sys = await rows<{ id: number; name: string; n_cases: number }>("SELECT id,name,n_cases FROM nodes WHERE level='system' ORDER BY sort");
  const org = await rows<{ id: number; parent_id: number; name: string; n_cases: number }>("SELECT id,parent_id,name,n_cases FROM nodes WHERE level='organ' ORDER BY sort,id");
  return sys.map((s) => ({
    id: `s${s.id}`, name: s.name, cases: s.n_cases, kind: 'system',
    children: org.filter((o) => o.parent_id === s.id).map((o) => ({ id: `o${o.id}`, name: o.name, cases: o.n_cases, kind: 'organ', lazy: true })),
  }));
}

interface WhoRow { source_id: string; parent_source_id: string | null; name: string; source_volume: string; sort: number; n_cases: number }

/** Volumes of one organ: the primary (whose top-level chapters hold the most cases; ties by heading count) and the others, sorted. */
export async function organVolumes(organId: number): Promise<{ primary: string; others: string[] }> {
  const vs = await rows<{ v: string; n: number; c: number }>(
    'SELECT source_volume AS v, COUNT(*) AS n, SUM(CASE WHEN parent_source_id IS NULL THEN n_cases ELSE 0 END) AS c FROM who_outline_nodes WHERE organ_id=? GROUP BY v', [organId]);
  const primary = [...vs].sort((a, b) => b.c - a.c || b.n - a.n)[0]?.v ?? '';
  return { primary, others: vs.map((x) => x.v).filter((v) => v !== primary).sort() };
}
interface TopicRow { id: number; kind: string; title: string; n_cases: number; sort: number }

/** The three study modes of one organ, fully expanded (WHO headings with 0 cases included under the organ's own volume). */
export async function getOrganTree(organId: number): Promise<TNode[]> {
  const [who, topics] = await Promise.all([
    rows<WhoRow>('SELECT source_id,parent_source_id,name,source_volume,sort,n_cases FROM who_outline_nodes WHERE organ_id=? ORDER BY sort', [organId]),
    rows<TopicRow>('SELECT id,kind,title,n_cases,sort FROM study_topics WHERE organ_id=? ORDER BY sort,title', [organId]),
  ]);
  const byParent = new Map<string | null, WhoRow[]>();
  for (const w of who) { const l = byParent.get(w.parent_source_id) ?? []; l.push(w); byParent.set(w.parent_source_id, l); }
  const build = (w: WhoRow, pruneEmpty: boolean): TNode | null => {
    const kids = (byParent.get(w.source_id) ?? []).map((k) => build(k, pruneEmpty)).filter((k): k is TNode => !!k);
    if (pruneEmpty && !w.n_cases && !kids.length) return null;
    const node: TNode = { id: `w${organId}:${w.source_id}`, name: w.name, cases: w.n_cases, kind: 'who' };
    if (kids.length) {
      const rest = w.n_cases - kids.reduce((a, k) => a + k.cases, 0);
      if (rest > 0) kids.push({ id: `w${organId}:${w.source_id}#rest`, name: `Other ${w.name.toLowerCase()}`, cases: rest, kind: 'rest', leaf: true });
      node.children = kids;
    } else node.leaf = true;
    return node;
  };
  const roots = byParent.get(null) ?? [];
  const { primary, others } = await organVolumes(organId);
  const neoKids: TNode[] = roots.filter((r) => r.source_volume === primary).map((r) => build(r, false)).filter((k): k is TNode => !!k);
  const otherNodes: TNode[] = [];
  others.forEach((v, i) => {
    const ch = roots.filter((r) => r.source_volume === v).map((r) => build(r, true)).filter((k): k is TNode => !!k);
    if (ch.length) otherNodes.push({ id: `v${organId}:${i}`, name: volShort(v), cases: ch.reduce((a, k) => a + k.cases, 0), kind: 'volume', children: ch });
  });
  if (otherNodes.length) neoKids.push({ id: `x${organId}`, name: 'Also classified in other WHO volumes', cases: otherNodes.reduce((a, k) => a + k.cases, 0), kind: 'volume', children: otherNodes });
  const topic = (t: TopicRow): TNode => ({ id: `t${t.id}`, name: t.title, cases: t.n_cases, kind: 'topic', leaf: true });
  const normal = topics.filter((t) => t.kind === 'normal').map(topic);
  const non = topics.filter((t) => t.kind === 'non_neoplastic').map(topic);
  const sum = (l: TNode[]) => l.reduce((a, k) => a + k.cases, 0);
  const modes: TNode[] = [];
  modes.push({ id: `o${organId}:normal`, name: 'Normal histology', cases: sum(normal), kind: 'mode', mode: 'normal', children: normal });
  modes.push({ id: `o${organId}:neo`, name: 'Neoplastic', note: primary ? volShort(primary) : undefined, cases: sum(neoKids), kind: 'mode', mode: 'neo', children: neoKids });
  modes.push({ id: `o${organId}:non`, name: 'Non-neoplastic', cases: sum(non), kind: 'mode', mode: 'non', children: non });
  return modes;
}

export interface TCase {
  id: number; title: string; qualifiers: string | null; source: string; url: string;
  n_slides: number; n_he: number; age: string | null; sex: string | null; site: string | null; stains: string;
  slides?: { label: string | null; stain: string | null; he: number; url: string }[];
}
export const CASE_PAGE = 60;
const CASE_COLS = 'c.id,c.title,c.qualifiers,c.source_name AS source,c.url,c.n_slides,c.n_he,c.age,c.sex,c.site_detail AS site,c.stains';
const CASE_ORDER = 'ORDER BY c.n_he DESC, c.n_slides DESC, c.id';
export const NODE_ID_RE = /^(s\d+|o\d+(:(neo|non|normal))?|x\d+|v\d+:\d+|t\d+|w\d+:[\w:.-]+(#rest)?)$/;

/** Cases under any tree node id: system, organ, mode, volume group, WHO heading (with all its descendants), topic. */
export async function getCasesFor(nodeId: string, page = 1): Promise<{ cases: TCase[]; total: number } | null> {
  let where = ''; let args: InValue[] = []; let m: RegExpExecArray | null;
  const inVolumes = (organ: number, vols: string[]) => {
    where = `c.id IN (SELECT case_id FROM who_outline_cases WHERE organ_id=? AND source_id IN (SELECT source_id FROM who_outline_nodes WHERE organ_id=? AND source_volume IN (${vols.map(() => '?').join(',') || "''"})))`;
    args = [organ, organ, ...vols];
  };
  if ((m = /^s(\d+)$/.exec(nodeId))) { where = 'c.system_id=?'; args = [Number(m[1])]; }
  else if ((m = /^o(\d+)$/.exec(nodeId))) {
    // sub-organs (Scalp, Nail unit …) own no case rows directly: their cases are filed via the WHO outline and study topics
    const o = Number(m[1]);
    where = '(c.organ_id=? OR c.id IN (SELECT case_id FROM who_outline_cases WHERE organ_id=?) OR c.id IN (SELECT tc.case_id FROM study_topic_cases tc JOIN study_topics t ON t.id=tc.topic_id WHERE t.organ_id=?))';
    args = [o, o, o];
  }
  else if ((m = /^o(\d+):(normal|non)$/.exec(nodeId))) {
    where = 'c.id IN (SELECT tc.case_id FROM study_topic_cases tc JOIN study_topics t ON t.id=tc.topic_id WHERE t.organ_id=? AND t.kind=?)';
    args = [Number(m[1]), m[2] === 'normal' ? 'normal' : 'non_neoplastic'];
  }
  else if ((m = /^o(\d+):neo$/.exec(nodeId))) { const o = Number(m[1]); inVolumes(o, [(await organVolumes(o)).primary]); }
  else if ((m = /^x(\d+)$/.exec(nodeId))) { const o = Number(m[1]); inVolumes(o, (await organVolumes(o)).others); }
  else if ((m = /^v(\d+):(\d+)$/.exec(nodeId))) { const o = Number(m[1]); const v = (await organVolumes(o)).others[Number(m[2])]; if (!v) return null; inVolumes(o, [v]); }
  else if ((m = /^t(\d+)$/.exec(nodeId))) { where = 'c.id IN (SELECT case_id FROM study_topic_cases WHERE topic_id=?)'; args = [Number(m[1])]; }
  else if ((m = /^w(\d+):(.+?)(#rest)?$/.exec(nodeId))) {
    const organ = Number(m[1]); const src = m[2];
    const desc = `WITH RECURSIVE d(source_id) AS (SELECT source_id FROM who_outline_nodes WHERE organ_id=? AND parent_source_id=?
        UNION ALL SELECT w.source_id FROM who_outline_nodes w JOIN d ON w.parent_source_id=d.source_id WHERE w.organ_id=?)
        SELECT case_id FROM who_outline_cases WHERE organ_id=? AND source_id IN (SELECT source_id FROM d)`;
    where = 'c.id IN (SELECT case_id FROM who_outline_cases WHERE organ_id=? AND source_id=?)'; args = [organ, src];
    if (m[3]) where += ` AND c.id NOT IN (${desc})`; else where = `(${where} OR c.id IN (${desc}))`;
    args.push(organ, src, organ, organ);
  }
  else return null;
  const [cnt, cases] = await Promise.all([
    rows<{ n: number }>(`SELECT COUNT(*) AS n FROM cases c WHERE ${where}`, args),
    rows<TCase>(`SELECT ${CASE_COLS} FROM cases c WHERE ${where} ${CASE_ORDER} LIMIT ? OFFSET ?`, [...args, CASE_PAGE, (page - 1) * CASE_PAGE]),
  ]);
  const multi = cases.filter((c) => c.n_slides > 1).map((c) => c.id);
  if (multi.length) {
    const sl = await rows<{ case_id: number; label: string | null; stain: string | null; is_he: number; url: string }>(
      `SELECT case_id,label,stain,is_he,url FROM slides WHERE case_id IN (${multi.map(() => '?').join(',')}) ORDER BY is_he DESC,id`, multi);
    const by = new Map<number, TCase['slides']>();
    for (const s of sl) { const l = by.get(s.case_id) ?? []; l!.push({ label: s.label, stain: s.stain, he: s.is_he, url: s.url }); by.set(s.case_id, l); }
    for (const c of cases) c.slides = by.get(c.id) ?? [];
  }
  return { cases, total: cnt[0]?.n ?? 0 };
}

export interface Hit { id: string; name: string; cases: number; chain: string[]; crumbs: string[] }

/** Type-to-jump: organs, WHO headings and topics whose name contains q. `chain` is the list of node ids to expand, root first. */
export async function searchTree(q: string): Promise<Hit[]> {
  const like = `%${q.replace(/[%_]/g, ' ').trim()}%`;
  const organs = await rows<{ id: number; parent_id: number; name: string; n_cases: number }>("SELECT id,parent_id,name,n_cases FROM nodes WHERE level='organ'");
  const systems = await rows<{ id: number; name: string }>("SELECT id,name FROM nodes WHERE level='system'");
  const sysName = new Map(systems.map((s) => [s.id, s.name]));
  const organById = new Map(organs.map((o) => [o.id, o]));
  const hits: Hit[] = [];
  for (const o of organs.filter((o) => o.name.toLowerCase().includes(q.toLowerCase())).slice(0, 5))
    hits.push({ id: `o${o.id}`, name: o.name, cases: o.n_cases, chain: [`s${o.parent_id}`, `o${o.id}`], crumbs: [sysName.get(o.parent_id) ?? ''] });
  const who = await rows<{ organ_id: number; source_id: string; name: string; n_cases: number }>(
    'SELECT organ_id,source_id,name,n_cases FROM who_outline_nodes WHERE name LIKE ? ORDER BY n_cases DESC, name LIMIT 25', [like]);
  const volCache = new Map<number, Promise<{ primary: string; others: string[] }>>();
  const volsOf = (organ: number) => { let p = volCache.get(organ); if (!p) { p = organVolumes(organ); volCache.set(organ, p); } return p; };
  for (const w of who) {
    const up = await rows<{ source_id: string; name: string; source_volume: string; depth: number }>(
      `WITH RECURSIVE up(source_id,parent_source_id,name,source_volume,depth) AS (
         SELECT source_id,parent_source_id,name,source_volume,0 FROM who_outline_nodes WHERE organ_id=? AND source_id=?
         UNION ALL SELECT w.source_id,w.parent_source_id,w.name,w.source_volume,up.depth+1 FROM who_outline_nodes w JOIN up ON w.organ_id=? AND w.source_id=up.parent_source_id)
       SELECT source_id,name,source_volume,depth FROM up ORDER BY depth DESC`, [w.organ_id, w.source_id, w.organ_id]);
    const o = organById.get(w.organ_id); if (!o || !up.length) continue;
    const chain = [`s${o.parent_id}`, `o${o.id}`, `o${o.id}:neo`];
    const crumbs = [o.name, 'Neoplastic'];
    const vol = up[0].source_volume;
    const vols = await volsOf(w.organ_id);
    if (vol !== vols.primary) { chain.push(`x${o.id}`, `v${o.id}:${vols.others.indexOf(vol)}`); crumbs.push(volShort(vol)); }
    for (const u of up) { chain.push(`w${o.id}:${u.source_id}`); if (u.depth > 0) crumbs.push(u.name); }
    hits.push({ id: chain[chain.length - 1], name: w.name, cases: w.n_cases, chain, crumbs });
  }
  const topics = await rows<{ id: number; organ_id: number; kind: string; title: string; n_cases: number }>(
    'SELECT id,organ_id,kind,title,n_cases FROM study_topics WHERE title LIKE ? ORDER BY n_cases DESC LIMIT 10', [like]);
  for (const t of topics) {
    const o = organById.get(t.organ_id); if (!o) continue;
    const mode = t.kind === 'normal' ? 'normal' : 'non';
    hits.push({ id: `t${t.id}`, name: t.title, cases: t.n_cases, chain: [`s${o.parent_id}`, `o${o.id}`, `o${o.id}:${mode}`, `t${t.id}`], crumbs: [o.name, mode === 'normal' ? 'Normal histology' : 'Non-neoplastic'] });
  }
  return hits;
}
