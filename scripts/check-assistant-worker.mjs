// Run actual route/schema code with isolated D1/R2 and a test-only identity provider.
import assert from 'node:assert/strict';
import {readFileSync,realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {demoSample,emptySession} from '../lib/xafs-assistant.ts';
const req=createRequire(realpathSync(new URL('../node_modules/wrangler/package.json',import.meta.url)));
const {Miniflare}=req('miniflare');const {build}=req('esbuild');
const mock=`export let user=''; export function setUser(v){user=v}; export class ComputeError extends Error{constructor(message,status=400){super(message);this.status=status}}; export async function owner(r){if(!user)throw new ComputeError('login',401);if(r&&r.headers.get('origin')&&r.headers.get('origin')!==new URL(r.url).origin)throw new ComputeError('origin',403);return user}; export const respond=(v,s=200)=>Response.json(v,{status:s});export const failure=e=>respond({error:e.message},e.status||503);`;
const bundle=await build({stdin:{contents:`import {GET,PUT} from './app/api/assistant/route.ts';import {setUser} from 'test-owner';export default {async fetch(r){setUser(r.headers.get('x-test-user')||'');return r.method==='PUT'?PUT(r):GET();}}`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',external:['cloudflare:workers'],plugins:[{name:'test-owner',setup(b){b.onResolve({filter:/^(test-owner|@\/lib\/compute-server)$/},()=>({path:'test-owner',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:mock,loader:'js'}));b.onResolve({filter:/^@\//},args=>({path:process.cwd()+'/'+args.path.slice(2)+'.ts'}));}}]});
const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],cf:false,script:bundle.outputFiles[0].text,d1Databases:['DB'],r2Buckets:['BUCKET']});
const put=(data,user='alice',origin='http://local.test')=>mf.dispatchFetch('http://local.test/api/assistant',{method:'PUT',headers:{'content-type':'application/json','x-test-user':user,origin},body:JSON.stringify(data)});
const get=(user='alice')=>mf.dispatchFetch('http://local.test/api/assistant',{headers:{'x-test-user':user}});
try{const db=await mf.getD1Database('DB');await db.exec(readFileSync('drizzle/0002_messy_fabian_cortez.sql','utf8').replaceAll('\n',' '));
assert.equal((await get('')).status,401);let r=await get();assert.deepEqual(await r.json(),{session:null,revision:0});const s=emptySession();s.samples=[demoSample()];s.active=s.samples[0].id;
r=await put({session:s,revision:0});assert.equal(r.status,200);assert.equal((await r.json()).revision,1);r=await get();let body=await r.json();assert.deepEqual(body.session,s);assert.equal(body.revision,1);
assert.deepEqual(await (await get('bob')).json(),{session:null,revision:0});assert.equal((await put({session:s,revision:0})).status,409);assert.equal((await put({session:s,revision:1},'alice','http://other.test')).status,403);
const bytes=Buffer.from('\ufeff# E mu\r\n1 2\r\n2 3\r\n');const hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');const real={...demoSample(),id:'real',example:false,name:'exact.dat',text:new TextDecoder().decode(bytes),originalBase64:bytes.toString('base64'),sha256:hash};s.samples.push(real);
r=await put({session:s,revision:1});assert.equal(r.status,200);body=await (await get()).json();assert.equal(body.revision,2);assert.deepEqual(Buffer.from(body.session.samples[1].originalBase64,'base64'),bytes);
const corrupted=structuredClone(s);corrupted.samples[1].text+='modified';assert.equal((await put({session:corrupted,revision:2})).status,400);assert.equal((await put({session:{version:99},revision:2})).status,400);assert.equal((await put({session:s,revision:1})).status,409);
console.log('Assistant workerd checks passed: authenticated storage, original byte round trip, schema/hash validation, origin restriction, optimistic concurrency and cross-user isolation.');
}finally{await mf.dispose();}
