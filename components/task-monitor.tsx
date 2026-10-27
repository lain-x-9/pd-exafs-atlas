'use client';
import {readApiJson} from '@/lib/http-client';
import {useEffect,useRef,useState} from 'react';
import {Download,LoaderCircle,RefreshCw,Maximize2,Minimize2} from 'lucide-react';
import {type ComputeJob,stateLabels,kindLabels} from '@/lib/compute-types';

type Detail={job:ComputeJob;progress:Record<string,unknown>;logs:Record<string,string>;detailed:boolean;checkedAt:string};
const active=(j:ComputeJob)=>j.state==='queued'||j.state==='running';
const stageNames:Record<string,string>={loading:'加载模型',optimizing:'结构优化',preparing:'准备结构与输入文件',native_running:'FDMNES 原生计算',reading_output:'读取并校验理论谱',finished:'整理计算结果',failed:'计算失败'};
export const taskFile=(job:ComputeJob,name:string)=>job.kind==='fdmnes'?'/api/fdmnes?id='+job.id+'&file='+encodeURIComponent(name):'/api/compute/jobs/'+job.id+'/file?name='+encodeURIComponent(name)+'&download=1';
export default function TaskMonitor({job,onUpdate}:{job:ComputeJob;onUpdate?:(job:ComputeJob)=>void}){
 const [detail,setDetail]=useState<Detail|null>(null),[error,setError]=useState(''),[now,setNow]=useState(Date.now()),[refresh,setRefresh]=useState(0);
 const [expanded,setExpanded]=useState(false),[wrap,setWrap]=useState(false),[logsOpen,setLogsOpen]=useState(job.kind==='fdmnes'),[lastLogChange,setLastLogChange]=useState<number|null>(null);
 const observedLog=useRef<string|null>(null);
 const callback=useRef(onUpdate);callback.current=onUpdate;
 useEffect(()=>{observedLog.current=null;setLastLogChange(null);setLogsOpen(job.kind==='fdmnes');},[job.id]);
 useEffect(()=>{
  let alive=true;let timer:ReturnType<typeof setTimeout>;setDetail(null);setError('');
  async function poll(){
   let next=job;
   try{
    const response=await fetch('/api/compute/progress?id='+job.id,{cache:'no-store'});
    const data=await readApiJson<Detail&{error?:string}>(response);if(!response.ok)throw Error(data.error||'进度更新失败');
    if(alive){
     const logText=JSON.stringify(data.logs||{});
     if(observedLog.current!==logText){observedLog.current=logText;setLastLogChange(Date.now());}
     setDetail(data);setError('');next=data.job;callback.current?.(next);
    }
   }catch(e){if(alive)setError((e as Error).message);}
   if(alive&&active(next))timer=setTimeout(poll,3000);
  }
  void poll();return()=>{alive=false;clearTimeout(timer);};
 },[job.id,refresh]);
 useEffect(()=>{if(!active(job))return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[job.state]);
 const current=detail?.job||job,p=detail?.progress||{},stage=String(p.stage||'');
 const seconds=Math.max(0,((current.finished?current.finished*1000:now)-(current.started||current.created)*1000)/1000);
 const duration=seconds>=60?Math.floor(seconds/60)+' 分 '+Math.floor(seconds%60)+' 秒':Math.floor(seconds)+' 秒';
 const quietSeconds=lastLogChange===null?0:Math.max(0,Math.floor((now-lastLogChange)/1000));
 const settings=current.request;
 return <section className="task-monitor" aria-label={kindLabels[current.kind]+'任务进度'}>
  <div className="task-monitor-head"><div><span className={'compute-state '+current.state}>{active(current)&&<LoaderCircle size={13} className="spin"/>}{stateLabels[current.state]}</span><b>{kindLabels[current.kind]}</b></div><button className="button small" onClick={()=>setRefresh(v=>v+1)}><RefreshCw size={13}/>刷新进度</button></div>
  <code className="task-id">{current.id}</code>
  <div className="task-stage"><strong>{current.state==='queued'?'等待前序任务完成':current.state==='running'?(stageNames[stage]||'服务器计算中'):stateLabels[current.state]}</strong><span>{current.state==='queued'?'已等待':'耗时'} {duration}</span></div>
  {active(current)&&<div className="task-indeterminate" role="progressbar" aria-label="计算正在进行" aria-valuetext={current.state==='queued'?'排队中':stageNames[stage]||'计算中'}><i/></div>}
  {current.kind==='mace'&&p.step!=null&&<p>已完成 {String(p.step)} / {String(p.max_steps??current.request.steps)} 步 · 最大力 {typeof p.fmax_ev_a==='number'?p.fmax_ev_a.toFixed(4):'—'} eV/Å</p>}
  {current.kind==='fdmnes'&&<p className="sl-caption">{detail?.detailed?'显示原生计算阶段与日志；FDMNES 未提供可靠的总完成百分比。':'显示任务状态与工作进程日志。升级 FDMNES 扩展 v2 后可查看原生阶段和实时引擎日志。'}</p>}
  {current.kind==='fdmnes'&&<div className="task-run-settings"><b>本次提交的设置</b><span>{settings.method==='finite_difference'?'有限差分全势':settings.method==='green'?'Green 多重散射':'方法未记录'} · 半径 {String(settings.radius??'—')} Å · {settings.scf===true?'启用 SCF':settings.scf===false?'关闭 SCF':'SCF 设置未记录'}</span><span>能量 {String(settings.emin??'—')} 至 {String(settings.emax??'—')} eV · 步长 {String(settings.step??'—')} eV</span></div>}
  {detail&&<small>接口检查：{new Date(detail.checkedAt).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai'})}（不等于原生日志新增）</small>}
  {current.kind==='fdmnes'&&current.state==='running'&&quietSeconds>=60&&<p className="task-log-notice" role="status">当前页面已连续 {Math.floor(quietSeconds/60)} 分 {quietSeconds%60} 秒未观察到日志变化。程序可能正在耗时计算或缓冲输出；也可能遇到异常。仅凭这个计时无法判断卡死，需结合服务器 CPU、内存和输出文件检查。</p>}
  {current.error&&<div className="form-error">{current.error}</div>}
  {error&&<div className="form-error" role="alert">进度更新失败：{error}。服务器上的任务可能仍在运行，请先刷新进度。</div>}
  <details className={'task-live-log'+(expanded?' expanded':'')} open={logsOpen} onToggle={e=>setLogsOpen(e.currentTarget.open)}><summary>查看实时日志（最近内容）</summary><div className="task-log-tools"><span>原始日志 · 等宽显示 · 可横向滚动查看完整表格</span><div><button type="button" className="button small" aria-pressed={wrap} onClick={()=>setWrap(v=>!v)}>{wrap?'关闭自动换行':'自动换行'}</button><button type="button" className="button small" aria-pressed={expanded} onClick={()=>setExpanded(v=>!v)}>{expanded?<Minimize2 size={14}/>:<Maximize2 size={14}/>}<span>{expanded?'收起放大':'放大日志'}</span></button></div></div>{detail&&Object.entries(detail.logs).length?Object.entries(detail.logs).map(([name,text])=><div key={name}><b>{name}</b><pre className={wrap?'wrap':''} tabIndex={0} aria-label={name+' 最近日志'}>{text||'日志尚未输出；原生程序可能仍在初始化或缓冲输出。'}</pre></div>):<p>任务尚未输出日志。</p>}</details>
  <a className="button small" href={taskFile(current,current.kind==='fdmnes'?'fdmnes.log':'worker.log')}><Download size={13}/>下载运行日志</a>
 </section>;
}
