import fs from 'fs'; import vm from 'vm';
const D='/var/www/website/public/searchv2-data';
const src=fs.readFileSync(D+'/worker.js','utf8'); const out=[];
const ctx={performance,console,TextDecoder,Int32Array,Float32Array,Uint8Array,Map,Set,Promise,Math,setTimeout,AbortController,
  indexedDB:{open(){const r={};setTimeout(()=>r.onerror&&r.onerror(),0);return r;}},
  fetch:async(u)=>{const p=D+u.replace('/searchv2-data','');return{ok:true,headers:{get:()=>null},body:null,text:async()=>fs.readFileSync(p,'utf8'),json:async()=>JSON.parse(fs.readFileSync(p,'utf8'))}}};
ctx.self=ctx;ctx.postMessage=(m)=>out.push(m); vm.createContext(ctx);vm.runInContext(src,ctx);
const t0=performance.now(); await ctx.onmessage({data:{type:'init'}});
while(!out.some(m=>m.type==='dataReady'))await new Promise(r=>setTimeout(r,20));
console.log('ready in',(performance.now()-t0).toFixed(0),'ms');
async function q(query){out.length=0;await ctx.onmessage({data:{type:'search',query,filters:{},searchId:1}});return out.find(m=>m.type==='results');}
for(const s of process.argv.slice(2)){const r=await q(s);
 console.log('\n### '+s+'  ('+r.ms+' ms) text="'+r.intent.text+'" chips='+JSON.stringify(r.intent.chips.map(c=>c.kind+':'+c.label)));
 console.log('  groups',r.groups.length,'|',r.groups.slice(0,8).map(g=>g.d+'('+g.total+')').join(' ; '));
 if(r.recs)console.log('  ALSO ['+r.recs.family+' / seed '+r.recs.seed+']:',r.recs.items.slice(0,10).map(i=>i.name+'('+i.n+')').join(', '));}
