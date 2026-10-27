import {ComputeError,connection,failure,ownedJob,owner,remote,respond,saveJob} from '@/lib/compute-server';
import type {ComputeJob} from '@/lib/compute-types';
export const dynamic='force-dynamic';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{
 const user=await owner(request);const {id}=await params;const saved=await ownedJob(user,id);
 if(saved.job.kind!=='mace')throw new ComputeError('请选择 MACE 任务');
 const c=await connection(user);const r=await remote(c.baseUrl,c.token,'/v1/mace/jobs/'+id+'/cancel',{method:'POST'});
 const job=await r.json() as ComputeJob;await saveJob(user,job,saved.label);return respond({...job,label:saved.label});
}catch(e){return failure(e);}}
