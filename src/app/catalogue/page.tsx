import Link from 'next/link';
import { getOrganDirectory, getTotals } from '@/lib/catalogue';
import { fmt } from './ui';
import OrganDirectory from './organ-directory';
export const dynamic='force-dynamic';
export default async function CatalogueHome(){
 const [organs,totals]=await Promise.all([getOrganDirectory(),getTotals()]);
 return <main className="cat-main atlas-main">
  <header className="atlas-hero"><div><p className="atlas-eyebrow">THE SLIDE COLLECTION</p><h1 className="cat-h1">Study by organ</h1><p className="atlas-intro">Choose an organ or anatomical site, starting with normal tissue, then neoplastic and non-neoplastic disease. Smaller anatomical subdivisions sit within the relevant organ page.</p></div><div className="atlas-total"><strong>{fmt(totals.s)}</strong><span>slides · {fmt(totals.c)} cases</span></div></header>
  <nav className="cat-study-nav" aria-label="Study categories"><Link href="/catalogue/study/normal"><strong>01 · Normal histology</strong><span>Tissue architecture and physiological changes</span></Link><Link href="/catalogue/study/neoplastic"><strong>02 · Neoplastic</strong><span>WHO tumour families and entities</span></Link><Link href="/catalogue/study/non_neoplastic"><strong>03 · Non-neoplastic</strong><span>Organ-specific disease patterns</span></Link></nav>
  <OrganDirectory organs={organs}/>
  <p className="cat-reference">Each case appears in one main directory collection. Broader organ pages also bring their sites together. Neoplastic branches retain the WHO hierarchy. Non-neoplastic study headings draw on Pathology Outlines and supplementary source material. Original diagnoses remain visible in every case list.</p>
 </main>;
}
