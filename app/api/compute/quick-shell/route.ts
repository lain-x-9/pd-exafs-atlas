import {env} from 'cloudflare:workers';
import {ComputeError,connection,failure,ownedJob,owner,remote,respond,saveJob} from '@/lib/compute-server';
import {quickShellSchema,quickShellSource,quickShellPoscar,quickShellFeff,quickShellPath,type QuickShellRecord} from '@/lib/quick-shell';
import type {ComputeJob} from '@/lib/compute-types';
export const dynamic='force-dynamic';
async function ensure(){await env.DB!.prepare('CREATE TABLE IF NOT EXISTS quick_shell_jobs(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,snapshot TEXT NOT NULL,lock_at INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL)').run();}
async function read(user:string,id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw new ComputeError('快速壳层记录不存在',404);const row=await env.DB!.prepare('SELECT snapshot,lock_at FROM quick_shell_jobs WHERE id=? AND user_id=?').bind(id,user).first<{snapshot:string;lock_at:number}>();if(!row)throw new ComputeError('快速壳层记录不存在',404);return {record:JSON.parse(row.snapshot) as QuickShellRecord,lock:row.lock_at};}
async function write(user:string,r:QuickShellRecord,stamp:number){await env.DB!.prepare('UPDATE quick_shell_jobs SET snapshot=?,lock_at=0 WHERE id=? AND user_id=? AND lock_at=?').bind(JSON.stringify(r),r.id,user,stamp).run();}
export async function GET(request:Request){try{const user=await owner();await ensure();const id=new URL(request.url).searchParams.get('id');if(id)return respond({record:(await read(user,id)).record});const rows=await env.DB!.prepare('SELECT snapshot FROM quick_shell_jobs WHERE user_id=? ORDER BY created DESC LIMIT 30').bind(user).all<{snapshot:string}>();return respond({records:rows.results.map(r=>JSON.parse(r.snapshot))});}catch(e){return failure(e);}}
export async function POST(request:Request){let held:{user:string;record:QuickShellRecord;stamp:number}|undefined;let submitting=false;try{
 const user=await owner(request);await ensure();const text=await request.text();if(text.length>2000)throw new ComputeError('参数过长');let body;try{body=JSON.parse(text);}catch{throw new ComputeError('参数无效');}
 const c=await connection(user);let r:QuickShellRecord;const stamp=Date.now();
 if(body.action==='create'){
  const parsed=quickShellSchema.safeParse(body.input);if(!parsed.success)throw new ComputeError('请选择配位元素、1.3–3.0 Å 的名义最近邻距离，并确认仅用于第一壳层');
  r={id:crypto.randomUUID(),created:new Date().toISOString(),input:parsed.data,state:'structure'};
  await env.DB!.prepare('INSERT INTO quick_shell_jobs(id,user_id,snapshot,lock_at,created) VALUES(?,?,?,?,?)').bind(r.id,user,JSON.stringify(r),stamp,r.created).run();held={user,record:r,stamp};
  const form=new FormData();form.set('file',new File([quickShellPoscar(r.input)],'QFS_artificial_scaffold.vasp'));form.set('format','vasp');
  submitting=true;const j=await (await remote(c.baseUrl,c.token,'/v1/structures',{method:'POST',body:form})).json() as ComputeJob;
  if(j.kind!=='structure')throw new ComputeError('计算服务器未返回快速壳层输入任务',502);r.structure=j.id;
  await saveJob(user,{...j,quickShellSource:quickShellSource(r.input)},'QFS 人工计算簇 · 非样品结构 · Pd–'+r.input.scatterer);submitting=false;
 }else if(body.action==='advance'){
  const saved=await read(user,String(body.id||''));r=saved.record;
  if(['ready','failed','interrupted'].includes(r.state))return respond({record:r});
  if(saved.lock){if(Date.now()-saved.lock<60000)throw new ComputeError('快速路径正在处理，请稍候',409);r.state='interrupted';r.error='上次提交状态未知，请检查任务记录；为避免重复计算，未自动重发。';await write(user,r,saved.lock);return respond({record:r});}
  const lock=await env.DB!.prepare('UPDATE quick_shell_jobs SET lock_at=? WHERE id=? AND user_id=? AND lock_at=0').bind(stamp,r.id,user).run();if(!lock.meta.changes)throw new ComputeError('另一页面正在处理此路径',409);held={user,record:r,stamp};
  const id=r.state==='structure'?r.structure:r.feff;if(!id)throw new ComputeError('快速路径的任务编号缺失',502);
  const original=await ownedJob(user,id);const job=await (await remote(c.baseUrl,c.token,'/v1/jobs/'+id)).json() as ComputeJob;
  if(job.id!==id||job.kind!==(r.state==='structure'?'structure':'feff'))throw new ComputeError('计算任务身份不匹配',502);
  job.quickShellSource=original.job.quickShellSource||quickShellSource(r.input);
  if(['failed','interrupted'].includes(job.state)){await saveJob(user,job,original.label);r.state='failed';r.error=job.error||'快速路径计算失败，请检查日志';}
  else if(job.state==='succeeded'&&r.state==='structure'){
   let config;try{config=quickShellFeff(r.input,job);}catch(e){throw new ComputeError((e as Error).message,502);}
   await saveJob(user,job,original.label);submitting=true;
   const fj=await (await remote(c.baseUrl,c.token,'/v1/feff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(config)})).json() as ComputeJob;
   if(fj.kind!=='feff')throw new ComputeError('计算服务器未返回快速路径任务',502);r.feff=fj.id;r.state='feff';
   await saveJob(user,{...fj,quickShellSource:quickShellSource(r.input)},'QFS 快速第一壳层 · Pd–'+r.input.scatterer);submitting=false;
  }else if(job.state==='succeeded'&&r.state==='feff'){
   let path;try{path=quickShellPath(r.input,job.result?.paths||[]);}catch(e){await saveJob(user,job,original.label);r.state='failed';r.error=(e as Error).message;}
   if(path&&job.result){job.quickShellSource={...quickShellSource(r.input),target:path.filename};job.result={...job.result,paths:[path],warnings:[...(job.result.warnings||[]),'QFS 人工岩盐计算簇，仅用于第一壳层近似；不是预测或确认的样品结构。','几何简并度保留为 6；配位搜索使用有效 N 替代该数值，不能把 6 当成实验配位数。']};await saveJob(user,job,original.label);r.state='ready';}
  }else await saveJob(user,job,original.label);
 }else throw new ComputeError('未知操作');
 await write(user,r,stamp);held=undefined;return respond({record:r});
 }catch(e){if(held){if(submitting){held.record.state='interrupted';held.record.error='计算提交状态未确认，已中断自动推进。请检查任务记录，避免重复提交。';}await write(held.user,held.record,held.stamp);}return failure(e);}}
