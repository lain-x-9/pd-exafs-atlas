'use client';
import {readApiJson} from '@/lib/http-client';
import {useEffect,useState} from 'react';
import {Download,RefreshCw} from 'lucide-react';
import {type ComputeJob,kindLabels,stateLabels} from '@/lib/compute-types';
import {resultNature} from '@/lib/research-workflow';
import TaskMonitor,{taskFile} from './task-monitor';
export default function TaskCenter(){
 const [jobs,setJobs]=useState<ComputeJob[]>([]),[selected,setSelected]=useState(''),[kind,setKind]=useState('all'),[error,setError]=useState('');
 async function load(){
  setError('');try{const r=await fetch('/api/compute/jobs',{cache:'no-store'}),d=await readApiJson<{jobs:ComputeJob[];error?:string}>(r);if(!r.ok)throw Error(d.error);setJobs(d.jobs);setSelected(old=>old||d.jobs[0]?.id||'');}catch(e){setError((e as Error).message);}
 }
 useEffect(()=>{void load();},[]);
 const shown=jobs.filter(j=>kind==='all'||j.kind===kind),job=shown.find(j=>j.id===selected)||shown[0];
 return <div className="task-center"><section className="panel workspace-card"><div className="sl-toolbar"><div><h2>全部计算任务</h2><p>结构解析、MACE、FDMNES 和 EXAFS 任务集中查看。切换页面不会停止服务器计算。</p></div><button className="button" onClick={load}><RefreshCw size={14}/>刷新任务列表</button></div><label>任务类型<select value={kind} onChange={e=>{setKind(e.target.value);setSelected('');}}><option value="all">全部计算</option>{Object.entries(kindLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
 {error&&<div className="form-error">{error}</div>}
 <div className="task-center-grid"><div className="task-list">{shown.map(j=><button key={j.id} className={job?.id===j.id?'chosen':''} onClick={()=>setSelected(j.id)}><div><b>{kindLabels[j.kind]}</b><span className={'compute-state '+j.state}>{stateLabels[j.state]}</span></div><strong>{j.label||j.id}</strong><small>{resultNature(j)}</small><small>{new Date(j.created*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})} · {j.id.slice(0,10)}</small></button>)}{!shown.length&&<p className="sl-caption">当前没有此类网页任务。终端直接创建且未登记到网站的任务不在此列表中。</p>}</div><div>{job?<><TaskMonitor key={job.id} job={job} onUpdate={next=>setJobs(old=>old.map(j=>j.id===next.id?next:j))}/><details className="panel workspace-card"><summary>本次实际提交的计算参数</summary><pre>{JSON.stringify(job.request,null,2)}</pre></details>{job.state==='succeeded'&&<div className="task-downloads">{['result.json',...((job.result as {files?:string[]})?.files||[])].map(name=><a key={name} className="button small" href={taskFile(job,name)}><Download size={13}/>{name}</a>)}</div>}</>:<p className="compute-placeholder">选择一个任务查看进度、参数和结果。</p>}</div></div></section></div>;
}
