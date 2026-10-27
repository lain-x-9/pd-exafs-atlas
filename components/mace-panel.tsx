'use client';
import {useEffect,useState} from 'react';
import {Activity,Download,LoaderCircle,Play,RefreshCw,Square,Upload} from 'lucide-react';
import {CartesianGrid,Line,LineChart,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import type {ComputeJob,ComputeResult} from '@/lib/compute-types';
import {readApiJson} from '@/lib/http-client';
import {stateLabels} from '@/lib/compute-types';

type Summary={atom_count:number;formula:string;fixed_count:number;partial_count:number;movable_count:number};
type Progress={stage:string;step:number;max_steps:number;energy_ev?:number;fmax_ev_a?:number;elapsed_seconds?:number};
type Result=ComputeResult&Summary&{converged:boolean;steps:number;target_fmax:number;fmax_ev_a:number;elapsed_seconds:number;peak_rss_mib:number;fixed_max_displacement_a:number;cell_max_change_a:number;files:string[];history:{step:number;fmax_ev_a:number;energy_ev:number}[]};
type MaceJob=ComputeJob&{progress?:Progress;cancel_requested?:boolean;result?:Result};
async function api<T>(url:string,init?:RequestInit):Promise<T>{
 return readApiJson<T>(await fetch(url,{cache:'no-store',...init}));
}
const download=(id:string,name:string)=>'/api/compute/jobs/'+id+'/file?name='+encodeURIComponent(name)+'&download=1';
const active=(job:ComputeJob)=>['queued','running'].includes(job.state);
const num=(v:number|undefined,d=3)=>typeof v==='number'?v.toFixed(d):'—';

export default function MacePanel({configured,structureJob,onUse,onNearEdge}:{configured:boolean;structureJob?:ComputeJob;onUse:(job:ComputeJob)=>void;onNearEdge?:(id:string,acceptUnconverged:boolean)=>void}){
 const [available,setAvailable]=useState(false);const [checked,setChecked]=useState(false);const [checkError,setCheckError]=useState('');
 const [summary,setSummary]=useState<Summary|null>(null);const [summaryError,setSummaryError]=useState('');
 const [jobs,setJobs]=useState<MaceJob[]>([]);const [selected,setSelected]=useState('');const [error,setError]=useState('');
 const [acceptUnconverged,setAcceptUnconverged]=useState(false);
 useEffect(()=>setAcceptUnconverged(false),[selected]);
 const [steps,setSteps]=useState(100);const [fmax,setFmax]=useState(.05);const [maxstep,setMaxstep]=useState(.05);const [busy,setBusy]=useState('');
 const job=jobs.find(j=>j.id===selected);const result=job?.result;
 const canReuse=!!result&&((result.pbc?.every(Boolean)&&result.files.includes('optimized.vasp'))||(result.pbc?.every(v=>!v)&&result.fixed_count===0&&result.partial_count===0));
 function upsert(value:MaceJob){setJobs(old=>[value,...old.filter(j=>j.id!==value.id)].sort((a,b)=>b.created-a.created));if(!active(value))window.dispatchEvent(new Event('compute-jobs-updated'));}
 async function check(){
  setCheckError('');setChecked(false);
  try{const c=await api<{available:boolean}>('/api/compute/mace');setAvailable(c.available);if(!c.available)setCheckError('服务器尚未找到 MACE 环境或模型。');}
  catch(e){setAvailable(false);setCheckError((e as Error).message);}
  finally{setChecked(true);}
 }
 async function load(){try{const r=await api<{jobs:MaceJob[]}>('/api/compute/jobs');setJobs(r.jobs.filter(j=>j.kind==='mace'));}catch(e){setError((e as Error).message);}}
 useEffect(()=>{if(configured){void check();void load();}else{setAvailable(false);setChecked(false);}},[configured]);
 useEffect(()=>{
  setSummary(null);setSummaryError('');if(!available||structureJob?.state!=='succeeded')return;
  let alive=true;api<Summary>('/api/compute/mace?structure='+structureJob.id).then(s=>{if(alive)setSummary(s);}).catch(e=>{if(alive)setSummaryError(e.message);});
  return()=>{alive=false;};
 },[available,structureJob?.id,structureJob?.state]);
 const pending=jobs.filter(active).map(j=>j.id).sort().join(',');
 useEffect(()=>{
  if(!pending)return;let alive=true;let timer:ReturnType<typeof setTimeout>;
  async function poll(){
   await Promise.all(pending.split(',').map(async id=>{try{const next=await api<MaceJob>('/api/compute/jobs/'+id);if(alive)upsert(next);}catch(e){if(alive)setError((e as Error).message);}}));
   if(alive)timer=setTimeout(poll,2500);
  }
  timer=setTimeout(poll,800);return()=>{alive=false;clearTimeout(timer);};
 },[pending]);
 async function submit(){
  setError('');setBusy('submit');
  try{
   if(!structureJob||!summary)throw Error('请先解析并检查结构');
   if(!Number.isInteger(steps)||steps<1||steps>300||!Number.isFinite(fmax)||fmax<.03||fmax>.2||!Number.isFinite(maxstep)||maxstep<.01||maxstep>.1)throw Error('请检查步数、力阈值和最大位移的范围');
   const created=await api<MaceJob>('/api/compute/mace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({structure_job:structureJob.id,steps,fmax,maxstep,fixed_cell:true,preserve_constraints:true})});
   upsert(created);setSelected(created.id);
  }catch(e){setError((e as Error).message);}finally{setBusy('');}
 }
 async function cancel(){
  if(!job)return;setBusy('cancel');setError('');
  try{upsert(await api<MaceJob>('/api/compute/mace/'+job.id+'/cancel',{method:'POST'}));}
  catch(e){setError((e as Error).message);}finally{setBusy('');}
 }
 async function useResult(){
  if(!job||!result||!canReuse)return;setBusy('use');setError('');
  try{
   const periodic=!!result.pbc?.every(Boolean)&&result.files.includes('optimized.vasp');const name=periodic?'optimized.vasp':'optimized.extxyz';
   const response=await fetch(download(job.id,name));if(!response.ok)throw Error('预优化结构下载失败');
   const form=new FormData();form.set('file',new File([await response.blob()],name));form.set('format',periodic?'vasp':'xyz');
   const parsed=await api<ComputeJob>('/api/compute/jobs?kind=structure',{method:'POST',body:form});
   onUse(parsed);
  }catch(e){setError((e as Error).message);}finally{setBusy('');}
 }
 async function select(id:string){
  setSelected(id);setError('');if(!id)return;
  try{upsert(await api<MaceJob>('/api/compute/jobs/'+id));}catch(e){setError((e as Error).message);}
 }
 return <section className="panel compute-step mace-panel">
  <div className="compute-step-head"><span><Activity size={18}/></span><div><h2>MACE 结构预优化</h2><p>使用已解析结构，保留固定原子与晶胞；与 FEFF/Larch 依次排队运行。</p></div></div>
  {!configured?<p className="compute-placeholder">先在连接设置中连接计算服务器。</p>:<>
   <div className="compute-inline"><span>{available?'MACE-MP-0b2-small · CPU · 1 线程 · 最多 200 原子':checked?'服务器接入尚未就绪':'正在检查服务器接入…'}</span><button className="button" onClick={check}><RefreshCw size={13}/>检查接入</button></div>
   {!available&&checked&&<div className="compute-info"><p>{checkError} 如果服务器已安装 MACE，请安装接入补丁后再次检查。</p><a className="button" href="/downloads/exafs-mace-addon-v1.zip" download><Download size={13}/>下载服务器接入补丁</a><p>补丁包中的说明包含安装命令；保留现有密钥和隧道。</p></div>}
   {available&&<>
    {summary?<div className="compute-structure-summary"><b>{summary.formula}</b><span>{summary.atom_count} 原子</span><span>完全固定 {summary.fixed_count}</span><span>可移动 {summary.movable_count}（其中部分固定 {summary.partial_count}）</span></div>:<p className="compute-placeholder">{summaryError||'上传并解析结构后，显示本次固定设置。'}</p>}
    {summary&&summary.fixed_count===0&&<p className="compute-hint">文件没有完全固定原子；本次将按文件约束优化。CIF 通常不保存 VASP 的固定设置。</p>}
    <div className="compute-fields">
     <label className="compute-field">最大步数（1–300）<input type="number" min={1} max={300} step={1} value={Number.isNaN(steps)?'':steps} onChange={e=>setSteps(e.target.value===''?NaN:Number(e.target.value))}/></label>
     <label className="compute-field">力阈值 / eV·Å⁻¹（0.03–0.2）<input type="number" min={.03} max={.2} step={.01} value={Number.isNaN(fmax)?'':fmax} onChange={e=>setFmax(e.target.value===''?NaN:Number(e.target.value))}/></label>
     <label className="compute-field">单步最大位移 / Å（0.01–0.1）<input type="number" min={.01} max={.1} step={.01} value={Number.isNaN(maxstep)?'':maxstep} onChange={e=>setMaxstep(e.target.value===''?NaN:Number(e.target.value))}/></label>
    </div>
    <div className="compute-bottom-action"><span>原文件独立保留。固定晶胞，沿用输入约束。</span><button className="button primary" disabled={!summary||!!busy} onClick={submit}>{busy==='submit'?<LoaderCircle size={14} className="spin"/>:<Play size={14}/>}提交预优化</button></div>
   </>}
   {!!jobs.length&&<label className="compute-field">MACE 任务记录<select value={selected} onChange={e=>select(e.target.value)}><option value="">选择任务…</option>{jobs.map(j=><option key={j.id} value={j.id}>{stateLabels[j.state]} · {j.label||j.id.slice(0,8)} · {new Date(j.created*1000).toLocaleString('zh-CN')}</option>)}</select></label>}
   {job&&<div className="compute-info"><b>{stateLabels[job.state]}</b><code> · {job.id}</code>
    {job.progress&&<p>{job.progress.stage==='loading'?'正在加载模型':'已完成 '+job.progress.step+' / '+job.progress.max_steps+' 步'} · 最大力 {num(job.progress.fmax_ev_a)} eV/Å · 已用 {num(job.progress.elapsed_seconds,1)} 秒</p>}
    {job.error&&<p role="alert">{job.error}</p>}
    {active(job)&&<button className="button" disabled={busy==='cancel'||job.cancel_requested} onClick={cancel}><Square size={13}/>{job.cancel_requested?'正在取消…':'取消任务'}</button>}
    <a className="button" href={download(job.id,'worker.log')} download><Download size={13}/>运行日志</a>
   </div>}
   {job?.state==='succeeded'&&result&&<>
    <div className="compute-result-label"><b>{result.converged?'已达到本次力阈值':'已完成计算，尚未达到力阈值'}</b><span>候选结构预优化</span></div>
    <div className="compute-metrics">{[['步数',String(result.steps)],['最大力 / eV·Å⁻¹',num(result.fmax_ev_a)],['总耗时 / 秒',num(result.elapsed_seconds,1)],['峰值内存 / MiB',num(result.peak_rss_mib,0)]].map(([label,value])=><div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
    <div style={{height:220}}><ResponsiveContainer width="100%" height="100%"><LineChart data={result.history} margin={{top:15,right:20,left:10,bottom:15}}><CartesianGrid strokeDasharray="3 4"/><XAxis dataKey="step" label={{value:'优化步数',position:'insideBottom',offset:-10}}/><YAxis width={55}/><Tooltip/><Line dataKey="fmax_ev_a" name="最大力 / eV·Å⁻¹" stroke="#367d70" dot={false} isAnimationActive={false}/></LineChart></ResponsiveContainer></div>
    <p className="compute-hint">固定原子最大位移 {num(result.fixed_max_displacement_a,8)} Å；晶胞最大变化 {num(result.cell_max_change_a,8)} Å。</p>
    <div className="compute-inline">{result.files.map(name=><a key={name} className="button" href={download(job.id,name)} download><Download size={13}/>{name}</a>)}<a className="button" href={download(job.id,'result.json')} download>参数与结果 JSON</a></div>
    <details className="compute-warnings" open><summary>结果说明</summary><ul>{result.warnings?.map(w=><li key={w}>{w}</li>)}</ul></details>
    <button className="button" disabled={!!busy||!canReuse} onClick={useResult}><Upload size={14}/>{busy==='use'?'正在重新解析…':'选用此结构并重新解析'}</button><p className="compute-hint">{canReuse?'选用后将此结果重新解析为当前结构；原任务保留。近边计算可使用下方“用于近边理论谱”按钮直接选用。未收敛结构仍作为预优化候选结构。':'当前网页重读格式不能完整保留此结构的周期性或约束，请下载 ASE 轨迹后检查。'}</p>
    {onNearEdge&&<div className="fd-mace-transfer"><p>直接将优化后的三维周期结构交给近边计算；无需手动下载上传，原始结构与优化任务均保留。</p>{!result.converged&&<label className="sl-confirm"><input type="checkbox" checked={acceptUnconverged} onChange={e=>setAcceptUnconverged(e.target.checked)}/>此结果尚未达到力阈值，我确认仅将它作为未收敛候选结构继续计算。</label>}<button className="button primary" disabled={!!busy||!result.pbc?.every(Boolean)||!result.files.includes('optimized.vasp')||!result.converged&&!acceptUnconverged} onClick={()=>onNearEdge(job.id,acceptUnconverged)}><Play size={14}/>用于近边理论谱</button>{!result.pbc?.every(Boolean)&&<p>当前近边引擎需要三维周期晶胞，此结构暂不支持直接使用。</p>}</div>}
   </>}
  </>}
  {error&&<div className="form-error" role="alert">{error}</div>}
 </section>;
}
