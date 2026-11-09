// flat (home-page style) results with the vector rerank: node bench6.mjs "query" ...   (needs the site running on :3000)
import fs from 'fs'; import vm from 'vm';
const D='/var/www/website/public/searchv2-data';
const src=fs.readFileSync(D+'/worker.js','utf8'); const out=[];
const realFetch=globalThis.fetch;
const ctx={performance,console,TextDecoder,Int32Array,Float32Array,Uint8Array,Map,Set,Promise,Math,setTimeout,AbortController,
  indexedDB:{open(){const r={};setTimeout(()=>r.onerror&&r.onerror(),0);return r;}},
  fetch:async(u,o)=>{ if(u.startsWith('/api/')) return realFetch('http://localhost:3000'+u,o);
    const p=D+u.replace('/searchv2-data','');return{ok:true,headers:{get:()=>null},body:null,text:async()=>fs.readFileSync(p,'utf8'),json:async()=>JSON.parse(fs.readFileSync(p,'utf8'))}}};
ctx.self=ctx;ctx.postMessage=(m)=>out.push(m); vm.createContext(ctx);vm.runInContext(src,ctx);
await ctx.onmessage({data:{type:'init'}});
while(!out.some(m=>m.type==='dataReady'))await new Promise(r=>setTimeout(r,20));
const n=parseInt(process.env.N||'12');
for(const s of process.argv.slice(2)){
  out.length=0; await ctx.onmessage({data:{type:'search',query:s,filters:{},searchId:1,semantic:true,flat:true}});
  const t0=performance.now(); while(!out.some(m=>m.mode==='semantic')&&performance.now()-t0<5000)await new Promise(r=>setTimeout(r,20));
  const lex=out.find(m=>m.mode==='lexical'), sem=out.find(m=>m.mode==='semantic');
  console.log('\n### '+s+'  lexical '+lex.cases.length+' rows / '+lex.ms+' ms; fused '+(sem?sem.cases.length+' rows / '+sem.ms+' ms':'none'));
  const r=sem||lex;
  r.cases.slice(0,n).forEach((c,i)=>console.log(`  ${String(i+1).padStart(2)} ${c._score.toFixed(3)} ${c.sem?'~':' '} ${c.d}  [${c.o||''}]`));
  const firstSem=r.cases.findIndex(c=>c.sem); console.log('  first semantic-only row at', firstSem<0?'none':firstSem+1);
}
