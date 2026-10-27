import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {searchSchema,searchReadiness,validateSearch,searchPlan,trialConfig,trialResult,searchSummary} from '../lib/coordination-search.ts';
const rows=[{filename:'feff0001.dat',nleg:2,degen:4,reff:2,geometry:[['Pd'],['O']]}];
const p=(value,min,max,vary=false)=>({value,min,max,vary});
const q=searchSchema.parse({feff_job:'a'.repeat(32),target:rows[0].filename,element:'O',kmin:3,kmax:11,rmin:1,rmax:3,kweight:2,dk:1,window:'hanning',s02:p(.9,.3,1.5),e0:p(0,-10,10,true),paths:[{filename:rows[0].filename,deltar:p(0,-.1,.1,true),sigma2:p(.003,0,.02,true),coordination:null}],nmax:4,step:1,s02Delta:.05,amplitudeSource:'assumed',amplitudeNote:'assumed for exploration',data_kind:'synthetic_test',provenance:'synthetic numerical fixture',paths_reviewed:true});
const ready={demo:false,connected:true,feffReady:true,fileName:'sample.chi',reviewed:true};
assert.deepEqual(searchReadiness(q,rows,ready).issues,[]);
const disconnected=searchReadiness(q,rows,{...ready,connected:false});assert.equal(disconnected.issues.length,1);assert(disconnected.issues[0].includes('计算服务器'));
const noModel=searchReadiness(q,rows,{...ready,feffReady:false});assert(noModel.issues.some(s=>s.includes('FEFF')));assert(!noModel.issues.some(s=>s.includes('尚未选择可用 χ(k)')));
const needsNote=searchReadiness({...q,amplitudeNote:''},rows,ready);assert(needsNote.issues.some(s=>s.includes('振幅来源')));
const noConfirmation=searchReadiness(q,rows,{...ready,reviewed:false});assert.equal(noConfirmation.issues.length,1);assert(noConfirmation.issues[0].includes('本搜索区'));
assert(searchReadiness(q,rows,{...ready,fileName:''}).issues.some(s=>s.includes('具体目标谱')));
const original=JSON.stringify(q);validateSearch(q,rows);const plan=searchPlan(q);
assert.equal(plan.filter(t=>t.group==='free').length,3);assert.equal(plan.filter(t=>t.group==='profile').length,10);
const zero=trialConfig(q,plan.find(t=>t.n===0));assert.equal(zero.paths[0].coordination.value,0);assert.equal(zero.paths[0].sigma2.vary,false);assert.equal(zero.paths[0].deltar.vary,false);
const free=trialConfig(q,plan[0]);assert.equal(free.paths[0].coordination.vary,true);assert.equal(free.s02.vary,false);
assert.notDeepEqual(trialConfig(q,plan[0]),trialConfig(q,plan[1]));assert.equal(JSON.stringify(q),original);
assert.throws(()=>validateSearch({...q,s02:{...q.s02,vary:true}},rows));
assert.throws(()=>validateSearch({...q,element:'B'},rows));
assert.throws(()=>validateSearch({...q,paths:[...q.paths,{...q.paths[0],filename:'feff0002.dat'}]},[...rows,{...rows[0],filename:'feff0002.dat'}]));
assert.throws(()=>searchPlan({...q,nmax:20,step:.5}));
const failed=trialResult(q,plan[0],{id:'b'.repeat(32),state:'succeeded',result:{optimizer_success:false,statistics:{rfactor:.00001}}});assert.equal(failed.rfactor,null);
assert(searchSummary({input:q,state:'completed',results:[failed],plan}).warnings.some(w=>w.includes('假定')));
// Exercise the actual route with SQLite, private object storage and a deterministic compute service.
const sql=new DatabaseSync(':memory:');let user='owner',counter=1,mode='ok',calls=0;const objects=new Map(),jobs=new Map();
class ComputeError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const DB={prepare(s){const stmt=sql.prepare(s);let args=[];return {bind(...a){args=a;return this;},async run(){const r=stmt.run(...args);return {meta:{changes:Number(r.changes)}};},async first(){return stmt.get(...args)||null;},async all(){return {results:stmt.all(...args)};}};}};
globalThis.__searchTest={env:{DB,BUCKET:{async put(k,v){objects.set(k,v);},async delete(k){objects.delete(k);},async get(k){const b=objects.get(k);return b?{async arrayBuffer(){return b;}}:null;}}},ComputeError,
 owner:async()=>user,connection:async()=>({baseUrl:'https://fixture',token:'fixture'}),
 ownedJob:async(u,id)=>{if(u!=='owner')throw new ComputeError('private',404);if(id===q.feff_job)return {label:'fixture FEFF',job:{kind:'feff',state:'succeeded',request:{edge:'K',kmax:12},result:{absorber_element:'Pd',paths:rows}}};const job=jobs.get(id);if(!job)throw new ComputeError('missing',404);return {label:'fixture fit',job};},
 saveJob:async(u,j)=>{jobs.set(j.id,j);},respond:(v,status=200)=>Response.json(v,{status}),failure:e=>Response.json({error:e.message},{status:e.status||503}),
 remote:async(b,t,path,options)=>{if(options?.method==='POST'){calls++;if(mode==='submitFail')throw new ComputeError('timeout',502);const config=JSON.parse(options.body.get('config')),id=(counter++).toString(16).padStart(32,'0');const n=config.paths[0].coordination.value;const job={id,kind:'fit',state:'queued',request:config,created:1,started:null,finished:null,error:null,result:undefined};jobs.set(id,job);return Response.json(job);}if(mode==='pollFail')throw new ComputeError('network',502);const j=structuredClone(jobs.get(path.split('/').at(-1)));j.state='succeeded';const n=j.request.paths[0].coordination.value;j.result={optimizer_success:true,statistics:{rfactor:(n-2.4)**2+.01},paths:[{filename:q.target,effective_coordination:{value:n,stderr:.2},r_or_half_path:2.01}],parameters:{}};return Response.json(j);}
};
let src=await readFile(new URL('../app/api/compute/coordination-search/route.ts',import.meta.url),'utf8');
src=src.replace("import {env} from 'cloudflare:workers';",'const {env}=globalThis.__searchTest;').replace(/import \{ComputeError[^;]+;/,'const {ComputeError,connection,failure,ownedJob,owner,remote,respond,saveJob}=globalThis.__searchTest;').replace("'@/lib/coordination-search'",JSON.stringify(new URL('../lib/coordination-search.ts',import.meta.url).href));
const js=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const route=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
async function create(){const form=new FormData();form.set('file',new File(['3 0.01\n4 0.02'],'test.chi'));form.set('config',JSON.stringify(q));const r=await route.POST(new Request('https://site/api',{method:'POST',body:form}));return {status:r.status,...await r.json()};}
const request=(id,action='advance')=>new Request('https://site/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,action})});
const created=await create();assert.equal(created.status,201);const id=created.record.id;
assert.equal((await create()).status,409,'only one active search per owner');
user='other';assert.equal((await route.GET(new Request('https://site/api?id='+id))).status,404);user='owner';
const concurrent=await Promise.all([route.POST(request(id)),route.POST(request(id))]);assert.equal(concurrent.filter(r=>r.status===200).length,1);assert.equal(calls,1,'concurrent advance must not submit duplicate fits');
mode='pollFail';assert.equal((await route.POST(request(id))).status,502);mode='ok';
let r;for(let i=0;i<plan.length+2;i++){r=await (await route.POST(request(id))).json();if(r.record.state==='completed')break;}
assert.equal(r.record.state,'completed');assert.equal(r.record.results.length,plan.length);assert.equal(calls,plan.length);assert.equal((await route.POST(request(id))).status,200);assert.equal(calls,plan.length,'completed search is idempotent');
const next=await create();mode='submitFail';assert.equal((await route.POST(request(next.record.id))).status,502);mode='ok';const interrupted=await (await route.GET(new Request('https://site/api?id='+next.record.id))).json();assert.equal(interrupted.record.state,'interrupted');const before=calls;await route.POST(request(next.record.id));assert.equal(calls,before,'ambiguous POST must never be retried');
// Saved FEFF models must remain discoverable after a scan creates more than 60 fits.
sql.exec('CREATE TABLE compute_jobs (id TEXT PRIMARY KEY,user_id TEXT,kind TEXT,label TEXT,snapshot TEXT,created_at TEXT)');
const insert=sql.prepare('INSERT INTO compute_jobs VALUES(?,?,?,?,?,?)');
insert.run('model','owner','feff','old model',JSON.stringify({id:'model',kind:'feff'}),'000');
for(let i=1;i<=70;i++)insert.run('fit'+i,'owner','fit','fit',JSON.stringify({id:'fit'+i,kind:'fit'}),String(i).padStart(3,'0'));
globalThis.__searchTest.kind=v=>{if(!['feff','fit','structure'].includes(v))throw new ComputeError('invalid');return v;};
let jobsSource=await readFile(new URL('../app/api/compute/jobs/route.ts',import.meta.url),'utf8');
jobsSource=jobsSource.replace("import { env } from 'cloudflare:workers';",'const {env}=globalThis.__searchTest;').replace(/import \{ ComputeError[^;]+;/,'const {ComputeError,connection,failure,kind,ownedJob,owner,remote,respond,saveJob}=globalThis.__searchTest;');
const jobsJs=ts.transpileModule(jobsSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const jobsRoute=await import('data:text/javascript;base64,'+Buffer.from(jobsJs).toString('base64'));
const recent=await (await jobsRoute.GET(new Request('https://site/api'))).json();assert.equal(recent.jobs.length,60);assert(!recent.jobs.some(j=>j.kind==='feff'));
const models=await (await jobsRoute.GET(new Request('https://site/api?kind=feff'))).json();assert.equal(models.jobs[0].id,'model');
user='other';assert.equal((await (await jobsRoute.GET(new Request('https://site/api?kind=feff'))).json()).jobs.length,0);user='owner';
console.log('Readiness checks passed: specific blockers for chosen spectrum, missing model, connection, amplitude note and confirmation; older FEFF discovery and owner isolation.');
console.log('Coordination checks passed: parameter/model guards, N=0 degeneracy, distinct starts, immutable inputs, failure exclusion, SQLite ownership, serial lifecycle, concurrent locking, resumable polling and ambiguous-submit protection. No real experimental spectrum was fitted.');
