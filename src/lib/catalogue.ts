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
  original_node_id?: number; collection_id?: number;
  id: number; parent_id: number | null; level: 'system' | 'organ' | 'group' | 'subgroup' | 'entity';
  name: string; slug: string; path: string; kind: string | null; sort: number; n_cases: number; n_slides: number;
  authority: string | null; source_id: string | null; source_url: string | null; source_volume: string | null;
}
export interface Case {
  clean_label?: string; diagnosis_status?: string; diagnostic_tags?: string;
  further_information?: string; source_wording?: string; diagnosis_note?: string;
  id: number; entity_id: number; organ_id: number; system_id: number; source: string; source_name: string; source_label: string | null;
  title: string; qualifiers: string | null; diagnosis_raw: string | null; url: string; thumb: string | null; n_slides: number; n_he: number;
  stains: string; age: string | null; sex: string | null; specimen: string | null; category: string; tags: string; clinical: string | null;
  site_detail: string | null; terminology_note: string | null; confidence: number;
  classification_relation?: string; classification_reason?: string;
}
export interface Slide { id: number; case_id: number; label: string | null; stain: string | null; is_he: number; url: string; thumb: string | null }

async function rows<T>(sql: string, args: InValue[] = []): Promise<T[]> {
  const r = await db().execute({ sql, args });
  return r.rows as unknown as T[];
}

export const getNodeByPath = async (p: string) => (await rows<Node>('SELECT n.*, a.original_node_id, a.collection_id FROM nodes n LEFT JOIN anatomy_node_map a ON a.node_id=n.id WHERE n.path = ?', [p]))[0] ?? null;
export const getRedirectByPath = async (p: string) => (await rows<{ new_path: string }>('SELECT new_path FROM node_redirects WHERE old_path = ?', [p]))[0]?.new_path ?? null;
export const getChildren = (id: number) => rows<Node>('SELECT * FROM nodes WHERE parent_id = ? ORDER BY sort, id', [id]);
export const getRoots = () => rows<Node>("SELECT * FROM nodes WHERE level = 'system' ORDER BY sort");
export const getAllOrgans = () => rows<Node>("SELECT * FROM nodes WHERE level = 'organ' ORDER BY sort");
export const getStudyGroups = (kind: string) => rows<Node & { organ_name: string }>(`SELECT n.*, o.name AS organ_name FROM nodes n JOIN nodes o ON o.id=n.parent_id WHERE o.level='organ' AND n.kind=? AND NOT EXISTS(SELECT 1 FROM anatomy_collections a WHERE a.parent_organ_id=o.id AND a.directory=1) AND NOT EXISTS(SELECT 1 FROM anatomy_collections a WHERE a.organ_id=o.id AND a.directory=0) ORDER BY o.name`, [kind]);
export async function getAncestors(n: Node): Promise<Node[]> {
  const parts = n.path.split('/');
  const paths = parts.map((_, i) => parts.slice(0, i + 1).join('/'));
  const r = await rows<Node>(`SELECT * FROM nodes WHERE path IN (${paths.map(() => '?').join(',')})`, paths);
  return paths.map((p) => r.find((x) => x.path === p)!).filter(Boolean);
}
/** Every descendant node of `n` (used to render the tree of an organ or group in one query). */
export const getSubtree = (n: Node) => rows<Node>('SELECT n.*, a.original_node_id, a.collection_id FROM nodes n LEFT JOIN anatomy_node_map a ON a.node_id=n.id WHERE n.path LIKE ? ORDER BY n.sort,n.id', [n.path + '/%']);

