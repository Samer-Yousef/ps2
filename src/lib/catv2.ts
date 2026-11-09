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
  // anatomical sub-views (Scalp, Duodenum, Parotid …) live inside their parent organ's page, not beside it
  const org = await rows<{ id: number; parent_id: number; name: string; n_cases: number }>(
    "SELECT id,parent_id,name,n_cases FROM nodes WHERE level='organ' AND id NOT IN (SELECT organ_id FROM anatomy_collections) ORDER BY sort,id");
  return sys.map((s) => ({
    id: `s${s.id}`, name: s.name, cases: s.n_cases, kind: 'system',
    children: org.filter((o) => o.parent_id === s.id).map((o) => ({ id: `o${o.id}`, name: o.name, cases: o.n_cases, kind: 'organ', lazy: true })),
  }));
}
/** Organs whose anatomical sub-views (classification-v5 anatomy collections) are worth a "By site" group in the tree.
 *  Reviewed 2026-11-01: every sub-view's cases are already in the parent's combined view and the WHO chapters already
 *  split by site where that matters (vulva/vagina, oral cavity/oropharynx, thymus, paratestis, nail unit …), so none
 *  are shown. Add an organ id here (e.g. 6504 Eye and orbit) to show its sub-views again. */
const SITE_GROUPS = new Set<number>([]);
/** Shown sub-views of an organ, in directory order. */
const subViews = (organId: number) => SITE_GROUPS.has(organId)
  ? rows<{ id: number; name: string; n_cases: number }>('SELECT n.id,n.name,n.n_cases FROM anatomy_collections a JOIN nodes n ON n.id=a.organ_id WHERE a.parent_organ_id=? ORDER BY n.sort,n.id', [organId])
  : Promise.resolve([]);
/** SQL fragment: organ views that are not in the tree (sub-views of organs outside SITE_GROUPS). */
const HIDDEN_ORGANS = `(SELECT organ_id FROM anatomy_collections WHERE parent_organ_id NOT IN (${[...SITE_GROUPS, -1].join(',')}))`;
/** Tree ids from the system down to an organ: sub-views sit under their parent's "By site" group. */
export async function organChain(organId: number): Promise<{ chain: string[]; crumbs: string[] }> {
  const o = (await rows<{ id: number; parent_id: number; name: string; parent_organ: number | null }>(
    'SELECT n.id,n.parent_id,n.name,a.parent_organ_id AS parent_organ FROM nodes n LEFT JOIN anatomy_collections a ON a.organ_id=n.id WHERE n.id=?', [organId]))[0];
  if (!o) return { chain: [], crumbs: [] };
  const sys = (await rows<{ name: string }>('SELECT name FROM nodes WHERE id=?', [o.parent_id]))[0]?.name ?? '';
  if (o.parent_organ === null) return { chain: [`s${o.parent_id}`, `o${o.id}`], crumbs: [sys] };
  const p = (await rows<{ name: string }>('SELECT name FROM nodes WHERE id=?', [o.parent_organ]))[0]?.name ?? '';
  return { chain: [`s${o.parent_id}`, `o${o.parent_organ}`, `p${o.parent_organ}`, `o${o.id}`], crumbs: [sys, p, 'By site'] };
}

interface WhoRow { source_id: string; parent_source_id: string | null; name: string; source_volume: string; sort: number; n_cases: number }

/** Chapter roots sorted ≥ HOME_SORT were mounted from another WHO volume because WHO files an entity that also
 *  occurs here only there (classification-v8 policy); roots below it are the volume that covers this site. */
const HOME_SORT = 100000;
/** Chapter groups of one organ: `primary` is the home volume (label only), `others` the volumes of mounted
 *  chapters, sorted. A view with no home chapter (Multiple or unspecified sites) shows everything as home. */
