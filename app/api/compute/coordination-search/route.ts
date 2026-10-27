import {env} from 'cloudflare:workers';
import {ComputeError,connection,failure,ownedJob,owner,remote,respond,saveJob} from '@/lib/compute-server';
import {searchSchema,searchPlan,validateSearch,trialConfig,trialResult,type SearchRecord} from '@/lib/coordination-search';
import type {ComputeJob} from '@/lib/compute-types';
export const dynamic='force-dynamic';
async function ensure(){await env.DB!.prepare('CREATE TABLE IF NOT EXISTS coordination_searches (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,snapshot TEXT NOT NULL,state TEXT NOT NULL,lock_at INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL)').run();await env.DB!.prepare("CREATE UNIQUE INDEX IF NOT EXISTS coordination_one_active ON coordination_searches(user_id) WHERE state='running'").run();}
async function read(user:string,id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw new ComputeError('搜索记录不存在',404);const row=await env.DB!.prepare('SELECT snapshot,lock_at FROM coordination_searches WHERE id=? AND user_id=?').bind(id,user).first<{snapshot:string;lock_at:number}>();if(!row)throw new ComputeError('搜索记录不存在',404);return {record:JSON.parse(row.snapshot) as SearchRecord,lock:row.lock_at};}
export async function GET(request:Request){try{const user=await owner();await ensure();const id=new URL(request.url).searchParams.get('id');if(id){const r=await read(user,id);return respond({record:r.record,locked:r.lock>0});}const rows=await env.DB!.prepare('SELECT snapshot FROM coordination_searches WHERE user_id=? ORDER BY created DESC LIMIT 30').bind(user).all<{snapshot:string}>();return respond({records:rows.results.map(x=>{const r=JSON.parse(x.snapshot) as SearchRecord;return {id:r.id,created:r.created,state:r.state,filename:r.filename,element:r.input.element,done:r.results.length,total:r.plan.length};})});}catch(e){return failure(e);}}
export async function POST(request:Request){let locked:{id:string;user:string;stamp:number;record:SearchRecord}|undefined;let submitting=false;try{
 const user=await owner(request);await ensure();
 if(request.headers.get('content-type')?.includes('multipart/form-data')){
  if(Number(request.headers.get('content-length')||0)>9*1024*1024)throw new ComputeError('上传过大',413);
  const form=await request.formData(),file=form.get('file'),raw=String(form.get('config')||'');
  if(!(file instanceof File)||!file.size||file.size>8*1024*1024||raw.length>40000)throw new ComputeError('请选择不超过 8 MB 的派生 χ(k) 与有效参数');
  const parsed=searchSchema.safeParse(JSON.parse(raw));if(!parsed.success)throw new ComputeError('搜索参数无效：'+parsed.error.issues[0]?.message);
  const input=parsed.data,parent=await ownedJob(user,input.feff_job);
  if(parent.job.kind!=='feff'||parent.job.state!=='succeeded'||parent.job.result?.absorber_element!=='Pd'||parent.job.request.edge!=='K')throw new ComputeError('首版仅支持已完成的 Pd K 边 FEFF 路径');
  try{validateSearch(input,parent.job.result.paths||[]);}catch(e){throw new ComputeError((e as Error).message);}
  if(parent.job.quickShellSource&&input.target!==parent.job.quickShellSource.target)throw new ComputeError('QFS 搜索只能使用已核验的最近邻路径');
  if(input.kmax>Number(parent.job.request.kmax))throw new ComputeError('拟合 k 上限超过 FEFF 计算范围');
  let plan;try{plan=searchPlan(input);}catch(e){throw new ComputeError((e as Error).message);}
  const existing=await env.DB!.prepare("SELECT id FROM coordination_searches WHERE user_id=? AND state='running'").bind(user).first();if(existing)throw new ComputeError('已有未结束的搜索，请继续或停止该搜索',409);
  const bytes=await file.arrayBuffer(),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const record:SearchRecord={version:1,id:crypto.randomUUID(),created:new Date().toISOString(),state:'running',input,filename:file.name.slice(0,180),sha256,plan,results:[],feffSource:{label:parent.label,request:parent.job.request,quickShellSource:parent.job.quickShellSource}};
  await env.BUCKET!.put('coordination/'+record.id+'.chi',bytes);
  try{await env.DB!.prepare('INSERT INTO coordination_searches(id,user_id,snapshot,state,created) VALUES(?,?,?,?,?)').bind(record.id,user,JSON.stringify(record),record.state,record.created).run();}catch{await env.BUCKET!.delete('coordination/'+record.id+'.chi');throw new ComputeError('已有搜索正在创建，请刷新记录',409);}
  return respond({record},201);
 }
 if(Number(request.headers.get('content-length')||0)>2000)throw new ComputeError('请求过大');
 const body=await request.json() as {id:string;action:string};if(!['advance','stop'].includes(body.action))throw new ComputeError('未知操作');
 const {record,lock}=await read(user,body.id);
 if(record.state!=='running')return respond({record});
 if(lock){if(Date.now()-lock<60000)throw new ComputeError('搜索正在处理，请稍候',409);record.state='interrupted';record.error='上次请求的提交状态无法确认。为避免重复拟合，搜索已中断；请检查普通任务记录后再新建搜索。';await env.DB!.prepare('UPDATE coordination_searches SET snapshot=?,state=?,lock_at=0 WHERE id=? AND user_id=? AND lock_at=?').bind(JSON.stringify(record),record.state,record.id,user,lock).run();return respond({record});}
 const stamp=Date.now();const acquired=await env.DB!.prepare("UPDATE coordination_searches SET lock_at=? WHERE id=? AND user_id=? AND lock_at=0 AND state='running'").bind(stamp,record.id,user).run();if(!acquired.meta.changes)throw new ComputeError('另一页面正在推进搜索',409);
 locked={id:record.id,user,stamp,record};
 if(body.action==='stop'){record.state='stopped';record.error=record.current?'已停止后续搜索；已提交的拟合仍在服务器执行，可从任务记录查看。':'已停止后续搜索。';}
 else{
  const c=await connection(user);
  if(record.current){const saved=await ownedJob(user,record.current);let job=saved.job;if(!['succeeded','failed','interrupted'].includes(job.state)){job=await (await remote(c.baseUrl,c.token,'/v1/jobs/'+record.current)).json() as ComputeJob;if(job.id!==record.current||job.kind!=='fit')throw new ComputeError('任务身份不匹配',502);await saveJob(user,job,saved.label);}
   if(['succeeded','failed','interrupted'].includes(job.state)){record.results.push(trialResult(record.input,record.plan[record.results.length],job));delete record.current;}
  }
  if(!record.current){if(record.results.length>=record.plan.length)record.state='completed';else{
   const object=await env.BUCKET!.get('coordination/'+record.id+'.chi');if(!object)throw new ComputeError('搜索输入副本不可读取',503);
   const form=new FormData();form.set('file',new File([await object.arrayBuffer()],record.filename));form.set('config',JSON.stringify(trialConfig(record.input,record.plan[record.results.length])));
   submitting=true;const job=await (await remote(c.baseUrl,c.token,'/v1/fits',{method:'POST',body:form})).json() as ComputeJob;if(job.kind!=='fit')throw new ComputeError('拟合任务类型不匹配',502);record.current=job.id;await saveJob(user,job,'配位搜索 · '+record.input.element+' · '+record.filename);submitting=false;
  }}
 }
 await env.DB!.prepare('UPDATE coordination_searches SET snapshot=?,state=?,lock_at=0 WHERE id=? AND user_id=? AND lock_at=?').bind(JSON.stringify(record),record.state,record.id,user,stamp).run();locked=undefined;return respond({record});
 }catch(e){if(locked){const r=locked.record;if(submitting){r.state='interrupted';r.error='拟合提交结果未能确认，请检查任务记录；搜索已中断，避免自动重复提交。';}await env.DB!.prepare('UPDATE coordination_searches SET snapshot=?,state=?,lock_at=0 WHERE id=? AND user_id=? AND lock_at=?').bind(JSON.stringify(r),r.state,locked.id,locked.user,locked.stamp).run();}return failure(e);}}
