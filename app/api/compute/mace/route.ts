import {ComputeError,connection,failure,ownedJob,owner,remote,respond,saveJob} from '@/lib/compute-server';
import type {ComputeJob} from '@/lib/compute-types';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const user=await owner();const c=await connection(user);
 const structure=new URL(request.url).searchParams.get('structure');
 let path='/v1/mace/capabilities';
 if(structure){const saved=await ownedJob(user,structure);if(saved.job.quickShellSource)throw new ComputeError('QFS 人工计算簇仅用于快速第一壳层，不能作为待优化的样品结构');if(saved.job.kind!=='structure'||saved.job.state!=='succeeded')throw new ComputeError('请先选择已解析的结构');path='/v1/mace/structures/'+structure;}
 const r=await remote(c.baseUrl,c.token,path);return respond(await r.json());
}catch(e){return failure(e);}}
export async function POST(request:Request){try{
 const user=await owner(request);const text=await request.text();if(text.length>6000)throw new ComputeError('参数内容过长');
 const body=JSON.parse(text);const saved=await ownedJob(user,String(body.structure_job||''));
 if(saved.job.quickShellSource)throw new ComputeError('QFS 人工计算簇仅用于快速第一壳层，不能作为待优化的样品结构');if(saved.job.kind!=='structure'||saved.job.state!=='succeeded')throw new ComputeError('请先选择已解析的结构');
 const c=await connection(user);const r=await remote(c.baseUrl,c.token,'/v1/mace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const job=await r.json() as ComputeJob;if(job.kind!=='mace')throw new ComputeError('服务器返回了不同类型的任务',502);
 const label='MACE · '+saved.label;await saveJob(user,job,label);return respond({...job,label},202);
}catch(e){return failure(e);}}
