import {ComputeError,connection,failure,ownedJob,owner,remote,respond,saveJob} from '@/lib/compute-server';
import type {ComputeJob} from '@/lib/compute-types';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const user=await owner(),id=new URL(request.url).searchParams.get('id')||'';
 const saved=await ownedJob(user,id),c=await connection(user);
 let job=saved.job;
 if(job.state==='queued'||job.state==='running'){
  const r=await remote(c.baseUrl,c.token,'/v1/jobs/'+id);const fresh=await r.json() as ComputeJob;
  if(fresh.id!==id||fresh.kind!==job.kind)throw new ComputeError('服务器任务身份不匹配',502);
  job={...fresh,structureSource:saved.job.structureSource};await saveJob(user,job,saved.label);
 }
 if(job.kind==='fdmnes'){
  try{
   const r=await remote(c.baseUrl,c.token,'/v1/fdmnes/'+id+'/progress');
   const details=await r.json() as {progress?:Record<string,unknown>;logs?:Record<string,string>};
   return respond({job:{...job,label:saved.label},progress:details.progress||{},logs:details.logs||{},detailed:true,precise_percent:false,checkedAt:new Date().toISOString()});
  }catch(e){if(!(e instanceof ComputeError&&e.status===404))throw e;}
 }
 const log=await remote(c.baseUrl,c.token,'/v1/jobs/'+id+'/log');
 return respond({job:{...job,label:saved.label},progress:(job as ComputeJob&{progress?:Record<string,unknown>}).progress||{},logs:{'worker.log':await log.text()},detailed:job.kind!=='fdmnes',precise_percent:false,checkedAt:new Date().toISOString()});
}catch(e){return failure(e,{operation:'task_progress',phase:'读取任务进度与日志'});}}
