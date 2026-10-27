import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { allowedComputeUrl, type ComputeJob, type JobKind } from './compute-types';

export class ComputeError extends Error{constructor(message:string,public status=400){super(message);}}
export const respond=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export function failure(e:unknown,context?:{operation:string;phase:string}){
 if(e instanceof ComputeError)return respond({error:e.message},e.status);
 const code=crypto.randomUUID().slice(0,8);
 const phase=context?.phase||'计算请求';
 const name=typeof(e as {name?:unknown})?.name==='string'?String((e as {name:string}).name).replace(/[^A-Za-z]/g,'').slice(0,40):'UnknownError';
 // Never log error messages, request bodies or raw credentials.
 console.error('exafs_compute_unexpected_failure',{code,operation:context?.operation||'compute',phase,name});
 return respond({error:'处理失败：'+phase+'（诊断编号 '+code+'）。请将这条提示发给维护者。',code,phase},503);
}
export function computeUrl(raw:string){
 try{return allowedComputeUrl(raw);}catch(e){
  throw new ComputeError(e instanceof Error?e.message:'请输入完整的 HTTPS 计算接口地址',400);
 }
}
export async function owner(request?:Request){
  if(request&&request.method!=='GET'){const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)throw new ComputeError('请求来源不匹配',403);}
  const u=await getChatGPTUser();const id=u?.userId||(import.meta.env.DEV?'preview-user':null);
  if(!id)throw new ComputeError('请先使用 ChatGPT 登录',401);
  return id;
}
function keyBytes(){const secret=env.COMPUTE_CONFIG_KEY||(import.meta.env.DEV?'09'.repeat(32):'');if(!/^[a-f0-9]{64}$/i.test(secret))throw new ComputeError('连接设置尚未初始化，请联系站点所有者',503);return Uint8Array.from(secret.match(/.{2}/g)!,h=>parseInt(h,16));}
export async function seal(token:string,userId:string){const key=await crypto.subtle.importKey('raw',keyBytes(),{name:'AES-GCM'},false,['encrypt']);const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(userId)},key,new TextEncoder().encode(token));return JSON.stringify({iv:Array.from(iv),data:Array.from(new Uint8Array(encrypted))});}
export async function connection(userId:string){const row=await env.DB!.prepare('SELECT base_url,encrypted_token,updated_at FROM compute_connections WHERE user_id=?').bind(userId).first<{base_url:string;encrypted_token:string;updated_at:string}>();if(!row)throw new ComputeError('请先连接计算服务器',409);const key=await crypto.subtle.importKey('raw',keyBytes(),{name:'AES-GCM'},false,['decrypt']);let token:string;try{const stored=JSON.parse(row.encrypted_token);token=new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(stored.iv),additionalData:new TextEncoder().encode(userId)},key,new Uint8Array(stored.data)));}catch{throw new ComputeError('连接密钥无法读取，请重新填写连接设置',409);}return {baseUrl:computeUrl(row.base_url),token,updatedAt:row.updated_at};}
export async function remote(baseUrl:string,token:string,path:string,options:RequestInit={}){
  let response:Response;try{response=await fetch(baseUrl+path,{...options,headers:{...Object.fromEntries(new Headers(options.headers)),Authorization:'Bearer '+token},redirect:'manual',signal:AbortSignal.timeout(20000)});}catch(error){
    const timeout=error instanceof Error&&(error.name==='TimeoutError'||error.name==='AbortError');
    const message=(error instanceof Error?error.message:String(error)).replaceAll(token,'[redacted]').slice(0,500);
    console.error('exafs_compute_upstream_failure',{kind:timeout?'timeout':'network',message});
    throw new ComputeError(timeout?'访问计算服务器超过 20 秒，请检查隧道连接后重试':'无法连接计算服务器，请检查隧道和接口进程是否仍在运行',502);
  }
  // Workers supports manual/follow, but rejects redirect:"error" before any network I/O.
  // Reject redirects explicitly so credentials are never sent to a redirected origin.
  if(response.status>=300&&response.status<400){await response.body?.cancel();throw new ComputeError('计算接口返回了重定向，请使用隧道日志中的原始 HTTPS 地址',502);}
  if(!response.ok){const body=await response.text();let message='';try{const data=JSON.parse(body);message=typeof data.detail==='string'?data.detail:Array.isArray(data.detail)?data.detail.map((e:{msg?:string})=>e.msg||'参数无效').slice(0,3).join('；'):typeof data.error==='string'?data.error:'';}catch{}
    if(response.status===401)throw new ComputeError('计算服务器拒绝访问，请核对访问密钥',502);
    throw new ComputeError(message.slice(0,1500)||`计算服务器返回 HTTP ${response.status}`,response.status===404?404:502);}
  return response;
}
export async function ownedJob(userId:string,id:string){if(!/^[a-f0-9]{32}$/.test(id))throw new ComputeError('任务不存在',404);const row=await env.DB!.prepare('SELECT snapshot,label FROM compute_jobs WHERE id=? AND user_id=?').bind(id,userId).first<{snapshot:string;label:string}>();if(!row)throw new ComputeError('任务不存在',404);return {job:JSON.parse(row.snapshot) as ComputeJob,label:row.label};}
export async function saveJob(userId:string,job:ComputeJob,label:string){if(!/^[a-f0-9]{32}$/.test(job.id))throw new ComputeError('计算服务器返回了无效任务编号',502);await env.DB!.prepare("INSERT INTO compute_jobs(id,user_id,kind,label,snapshot,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET snapshot=CASE WHEN json_type(compute_jobs.snapshot, '$.structureSource')='object' THEN json_set(excluded.snapshot, '$.structureSource', json_extract(compute_jobs.snapshot, '$.structureSource')) ELSE excluded.snapshot END WHERE compute_jobs.user_id=excluded.user_id").bind(job.id,userId,job.kind,label,JSON.stringify(job),new Date(job.created*1000).toISOString()).run();}
export function kind(value:string|null):JobKind{if(value!=='structure'&&value!=='feff'&&value!=='fit')throw new ComputeError('未知任务类型');return value;}
