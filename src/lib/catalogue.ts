// Read-only access to the classified slide catalogue (data-catalogue/site.sqlite, server-only data).
import { createClient, type Client, type InValue } from '@libsql/client';
import path from 'path';

let client: Client | null = null;
function db(): Client {
  if (!client) {
    const file = path.join(process.cwd(), 'data-catalogue', 'site.sqlite');
    client = createClient({ url: `file:${file}` });
  }
  return client;
}

export interface Node {
  id: number; parent_id: number | null; level: 'system' | 'organ' | 'group' | 'subgroup' | 'entity';
  name: string; slug: string; path: string; kind: string | null; sort: number; n_cases: number; n_slides: number;
}
export interface Case {
  id: number; entity_id: number; organ_id: number; system_id: number; source: string; source_name: string; source_label: string | null;
  title: string; qualifiers: string | null; diagnosis_raw: string | null; url: string; thumb: string | null; n_slides: number; n_he: number;
  stains: string; age: string | null; sex: string | null; specimen: string | null; category: string; tags: string; clinical: string | null;
  site_detail: string | null; terminology_note: string | null; confidence: number;
}
export interface Slide { id: number; case_id: number; label: string | null; stain: string | null; is_he: number; url: string; thumb: string | null }

async function rows<T>(sql: string, args: InValue[] = []): Promise<T[]> {
  const r = await db().execute({ sql, args });
  return r.rows as unknown as T[];
}

export const getNodeByPath = async (p: string) => (await rows<Node>('SELECT * FROM nodes WHERE path = ?', [p]))[0] ?? null;
export const getChildren = (id: number) => rows<Node>('SELECT * FROM nodes WHERE parent_id = ? ORDER BY sort, id', [id]);
export const getRoots = () => rows<Node>("SELECT * FROM nodes WHERE level = 'system' ORDER BY sort");
export const getAllOrgans = () => rows<Node>("SELECT * FROM nodes WHERE level = 'organ' ORDER BY sort");
export async function getAncestors(n: Node): Promise<Node[]> {
  const parts = n.path.split('/');
  const paths = parts.map((_, i) => parts.slice(0, i + 1).join('/'));
  const r = await rows<Node>(`SELECT * FROM nodes WHERE path IN (${paths.map(() => '?').join(',')})`, paths);
  return paths.map((p) => r.find((x) => x.path === p)!).filter(Boolean);
}
/** Every descendant node of `n` (used to render the tree of an organ or group in one query). */
export const getSubtree = (n: Node) => rows<Node>('SELECT * FROM nodes WHERE path LIKE ? ORDER BY sort, id', [n.path + '/%']);

const CASE_ORDER = 'ORDER BY c.n_he DESC, c.n_slides DESC, c.confidence DESC, c.id';
export const PAGE = 300;
export interface CaseQuery { source?: string; page?: number }
/** WHERE clause selecting the cases under a node (any level). */
function underSql(n: Node): { where: string; args: InValue[] } {
  if (n.level === 'system') return { where: 'c.system_id = ?', args: [n.id] };
  if (n.level === 'organ') return { where: 'c.organ_id = ?', args: [n.id] };
  if (n.level === 'entity') return { where: 'c.entity_id = ?', args: [n.id] };
  return { where: 'c.entity_id IN (SELECT id FROM nodes WHERE path LIKE ?)', args: [n.path + '/%'] };
}
export async function getCasesUnder(n: Node, q: CaseQuery = {}): Promise<{ cases: Case[]; total: number; sources: { source: string; source_name: string; n: number }[] }> {
  const u = underSql(n);
  const sources = await rows<{ source: string; source_name: string; n: number }>(`SELECT c.source, c.source_name, COUNT(*) AS n FROM cases c WHERE ${u.where} GROUP BY c.source ORDER BY n DESC`, u.args);
  const where = u.where + (q.source ? ' AND c.source = ?' : '');
  const args: InValue[] = q.source ? [...u.args, q.source] : u.args;
  const total = q.source ? (sources.find((s) => s.source === q.source)?.n ?? 0) : sources.reduce((a, s) => a + s.n, 0);
  const page = Math.max(1, q.page ?? 1);
  const cases = await rows<Case>(`SELECT c.* FROM cases c WHERE ${where} ${CASE_ORDER} LIMIT ? OFFSET ?`, [...args, PAGE, (page - 1) * PAGE]);
  return { cases, total, sources };
}
export const getSlidesForCases = (ids: number[]) => ids.length
  ? rows<Slide>(`SELECT * FROM slides WHERE case_id IN (${ids.map(() => '?').join(',')}) ORDER BY is_he DESC, id`, ids) : Promise.resolve([] as Slide[]);
export const getTags = () => rows<{ tag: string; tag_name: string; n: number }>('SELECT tag, tag_name, COUNT(*) AS n FROM case_tags GROUP BY tag ORDER BY n DESC');
export type TagCase = Case & { organ_name: string; organ_path: string; entity_name: string; entity_path: string };
export async function getCasesForTag(tag: string, q: CaseQuery = {}): Promise<{ cases: TagCase[]; total: number; sources: { source: string; source_name: string; n: number }[] }> {
  const sources = await rows<{ source: string; source_name: string; n: number }>('SELECT c.source, c.source_name, COUNT(*) AS n FROM cases c JOIN case_tags t ON t.case_id = c.id WHERE t.tag = ? GROUP BY c.source ORDER BY n DESC', [tag]);
  const total = q.source ? (sources.find((s) => s.source === q.source)?.n ?? 0) : sources.reduce((a, s) => a + s.n, 0);
  const page = Math.max(1, q.page ?? 1);
  const cases = await rows<TagCase>(
    `SELECT c.*, o.name AS organ_name, o.path AS organ_path, e.name AS entity_name, e.path AS entity_path FROM cases c
     JOIN case_tags t ON t.case_id = c.id JOIN nodes o ON o.id = c.organ_id JOIN nodes e ON e.id = c.entity_id
     WHERE t.tag = ?${q.source ? ' AND c.source = ?' : ''} ORDER BY o.sort, o.id, e.name, c.n_he DESC, c.id LIMIT ? OFFSET ?`,
    q.source ? [tag, q.source, PAGE, (page - 1) * PAGE] : [tag, PAGE, (page - 1) * PAGE]);
  return { cases, total, sources };
}
export const getSources = () => rows<{ source: string; name: string; n_cases: number; n_slides: number }>('SELECT * FROM sources ORDER BY n_cases DESC');
export const getTotals = async () => (await rows<{ c: number; s: number }>('SELECT COUNT(*) AS c, SUM(n_slides) AS s FROM cases'))[0];
