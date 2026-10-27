import {env} from 'cloudflare:workers';
import {owner,ownedJob,respond,failure,ComputeError} from '@/lib/compute-server';
import {caseSchema,compareExafs,compareXanes,type ResearchCase,type FrozenTarget} from '@/lib/research-workflow';
import type {SpectraCollection} from '@/lib/spectra';
export const dynamic='force-dynamic';
async function ensure(){await env.DB!.prepare('CREATE TABLE IF NOT EXISTS research_cases(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,object_key TEXT NOT NULL,summary TEXT NOT NULL,revision INTEGER NOT NULL,created TEXT NOT NULL)').run();}
async function load(user:string,id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw new ComputeError('分析任务不存在',404);const row=await env.DB!.prepare('SELECT object_key,revision FROM research_cases WHERE id=? AND user_id=?').bind(id,user).first<{object_key:string;revision:number}>();if(!row)throw new ComputeError('分析任务不存在',404);const o=await env.BUCKET!.get(row.object_key);if(!o)throw new ComputeError('任务快照暂不可读取',503);return {record:await o.json<ResearchCase>(),row};}
export async function GET(request:Request){try{const user=await owner();await ensure();const id=new URL(request.url).searchParams.get('id');if(id)return respond({record:(await load(user,id)).record});const rows=await env.DB!.prepare('SELECT summary FROM research_cases WHERE user_id=? ORDER BY created DESC LIMIT 100').bind(user).all<{summary:string}>();return respond({records:rows.results.map(r=>JSON.parse(r.summary))});}catch(e){return failure(e);}}
export async function POST(request:Request){try{const user=await owner(request);await ensure();const text=await request.text();if(text.length>16000)throw new ComputeError('任务设置过长',413);let input;try{input=caseSchema.parse(JSON.parse(text));}catch(e){throw new ComputeError('请核对任务名称、来源、候选模型及判断说明：'+((e as {issues?:{message:string}[]}).issues?.[0]?.message||'格式无效'));}
 const previous=input.id?(await load(user,input.id)).record:null;
 if(previous&&previous.revision!==input.revision)throw new ComputeError('任务已在另一页面更新，请重新读取',409);
 if(previous&&previous.kind!==input.kind)throw new ComputeError('任务类型不可改写，请新建另一类任务');
 let target:FrozenTarget|null=null;
 if(input.target){
  const ref=input.target;
  if(previous?.frozenTarget&&JSON.stringify(previous.target)===JSON.stringify(ref))target=previous.frozenTarget;
  else{const row=await env.DB!.prepare('SELECT object_key,revision FROM spectra_collections WHERE id=? AND user_id=?').bind(ref.collectionId,user).first<{object_key:string;revision:number}>();if(!row)throw new ComputeError('实验文件不存在',404);if(row.revision!==ref.revision)throw new ComputeError('实验谱已更新，请重新读取后关联',409);const o=await env.BUCKET!.get(row.object_key);if(!o)throw new ComputeError('实验谱暂不可读取',503);const c=await o.json<SpectraCollection>(),s=c.spectra.find(s=>s.id===ref.spectrumId);if(!s)throw new ComputeError('文件中没有目标谱');target={...ref,sha256:c.sha256,collectionName:c.name,example:c.example,spectrum:s};}
 }
 const models=[];for(const id of input.models){const saved=await ownedJob(user,id),j={...saved.job,label:saved.label};if(j.kind!=='structure'||j.state!=='succeeded'||j.quickShellSource)throw new ComputeError('请选择真实候选结构的已完成解析任务；QFS 人工簇单独保留');models.push(j);}
 const theory=[];for(const id of input.theoryJobs){const saved=await ownedJob(user,id),j={...saved.job,label:saved.label};if(j.kind!=='fdmnes'||j.state!=='succeeded'||!input.models.includes(String(j.request.structure_job)))throw new ComputeError('预测谱须计算完成，并来自本任务已关联的结构');theory.push(j);}
 const fits=[];for(const id of input.fitJobs){const saved=await ownedJob(user,id),j={...saved.job,label:saved.label};if(j.kind!=='fit'||j.state!=='succeeded')throw new ComputeError('请选择已完成的 EXAFS 拟合');const parent=(await ownedJob(user,String(j.request.feff_job))).job;if(input.kind!=='experiment'&&!input.models.includes(String(parent.request.structure_job)))throw new ComputeError('EXAFS 拟合须来自本任务已关联的候选结构');fits.push(j);}
 if(input.kind==='prediction'&&fits.length)throw new ComputeError('结构预测任务不关联实验拟合，请另建验证任务');
 if(input.decision==='supports'&&(!target||(!fits.length&&!theory.length)))throw new ComputeError('支持某模型需要实验目标与关联分析结果');
 const created=previous?.created||new Date().toISOString(),id=previous?.id||crypto.randomUUID(),revision=(previous?.revision||0)+1;
 const record:ResearchCase={...input,id,revision,created,updated:new Date().toISOString(),frozenTarget:target,modelRecords:models,fitRecords:fits,theoryRecords:theory,exafs:compareExafs(fits,!!target&&input.fitTargetConfirmed),xanes:compareXanes(target,theory)};
 const json=JSON.stringify(record);if(json.length>16*1024*1024)throw new ComputeError('任务快照超过 16 MB，请减少关联结果',413);
 const key='research-cases/'+id+'/'+crypto.randomUUID()+'.json';await env.BUCKET!.put(key,json,{httpMetadata:{contentType:'application/json'}});
 const summary=JSON.stringify({id,revision,kind:record.kind,name:record.name,decision:record.decision,updated:record.updated,target:target?.spectrum.label||null,models:models.length});
 try{if(previous){const changed=await env.DB!.prepare('UPDATE research_cases SET object_key=?,summary=?,revision=? WHERE id=? AND user_id=? AND revision=?').bind(key,summary,revision,id,user,input.revision).run();if(!changed.meta.changes)throw new ComputeError('版本冲突，请重新读取任务',409);}else await env.DB!.prepare('INSERT INTO research_cases(id,user_id,object_key,summary,revision,created) VALUES(?,?,?,?,?,?)').bind(id,user,key,summary,revision,created).run();}catch(e){await env.BUCKET!.delete(key);throw e;}
 return respond({record},previous?200:201);
 }catch(e){return failure(e);}}