const LABEL_COLUMNS = 'l.clean_label, l.diagnosis_status, l.diagnostic_tags, l.further_information, l.source_wording, l.diagnosis_note';
const CASE_ORDER = 'ORDER BY c.n_he DESC, c.n_slides DESC, c.confidence DESC, c.id';
export const PAGE = 300;
export interface CaseQuery { source?: string; page?: number }
/** WHERE clause selecting the cases under a node (any level). */
function underSql(n: Node): { where: string; args: InValue[] } {
  if (n.collection_id) {
    const scope='c.id IN (SELECT case_id FROM anatomy_members WHERE collection_id=?)';
    if(n.level==='organ') return {where:scope,args:[n.collection_id]};
    return {where:scope+' AND c.entity_id IN (SELECT a.original_node_id FROM anatomy_node_map a JOIN nodes x ON x.id=a.node_id WHERE x.id=? OR x.path LIKE ?)',args:[n.collection_id,n.id,n.path+'/%']};
  }
  if (n.level === 'system') return { where: 'c.system_id = ?', args: [n.id] };
  if (n.level === 'organ') return { where: 'c.organ_id = ?', args: [n.id] };
  if (n.level === 'entity') return { where: 'c.entity_id = ?', args: [n.id] };
  return { where: 'c.entity_id IN (SELECT id FROM nodes WHERE id = ? OR path LIKE ?)', args: [n.id, n.path + '/%'] };
}
export async function getCasesUnder(n: Node, q: CaseQuery = {}): Promise<{ cases: Case[]; total: number; sources: { source: string; source_name: string; n: number }[] }> {
  const u = underSql(n);
  const sources = await rows<{ source: string; source_name: string; n: number }>(`SELECT c.source, c.source_name, COUNT(*) AS n FROM cases c WHERE ${u.where} GROUP BY c.source ORDER BY n DESC`, u.args);
  const where = u.where + (q.source ? ' AND c.source = ?' : '');
  const args: InValue[] = q.source ? [...u.args, q.source] : u.args;
  const total = q.source ? (sources.find((s) => s.source === q.source)?.n ?? 0) : sources.reduce((a, s) => a + s.n, 0);
  const page = Math.max(1, q.page ?? 1);
  const cases = await rows<Case>(`SELECT c.*, ${LABEL_COLUMNS}, m.relation AS classification_relation, m.reason AS classification_reason FROM cases c LEFT JOIN case_labels l ON l.case_id=c.id LEFT JOIN classification_map m ON m.case_id=c.id WHERE ${where} ${CASE_ORDER} LIMIT ? OFFSET ?`, [...args, PAGE, (page - 1) * PAGE]);
  return { cases, total, sources };
}
export const getSlidesForCases = (ids: number[]) => ids.length
  ? rows<Slide>(`SELECT * FROM slides WHERE case_id IN (${ids.map(() => '?').join(',')}) ORDER BY is_he DESC, id`, ids) : Promise.resolve([] as Slide[]);
