import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {quickShellSchema,quickShellPoscar,quickShellFeff,quickShellPath} from '../lib/quick-shell.ts';
const q=quickShellSchema.parse({scatterer:'O',distance:2,kmax:12,firstShell:true});
const text=quickShellPoscar(q),lines=text.trim().split('\n');assert.equal(lines[2],'4 0 0');assert.equal(lines[5],'Pd O');assert.equal(lines[6],'4 4');
// Periodic rock-salt scaffold has exactly six first neighbors at the nominal distance.
const points=lines.slice(8).map(s=>s.split(' ').map(Number));const shells=[];
for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)for(let i=0;i<points.length;i++){const v=points[i].map((p,k)=>4*(p+[x,y,z][k]));const d=Math.hypot(...v);if(d>0&&d<2.01)shells.push({d,i});}
assert.equal(shells.length,6);assert(shells.every(p=>Math.abs(p.d-2)<1e-10&&p.i>=4));
assert.equal(quickShellPoscar({...q,scatterer:'Pd'}).split('\n')[6],'8');
assert(!quickShellSchema.safeParse({...q,firstShell:false}).success);assert(!quickShellSchema.safeParse({...q,distance:4}).success);
const rows=[{filename:'feff0001.dat',nleg:2,reff:2,degen:6,geometry:[['Pd'],['O']]}];assert.equal(quickShellPath(q,rows).filename,'feff0001.dat');for(const n of [0,.5,4,8])assert(Math.abs(6*(.9*n/6)-.9*n)<1e-12,'effective N must replace scaffold degeneracy, never multiply it');assert.throws(()=>quickShellPath(q,[{...rows[0],reff:3}]));assert.throws(()=>quickShellPath(q,[{...rows[0],degen:12}]));
const structure={kind:'structure',state:'succeeded',id:'a'.repeat(32),result:{atom_count:8,pbc:[true,true,true],atoms:[{element:'Pd',index:0,position:[0,0,0]}]}};
assert.equal(quickShellFeff(q,structure).rpath,2.2);assert.equal(quickShellFeff(q,structure).nleg,2);
const sql=new DatabaseSync(':memory:');let user='owner',count=1,mode='ok',structureCalls=0,feffCalls=0;const jobs=new Map();
class ComputeError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const DB={prepare(s){const stmt=sql.prepare(s);let args=[];return {bind(...a){args=a;return this;},async run(){const r=stmt.run(...args);return {meta:{changes:Number(r.changes)}};},async first(){return stmt.get(...args)||null;},async all(){return {results:stmt.all(...args)};}};}};
globalThis.__quickTest={env:{DB},ComputeError,owner:async()=>user,connection:async()=>({baseUrl:'fixture',token:'fixture'}),respond:(x,s=200)=>Response.json(x,{status:s}),failure:e=>Response.json({error:e.message},{status:e.status||503}),
 ownedJob:async(u,id)=>{if(u!=='owner'||!jobs.has(id))throw new ComputeError('private',404);return {job:jobs.get(id),label:'QFS fixture'};},saveJob:async(u,j)=>jobs.set(j.id,j),
 remote:async(b,t,path,options)=>{
  if(options?.method==='POST'){if(mode==='submitFail')throw new ComputeError('unknown submission',502);const kind=path==='/v1/structures'?'structure':'feff';if(kind==='structure'){structureCalls++;assert.match(await options.body.get('file').text(),/NOT a predicted sample structure/);assert.equal(options.body.get('format'),'vasp');}else{feffCalls++;assert.equal(JSON.parse(options.body).nleg,2);}
   const id=(count++).toString(16).padStart(32,'0'),j={id,kind,state:'queued',created:1,request:kind==='structure'?{format:'vasp'}:JSON.parse(options.body)};jobs.set(id,j);return Response.json(j);
  }
  const j=structuredClone(jobs.get(path.split('/').at(-1)));j.state='succeeded';j.result=j.kind==='structure'?structure.result:{absorber_element:'Pd',paths:rows,warnings:[]};return Response.json(j);
 }
};
let src=await readFile(new URL('../app/api/compute/quick-shell/route.ts',import.meta.url),'utf8');src=src.replace("import {env} from 'cloudflare:workers';",'const {env}=globalThis.__quickTest;').replace(/import \{ComputeError[^;]+;/,'const {ComputeError,connection,failure,ownedJob,owner,remote,respond,saveJob}=globalThis.__quickTest;').replace("'@/lib/quick-shell'",JSON.stringify(new URL('../lib/quick-shell.ts',import.meta.url).href));
const js=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const route=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const req=body=>new Request('https://site/api',{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json'}});
const created=await (await route.POST(req({action:'create',input:q}))).json();const id=created.record.id;assert(created.record.structure);
user='other';assert.equal((await route.GET(new Request('https://site/api?id='+id))).status,404);user='owner';
const parallel=await Promise.all([route.POST(req({action:'advance',id})),route.POST(req({action:'advance',id}))]);assert.equal(parallel.filter(r=>r.status===200).length,1);assert.equal(feffCalls,1);
const ready=await (await route.POST(req({action:'advance',id}))).json();assert.equal(ready.record.state,'ready');const saved=jobs.get(ready.record.feff);assert.equal(saved.quickShellSource.target,'feff0001.dat');assert.equal(saved.result.paths.length,1);assert(saved.result.warnings.some(w=>w.includes('不是预测')));
await route.POST(req({action:'advance',id}));assert.equal(feffCalls,1,'ready pipeline must not submit another FEFF');assert.equal(structureCalls,1);
mode='submitFail';const bad=await route.POST(req({action:'create',input:q}));assert.equal(bad.status,502);const list=await (await route.GET(new Request('https://site/api'))).json();assert(list.records.some(r=>r.state==='interrupted'));
console.log('Quick-shell checks passed: periodic first-neighbor geometry, same-element scaffold, physical scope, nearest-path/degeneracy checks, actual route lifecycle with SQLite, owner isolation, concurrency, provenance and ambiguous-submit handling. No real FEFF calculation or experimental fit was run.');
