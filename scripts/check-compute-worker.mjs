// Exercise the real outbound function in workerd, with isolated mock HTTP origins.
import assert from 'node:assert/strict';
import {readFileSync,realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const wranglerRequire=createRequire(realpathSync(new URL('../node_modules/wrangler/package.json',import.meta.url)));
const {Miniflare}=wranglerRequire('miniflare');
const source=readFileSync(new URL('../lib/compute-server.ts',import.meta.url),'utf8');
const errorClass=source.slice(source.indexOf('export class ComputeError'),source.indexOf('export const respond'));
const remoteFunction=source.slice(source.indexOf('export async function remote'),source.indexOf('export async function ownedJob'));
const token='fixture-service-token-never-a-production-secret';
const calls=[];
const outboundService=async request=>{
  calls.push(request.url);
  const url=new URL(request.url);assert.equal(url.origin,'https://fixture.trycloudflare.com');
  assert.equal(request.headers.get('authorization'),'Bearer '+token);
  if(url.pathname==='/health')return Response.json({ok:true,version:'0.1.0'});
  const status=Number(url.pathname.replace('/redirect-',''));
  return new Response(null,{status,headers:{location:'https://unexpected-origin.example/health'}});
};
const handler=`export default {async fetch(request){
  const path=new URL(request.url).pathname;
  try {const upstream=await remote('https://fixture.trycloudflare.com',${JSON.stringify(token)},path);return Response.json(await upstream.json());}
  catch(error){return Response.json({error:error.message},{status:error.status||500});}
}}`;
const script=ts.transpileModule(errorClass+remoteFunction+handler,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],outboundService,cf:false,script});
try{
  const success=await mf.dispatchFetch('http://local.test/health');assert.equal(success.status,200);assert.equal((await success.json()).ok,true);
  for(const status of [301,302,303,307,308]){const response=await mf.dispatchFetch('http://local.test/redirect-'+status);assert.equal(response.status,502);assert.match((await response.json()).error,/重定向/);}
  assert.equal(calls.length,6);
  console.log('workerd regression passed: authenticated health request succeeds and all redirects are rejected without forwarding credentials.');
}finally{await mf.dispose();}