export const getTags = () => rows<{ tag: string; tag_name: string; n: number }>('SELECT d.code AS tag,d.label AS tag_name,COUNT(*) AS n FROM case_diagnostic_tags t JOIN diagnostic_tags d ON d.code=t.tag_code GROUP BY d.code ORDER BY n DESC,d.label');
export const getDiagnosticTag = async (code: string) => (await rows<{ code: string; label: string }>('SELECT code,label FROM diagnostic_tags WHERE code=?',[code]))[0] ?? null;
export type TagCase = Case & { organ_name: string; organ_path: string; entity_name: string; entity_path: string };
export async function getCasesForTag(tag: string, q: CaseQuery = {}): Promise<{ cases: TagCase[]; total: number; sources: { source: string; source_name: string; n: number }[] }> {
  const sources = await rows<{ source: string; source_name: string; n: number }>('SELECT c.source, c.source_name, COUNT(*) AS n FROM cases c JOIN case_diagnostic_tags t ON t.case_id = c.id WHERE t.tag_code = ? GROUP BY c.source ORDER BY n DESC', [tag]);
  const total = q.source ? (sources.find((s) => s.source === q.source)?.n ?? 0) : sources.reduce((a, s) => a + s.n, 0);
  const page = Math.max(1, q.page ?? 1);
  const cases = await rows<TagCase>(
    `SELECT c.*, ${LABEL_COLUMNS}, m.relation AS classification_relation, m.reason AS classification_reason, o.name AS organ_name, o.path AS organ_path, e.name AS entity_name, e.path AS entity_path FROM cases c
     LEFT JOIN case_labels l ON l.case_id=c.id LEFT JOIN classification_map m ON m.case_id=c.id
     JOIN case_diagnostic_tags t ON t.case_id = c.id JOIN nodes o ON o.id = c.organ_id JOIN nodes e ON e.id = c.entity_id
     WHERE t.tag_code = ?${q.source ? ' AND c.source = ?' : ''} ORDER BY o.sort, o.id, e.name, c.n_he DESC, c.id LIMIT ? OFFSET ?`,
    q.source ? [tag, q.source, PAGE, (page - 1) * PAGE] : [tag, PAGE, (page - 1) * PAGE]);
  return { cases, total, sources };
}
export const getSources = () => rows<{ source: string; name: string; n_cases: number; n_slides: number }>('SELECT * FROM sources ORDER BY n_cases DESC');
export const getTotals = async () => (await rows<{ c: number; s: number }>('SELECT COUNT(*) AS c, SUM(n_slides) AS s FROM cases'))[0];

export interface StudyTopic { id: number; organ_id: number; kind: string; slug: string; title: string; sort: number; n_cases: number; n_slides: number }
export const getOrganProfile = async (id: number) => (await rows<{ intro: string }>('SELECT intro FROM organ_profiles WHERE organ_id=?', [id]))[0];
export const getOrganTopics = (id: number) => rows<StudyTopic>('SELECT * FROM study_topics WHERE organ_id=? ORDER BY sort,id', [id]);
export const getTopic = async (organId: number, slug: string) => (await rows<StudyTopic>('SELECT * FROM study_topics WHERE organ_id=? AND slug=?', [organId, slug]))[0] ?? null;
export const getNodeById = async (id: number) => (await rows<Node>('SELECT n.*, a.original_node_id, a.collection_id FROM nodes n LEFT JOIN anatomy_node_map a ON a.node_id=n.id WHERE n.id=?', [id]))[0] ?? null;
export const getOrganDirectory = () => rows<Node & { intro: string; system_name: string; normal_cases: number; neoplastic_cases: number; non_neoplastic_cases: number; family_name: string | null; anatomical_sites: string | null }>(`SELECT o.*, p.intro, s.name AS system_name, (SELECT p.name FROM anatomy_collections a JOIN nodes p ON p.id=a.parent_organ_id WHERE a.organ_id=o.id) AS family_name, (SELECT GROUP_CONCAT(n.name, ' · ') FROM anatomy_collections a JOIN nodes n ON n.id=a.organ_id WHERE a.parent_organ_id=o.id AND a.directory=0) AS anatomical_sites,
 COALESCE((SELECT n_cases FROM nodes WHERE parent_id=o.id AND kind='normal'),0) AS normal_cases,
 COALESCE((SELECT n_cases FROM nodes WHERE parent_id=o.id AND kind='neoplastic'),0) AS neoplastic_cases,
 COALESCE((SELECT n_cases FROM nodes WHERE parent_id=o.id AND kind='non_neoplastic'),0) AS non_neoplastic_cases
 FROM nodes o JOIN organ_profiles p ON p.organ_id=o.id JOIN nodes s ON s.id=o.parent_id WHERE NOT EXISTS(SELECT 1 FROM anatomy_collections a WHERE a.parent_organ_id=o.id AND a.directory=1) AND NOT EXISTS(SELECT 1 FROM anatomy_collections a WHERE a.organ_id=o.id AND a.directory=0) ORDER BY s.sort,COALESCE((SELECT p.sort FROM anatomy_collections a JOIN nodes p ON p.id=a.parent_organ_id WHERE a.organ_id=o.id),o.sort),o.sort,o.id`);
