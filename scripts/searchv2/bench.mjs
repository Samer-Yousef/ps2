// Usage: node scripts/searchv2/bench.mjs [bench|eval]  — runs public/searchv2-data/worker.js in node (vm shim).
// Runs public/searchv2-data/worker.js in node (vm shim) for latency + eval checks.
import fs from 'fs'; import vm from 'vm';
const D='/var/www/website/public/searchv2-data';
const src=fs.readFileSync(D+'/worker.js','utf8');
const out=[];
const ctx={performance,console,TextDecoder,Int32Array,Float32Array,Uint8Array,Map,Set,Promise,Math,setTimeout,AbortController,
  indexedDB:{open(){const r={};setTimeout(()=>r.onerror&&r.onerror(),0);return r;}},
  fetch:async(u)=>{const p=D+u.replace('/searchv2-data','');return{ok:true,headers:{get:()=>null},body:null,text:async()=>fs.readFileSync(p,'utf8'),json:async()=>JSON.parse(fs.readFileSync(p,'utf8'))}},
};
ctx.self=ctx;ctx.postMessage=(m)=>out.push(m);
vm.createContext(ctx);vm.runInContext(src,ctx);
const t0=performance.now();
await ctx.onmessage({data:{type:'init'}});
while(!out.some(m=>m.type==='dataReady'))await new Promise(r=>setTimeout(r,20));
console.log('ready',out.find(m=>m.type==='dataReady').count,'in',(performance.now()-t0).toFixed(0),'ms');
export async function q(query,filters){out.length=0;await ctx.onmessage({data:{type:'search',query,filters,searchId:1}});return out.find(m=>m.type==='results');}
const mode=process.argv[2]||'bench';
if(mode==='bench'){
 const qs=['s','sq','squa','squamous','squamous c','squamous cell','squamous cell carcinoma','kikuchi','meningioma','granuloma annulare','nodular fasciitis','dermatofibro','pilomatrixoma','gist','hydatidifor','papiloma','gausher','lobular capillary h','ipmn','pyogenic granuloma','breast benign','ovary malignant','wilms','nephroblastoma'];
 for(const s of qs){const t=[];let r;for(let k=0;k<3;k++){r=await q(s);t.push(r.ms);}
  console.log(s.padEnd(24),'ms',t.join('/').padEnd(16),'| groups',String(r.groups.length).padStart(3),'| top:',r.groups.slice(0,4).map(g=>g.d+'('+g.total+')').join(' ; ').slice(0,120));}
}
if(mode==='eval'){
 const ev=JSON.parse(fs.readFileSync('/var/www/website/data-v2/eval/evalset.json','utf8'));
 const nrm=(s)=>vm.runInContext('norm',ctx)(s);
 let tot=0,r1=0,r3=0,r10=0,miss=0;const misses=[];
 const lat=[];
 for(const e of ev){const r=await q(e.q);lat.push(r.ms);const dx=nrm(e.dx);
  // rank of first group whose label (or any case title) equals dx
  let rank=-1;for(let i=0;i<r.groups.length;i++){const g=r.groups[i];if(nrm(g.d)===dx||g.cases.some(c=>c.t&&nrm(c.t)===dx)){rank=i+1;break;}}
  tot+=e.n;if(rank===1)r1+=e.n;if(rank>0&&rank<=3)r3+=e.n;if(rank>0&&rank<=10)r10+=e.n;if(rank<0){miss+=e.n;misses.push([e.n,e.q,e.dx,r.groups.slice(0,3).map(g=>g.d).join(' | ')]);}}
 lat.sort((a,b)=>a-b);
 console.log(`weighted: top1 ${(100*r1/tot).toFixed(1)}%  top3 ${(100*r3/tot).toFixed(1)}%  top10 ${(100*r10/tot).toFixed(1)}%  miss ${(100*miss/tot).toFixed(1)}%  | latency p50 ${lat[lat.length>>1]} p90 ${lat[Math.floor(lat.length*.9)]} max ${lat[lat.length-1]} ms`);
 misses.sort((a,b)=>b[0]-a[0]);for(const m of misses.slice(0,40))console.log(m[0],JSON.stringify(m[1]),'→',JSON.stringify(m[2]),' got:',m[3].slice(0,100));
}
