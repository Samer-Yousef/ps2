import { notFound } from 'next/navigation';
import Link from 'next/link';
import {getTopic,getNodeById,getAncestors,getCasesForTopic,getSlidesForCases} from '@/lib/catalogue';
import {Crumbs,CaseRow,SourceChips,Pager,fmt} from '../../../ui';
export const dynamic='force-dynamic';
export default async function TopicPage({params,searchParams}:{params:Promise<{organ:string;slug:string}>;searchParams:Promise<{source?:string;page?:string}>}){
 const {organ:id,slug}=await params;const {source,page:pageText}=await searchParams;
 if(!/^\d+$/.test(id))notFound();
 const [organ,topic]=await Promise.all([getNodeById(Number(id)),getTopic(Number(id),slug)]);if(!organ||organ.level!=='organ'||!topic)notFound();
 const page=Math.max(1,Number.parseInt(pageText??'1',10)||1);const trail=await getAncestors(organ);
 const {cases,total,sources}=await getCasesForTopic(topic,{source,page});const slides=await getSlidesForCases(cases.filter(c=>c.n_slides>1).map(c=>c.id));
 const base=`/catalogue/topics/${organ.id}/${topic.slug}`;
 return <main className="cat-main atlas-main"><Crumbs trail={trail}/><p className="atlas-eyebrow">{topic.kind==='normal'?'NORMAL HISTOLOGY':'NON-NEOPLASTIC'} · {organ.name}</p><h1 className="cat-h1">{topic.title}</h1><p className="cat-lead">{fmt(topic.n_cases)} cases · {fmt(topic.n_slides)} slides</p><p className="cat-reference">This study heading groups related material. Original source diagnoses and their qualifications are shown below.</p><Link className="cat-link" href={`/catalogue/${organ.path}#${topic.kind==='normal'?'normal':'non-neoplastic'}`}>← Back to {organ.name} study outline</Link><section className="cat-cases"><h2 className="cat-h2">Cases <span className="ct">{fmt(total)}</span></h2><SourceChips base={base} sources={sources} active={source}/>{cases.map(c=><CaseRow key={c.id} c={c} slides={slides.filter(s=>s.case_id===c.id)} showEntity organName={organ.name}/>)}<Pager base={base} total={total} page={page} source={source}/></section></main>;
}
