import Link from 'next/link';
import type { WhoHeading } from '@/lib/catalogue';
import { fmt } from './ui';
import './who-outline.css';

export const whoHref=(organId:number,reference?:string)=>`/catalogue/who/${organId}${reference?'/'+reference:''}`;

export function WhoReferenceNote({organName}:{organName:string}) {
 return <div className="who-reference-note"><p>WHO chapters, families and individual entities are shown below, including headings with no linked cases. Counts include cross-links; a case can appear under more than one heading. Placement in a WHO chapter does not imply malignant or neoplastic behaviour.</p>{organName==='Breast'&&<p><strong>Breast reference: 5th edition.</strong> IARC still lists the 6th edition as beta (checked 11 October 2026). This outline uses the finalized 5th edition, so its chapter names differ from the 6th-edition preview.</p>}</div>;
}

export default function WhoOutline({headings,parent=null}:{headings:WhoHeading[];parent?:string|null}) {
 const children=new Map<string|null,WhoHeading[]>();
 for(const h of headings){const list=children.get(h.parent_source_id)??[];list.push(h);children.set(h.parent_source_id,list);}
 function branch(items:WhoHeading[],depth=0):React.ReactNode {
  return <ul className="who-branches">{items.map(h=><li key={h.source_id} data-reference={h.source_id} data-depth={depth}>
   <Link href={whoHref(h.organ_id,h.source_id)} className={`who-heading${children.has(h.source_id)?' who-family':''}${!h.n_cases?' who-empty':''}`}><span>{h.name}</span><span className="who-count">{h.n_cases?fmt(h.n_cases):'No linked cases'}</span></Link>
   {children.has(h.source_id)&&branch(children.get(h.source_id)!,depth+1)}
  </li>)}</ul>;
 }
 const roots=children.get(parent)??[];
 if(parent)return roots.length?<div className="who-subtree">{branch(roots)}</div>:null;
 return <div className="who-grid">{roots.map(h=><section key={h.source_id} className="who-card" data-reference={h.source_id}>
  <div className="who-chapter"><span className="who-volume">{h.source_volume}</span><Link href={whoHref(h.organ_id,h.source_id)} className="who-title"><h3>{h.name}</h3><span className="who-count">{h.n_cases?fmt(h.n_cases):'No linked cases'}</span></Link></div>
  {children.has(h.source_id)?branch(children.get(h.source_id)!):<p className="who-direct"><Link href={whoHref(h.organ_id,h.source_id)}>{h.n_cases?'View labelled cases →':'View reference →'}</Link></p>}
 </section>)}</div>;
}
