import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getNodeById,getWhoOutline,getWhoHeading,getCasesForWho,getSlidesForCases,getAncestors } from '@/lib/catalogue';
import WhoOutline,{whoHref} from '../../../who-outline';
import {Crumbs,CaseRow,SourceChips,Pager,fmt} from '../../../ui';
export const dynamic='force-dynamic';
export default async function Page({params,searchParams}:{params:Promise<{organ:string;reference:string}>;searchParams:Promise<{source?:string;page?:string}>}) {
 const {organ,reference}=await params;const {source,page:pageStr}=await searchParams;const page=Math.max(1,parseInt(pageStr??'1',10)||1);
 if(!/^\d+$/.test(organ)||!Number.isSafeInteger(Number(organ)))notFound();
 const node=await getNodeById(Number(organ));if(!node||node.level!=='organ')notFound();
 let referenceId:string;try{referenceId=decodeURIComponent(reference);}catch{notFound();}
 const heading=await getWhoHeading(node.id,referenceId);if(!heading)notFound();
 const [all,trail,{cases,total,sources}]=await Promise.all([getWhoOutline(node.id),getAncestors(node),getCasesForWho(heading,{source,page})]);
 const slides=await getSlidesForCases(cases.filter(c=>c.n_slides>1).map(c=>c.id));const byCase=new Map<number,typeof slides>();for(const s of slides){const a=byCase.get(s.case_id)??[];a.push(s);byCase.set(s.case_id,a);}
 const ancestry=[];let parent=all.find(h=>h.source_id===heading.parent_source_id);while(parent){ancestry.unshift(parent);parent=all.find(h=>h.source_id===parent!.parent_source_id);}
 const base=whoHref(node.id,heading.source_id);
 return <main className="cat-main"><Crumbs trail={trail}/><nav className="who-trail" aria-label="WHO hierarchy"><Link href={whoHref(node.id)}>WHO reference outline</Link>{ancestry.map(h=><Link key={h.source_id} href={whoHref(node.id,h.source_id)}>› {h.name}</Link>)}</nav><h1 className="cat-h1">{heading.name}</h1><p className="cat-lead">{fmt(heading.n_cases)} linked cases · {fmt(heading.n_slides)} slides</p><p className="cat-reference">WHO classification · {heading.source_volume} · <a href={heading.source_url} target="_blank" rel="noopener noreferrer">View WHO reference</a></p><p className="cat-reference">Includes cases filed under this heading or its descendants and supported diagnosis cross-links. Original diagnoses, uncertainty and biological categories are retained. A case may appear under more than one reference heading.</p><WhoOutline headings={all} parent={heading.source_id}/><section className="cat-cases"><h2 className="cat-h2">Cases <span className="ct">{fmt(total)}</span></h2><SourceChips base={base} sources={sources} active={source}/>{cases.map(c=><CaseRow key={c.id} c={c} slides={byCase.get(c.id)} organName={node.name}/>)}{!total&&<p className="cat-empty">No cases are currently linked to this heading{source?' for the selected source':''}. The reference heading remains visible as part of the study outline.</p>}<Pager base={base} total={total} page={page} source={source}/></section></main>;
}
