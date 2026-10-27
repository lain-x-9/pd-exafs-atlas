import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
import {allowedComputeUrl} from '../lib/compute-types.ts';

const token='fixture_token_for_connection_checks_1234567890';
const origin='https://site.example';
const baseUrl='https://communicate-segments-dealt-same.trycloudflare.com';
const state={row:null,failWrite:false,calls:0,fetch:()=>Response.json({ok:true,version:'0.1.0'})};
const logs=[];
const env={COMPUTE_CONFIG_KEY:'34'.repeat(32),DB:{prepare(){return {bind(...args){return {
 first:async()=>state.row,
 run:async()=>{if(state.failWrite)throw Error('sensitive '+token);state.row={base_url:args[1],encrypted_token:args[2],updated_at:args[3]};},
};}};}}};
const sandboxBase={console:{error(...args){logs.push(args);}},crypto:webcrypto,Uint8Array,TextEncoder,TextDecoder,Response,Request,Headers,URL,AbortSignal,
 fetch:async(...args)=>{state.calls++;return state.fetch(...args);}};
function load(path,imports){
 const source=readFileSync(new URL(path,import.meta.url),'utf8').replaceAll('import.meta.env.DEV','false');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(code,{...sandboxBase,module,exports:module.exports,require(name){if(name in imports)return imports[name];throw Error(name);}});
 return module.exports;
}
const server=load('../lib/compute-server.ts',{
 'cloudflare:workers':{env},'@/app/chatgpt-auth':{getChatGPTUser:async()=>({userId:'owner-a'})},'./compute-types':{allowedComputeUrl},
});
const route=load('../app/api/compute/connection/route.ts',{'cloudflare:workers':{env},'@/lib/compute-server':server});
function request(body){return new Request(origin+'/api/compute/connection',{method:'PUT',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});}

for(const address of ['', 'http://fixture.trycloudflare.com',baseUrl+'/health','https://unrelated.example',baseUrl+'?x=1']){
 state.calls=0;
 const response=await route.PUT(request({baseUrl:address,token}));
 assert.equal(response.status,400);assert.equal(state.calls,0);
 assert.ok(!(await response.text()).includes('暂不可用'));
}
for(const badToken of ['', 'EXAFS_API_TOKEN='+token,'"'+token+'"',token+'\nextra']){
 state.calls=0;
 const response=await route.PUT(request({baseUrl,token:badToken}));
 assert.equal(response.status,400);assert.equal(state.calls,0);
 assert.match((await response.json()).error,/等号右侧/);
}
const malformed=await route.PUT(new Request(origin+'/api/compute/connection',{method:'PUT',body:'{invalid'}));
assert.equal(malformed.status,400);
const saved=await route.PUT(request({baseUrl,token}));
assert.equal(saved.status,200);
assert.ok(!(await saved.text()).includes(token));
assert.equal((await server.connection('owner-a')).baseUrl,baseUrl);

state.fetch=()=>new Response('<html>gateway</html>',{headers:{'Content-Type':'text/html'}});
const html=await route.PUT(request({baseUrl,token}));
assert.equal(html.status,502);assert.match((await html.json()).error,/不是.*JSON/);
state.fetch=()=>Response.json(null);
assert.equal((await route.PUT(request({baseUrl,token}))).status,502);
state.fetch=()=>new Response('error code: 1033',{status:530});
const cloudflare=await route.PUT(request({baseUrl,token}));
assert.equal(cloudflare.status,502);assert.match((await cloudflare.json()).error,/HTTP 530/);

state.fetch=()=>Response.json({ok:true,version:'0.1.0'});
state.failWrite=true;
const failed=await route.PUT(request({baseUrl,token}));
assert.equal(failed.status,503);
const error=await failed.json();
assert.equal(error.phase,'保存连接设置');assert.ok(error.code);
assert.ok(!JSON.stringify(logs).includes(token));
state.failWrite=false;
state.row.encrypted_token='{broken';
const corrupted=await route.POST(new Request(origin+'/api/compute/connection',{method:'POST',headers:{Origin:origin}}));
assert.equal(corrupted.status,409);assert.match((await corrupted.json()).error,/密钥无法读取/);
console.log('Connection route regression passed: invalid URL/token/JSON, encrypted save, HTML/null health, HTTP 530, phase diagnostics, corrupt settings and secret-safe logs.');
