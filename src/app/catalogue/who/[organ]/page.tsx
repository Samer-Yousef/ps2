import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getNodeById,getWhoOutline,getAncestors } from '@/lib/catalogue';
import WhoOutline,{WhoReferenceNote} from '../../who-outline';
import {Crumbs} from '../../ui';
export const dynamic='force-dynamic';
export default async function Page({params}:{params:Promise<{organ:string}>}) {
 const {organ}=await params;if(!/^\d+$/.test(organ)||!Number.isSafeInteger(Number(organ)))notFound();const node=await getNodeById(Number(organ));if(!node||node.level!=='organ')notFound();
 const [headings,trail]=await Promise.all([getWhoOutline(node.id),getAncestors(node)]);
 return <main className="cat-main atlas-main"><Crumbs trail={trail}/><h1 className="cat-h1">{node.name}: WHO reference outline</h1><p className="cat-lead"><Link href={`/catalogue/${node.path}`}>← Organ study page</Link></p><WhoReferenceNote organName={node.name}/><WhoOutline headings={headings}/>{!headings.length&&<p className="cat-empty">No WHO reference chapters are selected for this anatomical collection.</p>}</main>;
}
