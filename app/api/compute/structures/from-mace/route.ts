import {z} from 'zod';
import {ComputeError,connection,failure,ownedJob,owner,remote,respond,saveJob} from '@/lib/compute-server';
import type {ComputeJob,StructureSource} from '@/lib/compute-types';
export const dynamic='force-dynamic';
const schema=z.object({mace_job:z.string().regex(/^[a-f0-9]{32}$/),accept_unconverged:z.boolean().default(false)}).strict();
export async function POST(request:Request){try{
 const user=await owner(request),text=await request.text();if(text.length>2000)throw new ComputeError('请求参数过长',413);
 let body:unknown;try{body=JSON.parse(text);}catch{throw new ComputeError('请求参数不是有效 JSON');}
 const parsed=schema.safeParse(body);if(!parsed.success)throw new ComputeError('请选择一个 MACE 任务');
 const saved=await ownedJob(user,parsed.data.mace_job);
 if(saved.job.kind!=='mace')throw new ComputeError('请选择 MACE 优化任务');
 const c=await connection(user),r=await remote(c.baseUrl,c.token,'/v1/jobs/'+saved.job.id),job=await r.json() as ComputeJob;
 if(job.id!==saved.job.id||job.kind!=='mace')throw new ComputeError('服务器任务身份不匹配',502);
 await saveJob(user,job,saved.label);
 if(job.state!=='succeeded'||!job.result)throw new ComputeError('MACE 尚未成功完成，不能使用此结构',409);
 const result=job.result as typeof job.result&{converged?:boolean;files?:string[];fmax_ev_a?:number;target_fmax?:number};
 if(typeof result.converged!=='boolean'||!Number.isFinite(result.fmax_ev_a)||!Number.isFinite(result.target_fmax))throw new ComputeError('MACE 收敛信息不完整，请检查任务结果',502);
 if(!result.converged&&!parsed.data.accept_unconverged)throw new ComputeError('此任务尚未达到力阈值；请明确确认使用未收敛候选结构',409);
 if(!result.pbc?.every(Boolean)||result.pbc.length!==3)throw new ComputeError('当前近边引擎要求三维周期晶胞；此结果不能直接用于近边计算',409);
 if(!result.files?.includes('optimized.vasp'))throw new ComputeError('未找到保留原子顺序和约束的优化结构',409);
 const sourceFile=await remote(c.baseUrl,c.token,`/v1/jobs/${job.id}/files/optimized.vasp`);
 if(Number(sourceFile.headers.get('content-length'))>2*1024*1024)throw new ComputeError('优化结构超过 2 MB',413);
 const bytes=new Uint8Array(await sourceFile.arrayBuffer());if(!bytes.length||bytes.length>2*1024*1024)throw new ComputeError('优化结构为空或超过 2 MB',413);
 if(/^\s*</.test(new TextDecoder().decode(bytes.subarray(0,200))))throw new ComputeError('优化结构接口返回了网页内容',502);
 const filename='MACE_'+job.id+'_optimized.vasp',form=new FormData();form.set('file',new File([bytes],filename));form.set('format','vasp');
 const response=await remote(c.baseUrl,c.token,'/v1/structures',{method:'POST',body:form}),structure=await response.json() as ComputeJob;
 if(structure.kind!=='structure')throw new ComputeError('服务器未返回结构解析任务',502);
 const source:StructureSource={kind:'mace',mace_job:job.id,original_structure_job:String(job.request.structure_job||''),filename,sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join(''),converged:result.converged,fmax_ev_a:result.fmax_ev_a!,target_fmax:result.target_fmax!,created:new Date().toISOString()};
 const derived={...structure,structureSource:source},label='MACE 优化结构 · '+saved.label+' · '+job.id.slice(0,8);
 await saveJob(user,derived,label);return respond({...derived,label},202);
}catch(e){return failure(e,{operation:'mace_structure_transfer',phase:'选用 MACE 优化结构'});}}
