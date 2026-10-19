// Usage: node scripts/searchv2/debug.mjs "query" ["query"…] — top groups with scores.
import {q} from './bench.mjs';
for (const s of process.argv.slice(2)) { const r=await q(s); console.log('##',s,r.ms,'ms'); for(const g of r.groups.slice(0,8)) console.log(' ',g.score.toFixed(3),g.total,'|',g.d,'| t=',g.cases[0].t,'| src',g.cases[0].src,'p?',g.cases[0]._score); }
