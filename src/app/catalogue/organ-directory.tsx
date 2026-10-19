'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Node } from '@/lib/catalogue';
type Entry=Node & { intro: string; system_name: string; normal_cases: number; neoplastic_cases: number; non_neoplastic_cases: number; family_name: string | null; anatomical_sites: string | null };
const fmt=(n:number)=>n.toLocaleString('en-GB');
function normalize(s:string){return s.toLowerCase().replaceAll('oesoph','esoph').replaceAll('haem','hem');}
export default function OrganDirectory({organs}:{organs:Entry[]}){
 const [query,setQuery]=useState('');const [system,setSystem]=useState('');const [az,setAz]=useState(false);
 const systems=[...new Set(organs.map(o=>o.system_name))];
 const filtered=useMemo(()=>organs.filter(o=>(!system||o.system_name===system)&&normalize(o.name+' '+o.system_name+' '+(o.family_name??'')+' '+(o.anatomical_sites??'')).includes(normalize(query.trim()))).sort((a,b)=>az?a.name.localeCompare(b.name):organs.indexOf(a)-organs.indexOf(b)),[organs,query,system,az]);
 const groups=[[az?'Organs and sites A–Z':'Organs and sites by system',filtered] as const];
 return <section className="atlas-directory" aria-label="Organ directory">
  <div className="atlas-filters">
   <label className="atlas-search">Find an organ or site<input type="search" placeholder="e.g. cornea, ampulla, endometrium" value={query} onChange={e=>setQuery(e.target.value)}/></label>
   <label>System<select value={system} onChange={e=>setSystem(e.target.value)}><option value="">All systems</option>{systems.map(s=><option key={s}>{s}</option>)}</select></label>
   <div className="atlas-sort" role="group" aria-label="Directory order"><button type="button" aria-pressed={!az} onClick={()=>setAz(false)}>By system</button><button type="button" aria-pressed={az} onClick={()=>setAz(true)}>A–Z</button></div>
  </div>
  <p className="atlas-results" aria-live="polite">{filtered.length} of {organs.length} organs and tissue collections{(query||system)&&<> · <button type="button" onClick={()=>{setQuery('');setSystem('');}}>Clear filters</button></>}</p>
  {!filtered.length&&<p className="cat-empty">No organs match. Try another name or clear the system filter.</p>}
  {groups.map(([label,entries])=><section className="atlas-system" key={label}><h2>{label}</h2><div className="atlas-organ-grid">{entries.map(o=><Link key={o.id} href={`/catalogue/${o.path}`} className="atlas-organ-card">
   <span className="atlas-card-system">{o.system_name}</span>
   <div className="atlas-card-title"><h3>{o.name}</h3><span aria-hidden="true">↗</span></div>
   <p>{o.intro}</p>{o.anatomical_sites&&<p className="atlas-subsites">Sites: {o.anatomical_sites}</p>}<div className="atlas-card-footer"><span>{fmt(o.n_cases)} cases</span><span>{fmt(o.n_slides)} slides</span></div>
   <div className="atlas-coverage"><span>Normal {fmt(o.normal_cases)}</span><span>Neoplastic {fmt(o.neoplastic_cases)}</span><span>Non-neoplastic {fmt(o.non_neoplastic_cases)}</span></div>
  </Link>)}</div></section>)}
 </section>;
}