export async function organVolumes(organId: number): Promise<{ primary: string; others: string[]; home: Set<string> }> {
  const roots = await rows<{ source_id: string; v: string; sort: number }>(
    'SELECT source_id, source_volume AS v, sort FROM who_outline_nodes WHERE organ_id=? AND parent_source_id IS NULL ORDER BY sort', [organId]);
  const homeRoots = roots.some((r) => r.sort < HOME_SORT) ? roots.filter((r) => r.sort < HOME_SORT) : roots;
  const home = new Set(homeRoots.map((r) => r.source_id));
  const n = new Map<string, number>(); for (const r of homeRoots) n.set(r.v, (n.get(r.v) ?? 0) + 1);
  const primary = [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '';
  const others = [...new Set(roots.filter((r) => !home.has(r.source_id)).map((r) => r.v))].sort();
  return { primary, others, home };
}
interface TopicRow { id: number; kind: string; title: string; n_cases: number; sort: number }

/** The three study modes of one organ, fully expanded (WHO headings with 0 cases included under the organ's home chapters). */
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
  const { primary, others, home } = await organVolumes(organId);
  const neoKids: TNode[] = roots.filter((r) => home.has(r.source_id)).map((r) => {
    const k = build(r, false)!;
    if (r.source_volume !== primary) k.note = volShort(r.source_volume);
    return k;
  });
  const topic = (t: TopicRow): TNode => ({ id: `t${t.id}`, name: t.title, cases: t.n_cases, kind: 'topic', leaf: true });
  // catalogue topics under Neoplastic: metastases at sites where WHO has no metastasis heading (lymph node, soft tissue …)
  for (const t of topics.filter((t) => t.kind === 'neoplastic')) neoKids.push({ ...topic(t), note: 'not a WHO heading' });
  const otherNodes: TNode[] = [];
  others.forEach((v, i) => {
    const ch = roots.filter((r) => !home.has(r.source_id) && r.source_volume === v).map((r) => build(r, true)).filter((k): k is TNode => !!k);
    if (ch.length) otherNodes.push({ id: `v${organId}:${i}`, name: volShort(v), cases: ch.reduce((a, k) => a + k.cases, 0), kind: 'volume', children: ch });
  });
  if (otherNodes.length) neoKids.push({ id: `x${organId}`, name: 'Also classified under other WHO chapters', cases: otherNodes.reduce((a, k) => a + k.cases, 0), kind: 'volume', children: otherNodes });
  const normal = topics.filter((t) => t.kind === 'normal').map(topic);
  const non = topics.filter((t) => t.kind === 'non_neoplastic').map(topic);
  const sum = (l: TNode[]) => l.reduce((a, k) => a + k.cases, 0);
  const modes: TNode[] = [];
  modes.push({ id: `o${organId}:normal`, name: 'Normal histology', cases: sum(normal), kind: 'mode', mode: 'normal', children: normal });
  modes.push({ id: `o${organId}:neo`, name: 'Neoplastic', note: primary ? volShort(primary) : undefined, cases: sum(neoKids), kind: 'mode', mode: 'neo', children: neoKids });
  modes.push({ id: `o${organId}:non`, name: 'Non-neoplastic', cases: sum(non), kind: 'mode', mode: 'non', children: non });
  const subs = await subViews(organId);
  if (subs.length) modes.push({ id: `p${organId}`, name: 'By site', cases: subs.reduce((a, k) => a + k.n_cases, 0), kind: 'volume', children: subs.map((o) => ({ id: `o${o.id}`, name: o.name, cases: o.n_cases, kind: 'organ', lazy: true })) });
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
export const NODE_ID_RE = /^(s\d+|o\d+(:(neo|non|normal))?|p\d+|x\d+|v\d+:\d+|t\d+|w\d+:[\w:.-]+(#rest)?)$/;

/** Cases under any tree node id: system, organ, mode, volume group, WHO heading (with all its descendants), topic. */
export async function getCasesFor(nodeId: string, page = 1): Promise<{ cases: TCase[]; total: number } | null> {
  let where = ''; let args: InValue[] = []; let m: RegExpExecArray | null;
  // cases rolled up to chapter roots of the given group (home or mounted), optionally one mounted volume
  const inRoots = (organ: number, homeGroup: boolean, vol?: string) => {
    const homeSql = `(SELECT source_id FROM who_outline_nodes WHERE organ_id=? AND parent_source_id IS NULL AND sort<${HOME_SORT})`;
    const group = homeGroup ? `(source_id IN ${homeSql} OR NOT EXISTS ${homeSql})` : `source_id NOT IN ${homeSql}`;
    where = `c.id IN (SELECT case_id FROM who_outline_cases WHERE organ_id=? AND source_id IN (SELECT source_id FROM who_outline_nodes WHERE organ_id=? AND parent_source_id IS NULL AND ${group}${vol !== undefined ? ' AND source_volume=?' : ''}))`;
    args = [organ, organ, organ, ...(homeGroup ? [organ] : []), ...(vol !== undefined ? [vol] : [])];
    if (homeGroup) { where = `(${where} OR c.id IN (SELECT tc.case_id FROM study_topic_cases tc JOIN study_topics t ON t.id=tc.topic_id WHERE t.organ_id=? AND t.kind='neoplastic'))`; args.push(organ); }
  };
  if ((m = /^s(\d+)$/.exec(nodeId))) { where = 'c.system_id=?'; args = [Number(m[1])]; }
  else if ((m = /^[op](\d+)$/.exec(nodeId))) {
    // sub-organs (Scalp, Nail unit …) own no case rows directly: their cases are filed via the WHO outline and study topics
    const o = Number(m[1]);
    where = '(c.organ_id=? OR c.id IN (SELECT case_id FROM who_outline_cases WHERE organ_id=?) OR c.id IN (SELECT tc.case_id FROM study_topic_cases tc JOIN study_topics t ON t.id=tc.topic_id WHERE t.organ_id=?))';
    args = [o, o, o];
  }
  else if ((m = /^o(\d+):(normal|non)$/.exec(nodeId))) {
    where = 'c.id IN (SELECT tc.case_id FROM study_topic_cases tc JOIN study_topics t ON t.id=tc.topic_id WHERE t.organ_id=? AND t.kind=?)';
    args = [Number(m[1]), m[2] === 'normal' ? 'normal' : 'non_neoplastic'];
  }
  else if ((m = /^o(\d+):neo$/.exec(nodeId))) inRoots(Number(m[1]), true);
  else if ((m = /^x(\d+)$/.exec(nodeId))) inRoots(Number(m[1]), false);
  else if ((m = /^v(\d+):(\d+)$/.exec(nodeId))) { const o = Number(m[1]); const v = (await organVolumes(o)).others[Number(m[2])]; if (v === undefined) return null; inRoots(o, false, v); }
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
  const organs = await rows<{ id: number; parent_id: number; name: string; n_cases: number }>(`SELECT id,parent_id,name,n_cases FROM nodes WHERE level='organ' AND id NOT IN ${HIDDEN_ORGANS}`);
  const organById = new Map(organs.map((o) => [o.id, o]));
  const hits: Hit[] = [];
  const chainCache = new Map<number, Promise<{ chain: string[]; crumbs: string[] }>>();
  const chainOf = (organ: number) => { let p = chainCache.get(organ); if (!p) { p = organChain(organ); chainCache.set(organ, p); } return p; };
  for (const o of organs.filter((o) => o.name.toLowerCase().includes(q.toLowerCase())).slice(0, 5)) {
    const c = await chainOf(o.id);
    hits.push({ id: `o${o.id}`, name: o.name, cases: o.n_cases, chain: c.chain, crumbs: c.crumbs });
  }
  // headings that file cases first; empty headings only when nothing else matches (they are the WHO syllabus, still worth jumping to)
  const who = await rows<{ organ_id: number; source_id: string; name: string; n_cases: number }>(
    `SELECT organ_id,source_id,name,n_cases FROM who_outline_nodes WHERE name LIKE ? AND organ_id NOT IN ${HIDDEN_ORGANS} ORDER BY n_cases DESC, name LIMIT 25`, [like]);
  let filled = who.filter((w) => w.n_cases > 0);
  // no populated heading carries the word (e.g. "Wilms" vs WHO's "Nephroblastoma"): find the headings whose cases do
  if (!filled.length) filled = await rows<{ organ_id: number; source_id: string; name: string; n_cases: number }>(
    `SELECT w.organ_id,w.source_id,w.name,w.n_cases FROM who_outline_links l JOIN cases c ON c.id=l.case_id
       JOIN who_outline_nodes w ON w.organ_id=l.organ_id AND w.source_id=l.source_id
     WHERE c.title LIKE ? AND w.organ_id NOT IN ${HIDDEN_ORGANS} GROUP BY w.organ_id,w.source_id ORDER BY COUNT(*) DESC, w.n_cases DESC LIMIT 10`, [like]);
  const volCache = new Map<number, Promise<{ primary: string; others: string[]; home: Set<string> }>>();
  const volsOf = (organ: number) => { let p = volCache.get(organ); if (!p) { p = organVolumes(organ); volCache.set(organ, p); } return p; };
  for (const w of filled.length ? filled : who.slice(0, 5)) {
    const up = await rows<{ source_id: string; name: string; source_volume: string; depth: number }>(
      `WITH RECURSIVE up(source_id,parent_source_id,name,source_volume,depth) AS (
         SELECT source_id,parent_source_id,name,source_volume,0 FROM who_outline_nodes WHERE organ_id=? AND source_id=?
         UNION ALL SELECT w.source_id,w.parent_source_id,w.name,w.source_volume,up.depth+1 FROM who_outline_nodes w JOIN up ON w.organ_id=? AND w.source_id=up.parent_source_id)
       SELECT source_id,name,source_volume,depth FROM up ORDER BY depth DESC`, [w.organ_id, w.source_id, w.organ_id]);
    const o = organById.get(w.organ_id); if (!o || !up.length) continue;
    const base = await chainOf(o.id);
    const chain = [...base.chain, `o${o.id}:neo`];
    const crumbs = [...base.crumbs.slice(1), o.name, 'Neoplastic'];
    const vol = up[0].source_volume;
    const vols = await volsOf(w.organ_id);
    if (!vols.home.has(up[0].source_id)) { chain.push(`x${o.id}`, `v${o.id}:${vols.others.indexOf(vol)}`); crumbs.push(volShort(vol)); }
    for (const u of up) { chain.push(`w${o.id}:${u.source_id}`); if (u.depth > 0) crumbs.push(u.name); }
    hits.push({ id: chain[chain.length - 1], name: w.name, cases: w.n_cases, chain, crumbs });
  }
  const topics = await rows<{ id: number; organ_id: number; kind: string; title: string; n_cases: number }>(
    `SELECT id,organ_id,kind,title,n_cases FROM study_topics WHERE title LIKE ? AND organ_id NOT IN ${HIDDEN_ORGANS} ORDER BY n_cases DESC LIMIT 10`, [like]);
  const MODE = { normal: ['normal', 'Normal histology'], neoplastic: ['neo', 'Neoplastic'], non_neoplastic: ['non', 'Non-neoplastic'] } as const;
  for (const t of topics) {
    const o = organById.get(t.organ_id); const md = MODE[t.kind as keyof typeof MODE]; if (!o || !md) continue;
    const base = await chainOf(o.id);
    hits.push({ id: `t${t.id}`, name: t.title, cases: t.n_cases, chain: [...base.chain, `o${o.id}:${md[0]}`, `t${t.id}`], crumbs: [...base.crumbs.slice(1), o.name, md[1]] });
  }
  return hits;
}
