// Data for /catv3 — one organ as a fully expanded zoomable tree; each leaf heading carries its cases as a list.
import { getOrganTree, rows, type TNode } from './catv2';

export interface ZCase { id: number; title: string; note?: string; url: string }
export interface ZNode {
  id: string; name: string; cases: number;
  kind: 'organ' | 'mode' | 'who' | 'topic' | 'volume' | 'rest';
  mode?: 'normal' | 'neo' | 'non';
  note?: string;   // muted suffix (WHO volume)
  children?: ZNode[];
  items?: ZCase[]; // the cases filed directly under this heading
}
interface CaseRow { id: number; title: string; qualifiers: string | null; url: string }

export async function getOrganZoom(organId: number): Promise<ZNode> {
  const [organ] = await rows<{ name: string; n_cases: number }>('SELECT name,n_cases FROM nodes WHERE id=?', [organId]);
  if (!organ) throw new Error('no organ');
  const [modes, who, topicCases] = await Promise.all([
    getOrganTree(organId),
    rows<CaseRow & { source_id: string }>(
      `SELECT wc.source_id, c.id, c.title, c.qualifiers, c.url FROM who_outline_cases wc JOIN cases c ON c.id=wc.case_id
       WHERE wc.organ_id=? ORDER BY c.n_he DESC, c.n_slides DESC, c.id`, [organId]),
    rows<CaseRow & { topic_id: number }>(
      `SELECT tc.topic_id, c.id, c.title, c.qualifiers, c.url FROM study_topic_cases tc JOIN cases c ON c.id=tc.case_id
       JOIN study_topics t ON t.id=tc.topic_id WHERE t.organ_id=? ORDER BY c.n_he DESC, c.n_slides DESC, c.id`, [organId]),
  ]);
  const bySrc = new Map<string, CaseRow[]>();
  for (const c of who) { const l = bySrc.get(c.source_id) ?? []; l.push(c); bySrc.set(c.source_id, l); }
  const byTopic = new Map<number, CaseRow[]>();
  for (const c of topicCases) { const l = byTopic.get(c.topic_id) ?? []; l.push(c); byTopic.set(c.topic_id, l); }

  const toCase = (c: CaseRow): ZCase => ({ id: c.id, title: c.title, url: c.url, note: c.qualifiers?.slice(0, 120) || undefined });
  const srcOf = (id: string) => /^w\d+:(.+?)(#rest)?$/.exec(id)?.[1];
  const descendantCaseIds = (n: TNode, acc: Set<number>) => { for (const k of n.children ?? []) { const s = srcOf(k.id); if (s) for (const c of bySrc.get(s) ?? []) acc.add(c.id); descendantCaseIds(k, acc); } };

  const convert = (n: TNode, parentWho: TNode | null): ZNode => {
    const z: ZNode = { id: n.id, name: n.name, cases: n.cases, kind: n.kind === 'system' ? 'organ' : (n.kind ?? 'who'), mode: n.mode, note: n.note };
    if (n.leaf) {
      let cs: CaseRow[] = [];
      if (/^t\d+$/.test(n.id)) cs = byTopic.get(Number(n.id.slice(1))) ?? [];
      else if (n.id.endsWith('#rest') && parentWho) { const ex = new Set<number>(); descendantCaseIds(parentWho, ex); cs = (bySrc.get(srcOf(n.id)!) ?? []).filter((c) => !ex.has(c.id)); }
      else { const s = srcOf(n.id); if (s) cs = bySrc.get(s) ?? []; }
      if (cs.length) z.items = cs.map(toCase);
    } else if (n.children) z.children = n.children.map((k) => convert(k, n));
    return z;
  };
  return { id: `o${organId}`, name: organ.name, cases: organ.n_cases, kind: 'organ', children: modes.map((m) => convert(m, null)) };
}
