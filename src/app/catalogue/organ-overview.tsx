import Link from 'next/link';
import { getOrganProfile,getOrganTopics,getAnatomicalChildren,getAnatomicalParent,getRelatedAnatomy,getWhoOutline,type Node,type StudyTopic } from '@/lib/catalogue';
import {Crumbs,fmt} from './ui';
import WhoOutline,{WhoReferenceNote,whoHref} from './who-outline';
function TopicCards({topics}:{topics:StudyTopic[]}){
 return <div className="atlas-topic-grid">{topics.map(t=><Link key={t.id} href={`/catalogue/topics/${t.organ_id}/${t.slug}`} className="atlas-topic"><h3>{t.title}</h3><span>{fmt(t.n_cases)} {t.n_cases===1?'case':'cases'} · {fmt(t.n_slides)} {t.n_slides===1?'slide':'slides'} <span aria-hidden="true">→</span></span></Link>)}</div>;
}
export default async function OrganOverview({organ,trail,all}:{organ:Node;trail:Node[];all:Node[]}){
 const [profile,topics,anatomy,parent,related]=await Promise.all([getOrganProfile(organ.id),getOrganTopics(organ.id),getAnatomicalChildren(organ.id),getAnatomicalParent(organ.id),getRelatedAnatomy(organ.id)]);
 const groups=all.filter(n=>n.parent_id===organ.id);
 const normal=groups.find(n=>n.kind==='normal');const neo=groups.find(n=>n.kind==='neoplastic');const nonneo=groups.find(n=>n.kind==='non_neoplastic');const review=groups.find(n=>n.authority==='Review');
 const headings=await getWhoOutline(organ.id);
 return <main className="cat-main atlas-main">
  <Crumbs trail={trail.slice(0,-1)}/>
  {parent&&<p className="atlas-parent"><Link href={`/catalogue/${parent.path}`}>← All {parent.name.toLowerCase()} specimens</Link><span> This page includes only specimens assigned to this anatomical collection.</span></p>}
  <header className="atlas-hero"><div><p className="atlas-eyebrow">ORGAN STUDY OUTLINE</p><h1 className="cat-h1">{organ.name}</h1><p className="atlas-intro">{profile?.intro}</p></div><div className="atlas-total"><strong>{fmt(organ.n_cases)}</strong><span>cases · {fmt(organ.n_slides)} slides</span><Link href={`/catalogue/${organ.path}?all=1`}>Browse all cases →</Link></div></header>
  {related.length>0&&<p className="atlas-parent">Related anatomical collections: {related.map(n=><Link key={n.id} href={`/catalogue/${n.path}`}>{n.name} ({fmt(n.n_cases)} cases) →</Link>)}</p>}
  <nav className="atlas-jump" aria-label="Study categories">{[['normal','Normal histology',normal],['neoplastic','Neoplastic',neo],['non-neoplastic','Non-neoplastic',nonneo],['review','Classification to review',review]].map(([id,label,n])=><a key={String(id)} href={`#${id}`}><span>{String(label)}</span><span className="ct">{fmt((n as Node|undefined)?.n_cases??0)}</span></a>)}</nav>
  {anatomy.length>0&&<section className="atlas-anatomy" aria-label="Anatomical subdivisions"><h2>Explore by anatomical site</h2><p>Choose a recorded site, or use the full study outline below. Mixed and uncertain sites remain in the broader collection.</p><div className="atlas-anatomy-links">{anatomy.map(n=><Link key={n.id} href={`/catalogue/${n.path}`}><span>{n.name}</span><span>{fmt(n.n_cases)} cases →</span></Link>)}</div></section>}
  <section id="normal" className="atlas-section"><div className="atlas-section-title"><div><p className="atlas-eyebrow">01 · THE NORMAL REFERENCE</p><h2>Normal histology</h2></div><span>{fmt(normal?.n_cases??0)} cases</span></div><p className="atlas-section-note">Tissue architecture, anatomical compartments and physiological variation.</p>{topics.some(t=>t.kind==='normal')?<TopicCards topics={topics.filter(t=>t.kind==='normal')}/>:<p className="cat-empty">No normal tissue cases are currently available for this collection.</p>}</section>
  <section id="neoplastic" className="atlas-section"><div className="atlas-section-title"><div><p className="atlas-eyebrow">02 · WHO CLASSIFICATION</p><h2>Neoplastic</h2></div><Link href={whoHref(organ.id)}>WHO reference outline →</Link></div><WhoReferenceNote organName={organ.name}/><WhoOutline headings={headings}/>{!headings.length&&<p className="cat-empty">No WHO reference chapters are selected for this collection.</p>}</section>
  <section id="non-neoplastic" className="atlas-section"><div className="atlas-section-title"><div><p className="atlas-eyebrow">03 · DISEASE PATTERNS & CONDITIONS</p><h2>Non-neoplastic</h2></div><span>{fmt(nonneo?.n_cases??0)} cases</span></div><p className="atlas-section-note">Headings selected for this organ. Each opens the original source diagnoses and slides.</p>{topics.some(t=>t.kind==='non_neoplastic')?<TopicCards topics={topics.filter(t=>t.kind==='non_neoplastic')}/>:<p className="cat-empty">No non-neoplastic cases are currently available for this collection.</p>}</section>
  <section id="review" className="atlas-review"><div><h2>Classification to review</h2><p>Source diagnoses awaiting a supported placement. These cases remain available with their original labels.</p></div>{review?<Link href={`/catalogue/${review.path}`}>{fmt(review.n_cases)} labelled cases →</Link>:<span>No cases awaiting review</span>}</section>
 </main>;
}
