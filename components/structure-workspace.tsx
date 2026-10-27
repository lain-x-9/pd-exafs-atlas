'use client';
import {useEffect,useState} from 'react';
import {Upload,Server,LoaderCircle} from 'lucide-react';
import {readApiJson} from '@/lib/http-client';
import type {ComputeJob} from '@/lib/compute-types';
import MacePanel from './mace-panel';
export default function StructureWorkspace({onConnection,onNearEdge}:{onConnection:()=>void;onNearEdge:(id:string,acceptUnconverged:boolean)=>void}){
 const [configured,setConfigured]=useState(false),[file,setFile]=useState<File|null>(null),[format,setFormat]=useState('vasp'),[job,setJob]=useState<ComputeJob>(),[history,setHistory]=useState<ComputeJob[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function load(){try{
  const [c,j]=await Promise.all([fetch('/api/compute/connection',{cache:'no-store'}),fetch('/api/compute/jobs',{cache:'no-store'})]);
  const connection=await readApiJson<{configured:boolean;error?:string}>(c),jobs=await readApiJson<{jobs:ComputeJob[];error?:string}>(j);if(!c.ok||!j.ok)throw Error(connection.error||jobs.error);
  setConfigured(connection.configured);setHistory(jobs.jobs.filter((v:ComputeJob)=>v.kind==='structure'&&!v.quickShellSource));
 }catch(e){setError((e as Error).message);}}
 useEffect(()=>{void load();const updated=()=>void load();window.addEventListener('compute-connection-updated',updated);return()=>window.removeEventListener('compute-connection-updated',updated);},[]);
 useEffect(()=>{if(!job||!['queued','running'].includes(job.state))return;let alive=true;const timer=setInterval(async()=>{try{const r=await fetch('/api/compute/jobs/'+job.id,{cache:'no-store'}),d=await readApiJson<ComputeJob>(r);if(!r.ok)throw Error(d.error||'结构接口返回错误');if(alive){setJob(d);setHistory(old=>[d,...old.filter(j=>j.id!==d.id)]);}}catch(e){if(alive)setError((e as Error).message);}},2000);return()=>{alive=false;clearInterval(timer);};},[job?.id,job?.state]);
 async function parse(){if(!file)return;setBusy(true);setError('');try{
  const form=new FormData();form.set('file',file);form.set('format',format);
  const r=await fetch('/api/compute/jobs?kind=structure',{method:'POST',body:form}),d=await readApiJson<ComputeJob>(r);if(!r.ok)throw Error(d.error||'结构接口返回错误');setJob(d);setHistory(old=>[d,...old]);
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <div className="structure-workspace"><section className="panel workspace-card"><div className="sl-toolbar"><div><h2>1. 选择待优化结构</h2><p>上传完整结构，沿用文件中的固定原子与周期性。CIF 通常不保存 VASP 固定设置。</p></div><button className="button" onClick={onConnection}><Server size={14}/>服务器连接</button></div>
 <label className="workspace-upload"><Upload size={24}/><b>{file?.name||'选择 CIF、POSCAR / CONTCAR 或 XYZ'}</b><input type="file" onChange={e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>2*1024*1024){setError('结构文件超过 2 MB');return;}setFile(f);setFormat(f.name.toLowerCase().endsWith('.cif')?'cif':f.name.toLowerCase().endsWith('.xyz')?'xyz':'vasp');}}/></label>
 <div className="sl-fields"><label>读取格式<select value={format} onChange={e=>setFormat(e.target.value)}><option value="vasp">VASP / POSCAR / CONTCAR</option><option value="cif">CIF</option><option value="xyz">XYZ（非周期）</option></select></label><label>或选择已解析结构<select value={job?.id||''} onChange={e=>setJob(history.find(j=>j.id===e.target.value))}><option value="">请选择…</option>{history.map(j=><option key={j.id} value={j.id}>{j.label||j.id.slice(0,10)} · {j.result?.formula||j.state}</option>)}</select></label></div>
 <button className="button primary" disabled={!configured||!file||busy||!!job&&['queued','running'].includes(job.state)} onClick={parse}>{busy?<LoaderCircle size={14} className="spin"/>:<Upload size={14}/>}上传并解析</button>
 {!configured&&<p className="sl-caption">先到“服务器连接”保存计算接口设置。</p>}
 {job&&<p className="sl-info">结构解析：{job.state==='succeeded'?'完成':job.state==='queued'?'排队中':job.state==='running'?'运行中':job.error||job.state} · {job.result?.formula} · {job.result?.atom_count} 原子</p>}
 {error&&<div className="form-error">{error}</div>}</section>
 <MacePanel onNearEdge={onNearEdge} configured={configured} structureJob={job} onUse={next=>{setJob(next);setHistory(old=>[next,...old]);}}/>
 </div>;
}