export async function getCasesForTopic(topic: StudyTopic, q: CaseQuery = {}) {
 const sources=await rows<{ source: string; source_name: string; n: number }>('SELECT c.source,c.source_name,COUNT(*) AS n FROM cases c JOIN study_topic_cases t ON t.case_id=c.id WHERE t.topic_id=? GROUP BY c.source ORDER BY n DESC',[topic.id]);
 const total=q.source ? sources.find(s=>s.source===q.source)?.n ?? 0 : topic.n_cases;
 const args: InValue[]=q.source ? [topic.id,q.source] : [topic.id];
 const cases=await rows<Case>(`SELECT c.*,${LABEL_COLUMNS},m.relation AS classification_relation,m.reason AS classification_reason FROM cases c JOIN study_topic_cases t ON t.case_id=c.id LEFT JOIN case_labels l ON l.case_id=c.id LEFT JOIN classification_map m ON m.case_id=c.id WHERE t.topic_id=?${q.source?' AND c.source=?':''} ${CASE_ORDER} LIMIT ? OFFSET ?`,[...args,PAGE,(Math.max(1,q.page??1)-1)*PAGE]);
 return {cases,total,sources};
}

export const getAnatomicalChildren = (id:number) => rows<Node>('SELECT n.* FROM anatomy_collections a JOIN nodes n ON n.id=a.organ_id WHERE a.parent_organ_id=? ORDER BY n.sort,n.id',[id]);
export const getAnatomicalParent = async (id:number) => (await rows<Node>('SELECT n.* FROM anatomy_collections a JOIN nodes n ON n.id=a.parent_organ_id WHERE a.organ_id=?',[id]))[0] ?? null;

export const getRelatedAnatomy = (id:number) => rows<Node>('SELECT n.* FROM anatomy_related a JOIN nodes n ON n.id=a.to_organ_id WHERE a.from_organ_id=? ORDER BY n.name',[id]);

export interface WhoHeading {
  organ_id: number; source_id: string; parent_source_id: string | null;
  name: string; source_name: string; source_url: string; source_volume: string;
  sort: number; n_cases: number; n_slides: number;
}
export const getWhoOutline = (organId: number) => rows<WhoHeading>('SELECT * FROM who_outline_nodes WHERE organ_id=? ORDER BY sort,source_id',[organId]);
export const getWhoHeading = async (organId: number, reference: string) => (await rows<WhoHeading>('SELECT * FROM who_outline_nodes WHERE organ_id=? AND source_id=?',[organId,reference]))[0] ?? null;
export async function getCasesForWho(heading: WhoHeading,q: CaseQuery = {}) {
  const args: InValue[]=[heading.organ_id,heading.source_id];
  const sources=await rows<{source:string;source_name:string;n:number}>('SELECT c.source,c.source_name,COUNT(*) AS n FROM cases c JOIN who_outline_cases w ON w.case_id=c.id WHERE w.organ_id=? AND w.source_id=? GROUP BY c.source ORDER BY n DESC',args);
  const total=q.source ? sources.find(s=>s.source===q.source)?.n ?? 0 : heading.n_cases;
  const cases=await rows<Case>(`SELECT c.*,${LABEL_COLUMNS},m.relation AS classification_relation,m.reason AS classification_reason FROM cases c JOIN who_outline_cases w ON w.case_id=c.id LEFT JOIN case_labels l ON l.case_id=c.id LEFT JOIN classification_map m ON m.case_id=c.id WHERE w.organ_id=? AND w.source_id=?${q.source?' AND c.source=?':''} ${CASE_ORDER} LIMIT ? OFFSET ?`,[...args,...(q.source?[q.source]:[]),PAGE,(Math.max(1,q.page??1)-1)*PAGE]);
  return {cases,total,sources};
}
