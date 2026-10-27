import {z} from 'zod';
import {fitSanity,type ComputeJob,type PathRow} from './compute-types.ts';
const param=z.object({value:z.number().finite(),min:z.number().finite(),max:z.number().finite(),vary:z.boolean()}).refine(p=>p.min<p.max&&p.value>=p.min&&p.value<=p.max,'参数初值须在有效边界内');
export const searchSchema=z.object({
 feff_job:z.string().regex(/^[a-f0-9]{32}$/),target:z.string(),element:z.string().regex(/^[A-Z][a-z]?$/),
 kmin:z.number().min(0).max(20),kmax:z.number().positive().max(20),rmin:z.number().min(0).max(5),rmax:z.number().positive().max(6),kweight:z.number().int().min(1).max(3),dk:z.number().positive().max(5),window:z.enum(['hanning','kaiser']),
 s02:param,e0:param,paths:z.array(z.object({filename:z.string(),deltar:param,sigma2:param,coordination:param.nullable()})).min(1).max(12),
 nmax:z.number().min(1).max(16),step:z.union([z.literal(.5),z.literal(1)]),s02Delta:z.number().min(0).max(.2),amplitudeSource:z.enum(['standard','assumed']),amplitudeNote:z.string().trim().min(5).max(1000),
 data_kind:z.enum(['experimental_chi_k','synthetic_test']),provenance:z.string().trim().min(5).max(2000),paths_reviewed:z.literal(true),
});
export type SearchInput=z.infer<typeof searchSchema>;
export function searchReadiness(candidate:unknown,rows:PathRow[],state:{demo:boolean;connected:boolean;feffReady:boolean;fileName:string;reviewed:boolean}){
 const issues:string[]=[];
 if(state.demo)issues.push('当前为教学模式，请切换到研究模式。');
 if(!state.fileName)issues.push('尚未选择可用 χ(k)：请在步骤 00 选择文件内的具体目标谱；仅选文件不算完成选谱。');
 if(!state.connected)issues.push('计算服务器尚未连接：请打开页面上方的连接设置，填写当前有效接口地址并测试保存。');
 if(!state.feffReady)issues.push('尚未选择已完成的 Pd K 边 FEFF 路径：无 CIF 时先使用上方“快速第一壳层”；也可选择已有结果，或完成步骤 01–02。');
 const parsed=searchSchema.safeParse(candidate);
 if(!parsed.success){const labels:Record<string,string>={target:'目标配位壳层',element:'目标配位壳层',feff_job:'FEFF 路径任务',amplitudeNote:'振幅来源与模型依据（至少 5 个字符）',provenance:'步骤 04 的样品与谱来源（至少 5 个字符）',data_kind:'步骤 04 的数据属性',nmax:'N 上限',step:'扫描步长',s02Delta:'S₀² 敏感性范围',s02:'步骤 04 的 S₀² 参数',e0:'步骤 04 的 ΔE₀ 参数',paths:'目标路径与模型',kmin:'k 起点',kmax:'k 终点',rmin:'R 起点',rmax:'R 终点',dk:'窗宽 dk'};for(const issue of parsed.error.issues){issues.push('请填写或核对：'+(labels[String(issue.path[0])]||String(issue.path[0]))+'。');}}
 else if(state.feffReady){try{validateSearch(parsed.data,rows);}catch(e){issues.push((e as Error).message);}}
 if(!state.reviewed)issues.push('请勾选本搜索区的模型与参数确认。');
 return {issues:[...new Set(issues)],input:parsed.success?parsed.data:null};
}
export type Trial={label:string;group:'free'|'profile'|'s02'|'window';n:number|null;start:number;s02:number;kmin:number;kmax:number};
export type TrialResult={trial:Trial;job:string;state:string;error?:string;rfactor:number|null;n:number|null;stderr:number|null;distance:number|null;warnings:string[]};
export type SearchRecord={version:1;id:string;created:string;state:'running'|'completed'|'stopped'|'interrupted';input:SearchInput;filename:string;sha256:string;plan:Trial[];results:TrialResult[];current?:string;error?:string;feffSource:{label:string;request:Record<string,unknown>;quickShellSource?:import('./quick-shell').QuickShellSource};};
export function neighborElement(p:PathRow){return p.nleg===2&&p.geometry?.length===2?String(p.geometry[1][0]):'';}
export function validateSearch(input:SearchInput,rows:PathRow[]){
 const t=rows.find(p=>p.filename===input.target);
 if(!t||neighborElement(t)!==input.element)throw Error('目标须为已核对元素的单散射路径');
 if(new Set(input.paths.map(p=>p.filename)).size!==input.paths.length)throw Error('路径不可重复');
 if(!input.paths.some(p=>p.filename===input.target))throw Error('目标路径须在当前模型中选中');
 if(input.paths.some(p=>!rows.some(r=>r.filename===p.filename)))throw Error('路径与 FEFF 记录不一致');
 if(input.paths.some(p=>p.filename!==input.target&&neighborElement(rows.find(r=>r.filename===p.filename)!)===input.element))throw Error('首版只支持该元素的一条目标壳层路径；同元素多路径需要先建立共享壳层模型');
 if(input.s02.vary||input.s02.value<=0)throw Error('配位数搜索必须固定正的 S₀²');
 if(input.s02.value-input.s02Delta<input.s02.min||input.s02.value+input.s02Delta>input.s02.max)throw Error('S₀² 敏感性范围超出参数边界');
 if(input.paths.some(p=>p.sigma2.min<0||p.sigma2.value<0||p.coordination&&p.coordination.min<0))throw Error('σ² 和配位数须非负');
 if(input.paths.some(p=>p.filename!==input.target&&p.coordination?.vary))throw Error('首版仅搜索一个目标壳层；其他壳层配位数须明确固定');
 fitSanity({...input,paths:input.paths.map(p=>({...p,selected:true,coordination:p.filename===input.target?{value:input.nmax/2,min:0,max:input.nmax,vary:true}:p.coordination}))});
 if(input.kmax-input.kmin<2)throw Error('有效 k 范围过窄，无法执行窗口稳定性检查');
 for(const t of searchPlan(input)){const c=trialConfig(input,t);try{fitSanity({...c,paths:c.paths.map(p=>({...p,selected:true}))});}catch(e){throw Error(t.label+' 不满足拟合要求：'+(e as Error).message+'。请检查自由 ΔE₀ 与独立信息量。');}}
}
export function searchPlan(q:SearchInput):Trial[]{
 const out:Trial[]=[];
 const add=(group:Trial['group'],label:string,n:number|null,starts:number,s02=q.s02.value,kmin=q.kmin,kmax=q.kmax)=>{for(let start=0;start<starts;start++)out.push({group,label,n,start,s02,kmin,kmax});};
 add('free','连续 N 多初值',null,3);
 const count=Math.ceil(q.nmax/q.step);for(let i=0;i<=count;i++)add('profile','固定 N 扫描',Math.min(q.nmax,Number((i*q.step).toFixed(6))),2);
 if(q.s02Delta>0){add('s02','S₀² 下调',null,2,q.s02.value-q.s02Delta);add('s02','S₀² 上调',null,2,q.s02.value+q.s02Delta);}
 add('window','提高 k 起点 0.5',null,2,q.s02.value,q.kmin+.5);add('window','降低 k 终点 0.5',null,2,q.s02.value,q.kmin,q.kmax-.5);
 if(out.length>80)throw Error('搜索超过 80 次拟合，请缩小 N 范围或增大扫描步长');
 return out;
}
const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
export function trialConfig(q:SearchInput,t:Trial){
 const paths=structuredClone(q.paths);for(const p of paths){
  if(p.filename===q.target)p.coordination={value:t.n??q.nmax*[.25,.65,.9][t.start%3],min:0,max:q.nmax,vary:t.n===null};
  if(t.start){if(p.deltar.vary)p.deltar.value=clamp(p.deltar.value+(t.start===1?.025:-.025),p.deltar.min,p.deltar.max);if(p.sigma2.vary)p.sigma2.value=clamp(p.sigma2.value*(t.start===1?1.7:.5),p.sigma2.min,p.sigma2.max);}
  // At N=0 this shell has no contribution: its distance/disorder are not identifiable.
  if(p.filename===q.target&&t.n===0){p.deltar.vary=false;p.sigma2.vary=false;}
 }
 const e0={...q.e0,value:clamp(q.e0.value+(t.start===1?2:t.start===2?-2:0),q.e0.min,q.e0.max)};
 return {feff_job:q.feff_job,kmin:t.kmin,kmax:t.kmax,rmin:q.rmin,rmax:q.rmax,kweight:q.kweight,dk:q.dk,window:q.window,s02:{...q.s02,value:t.s02,vary:false},e0,paths,data_kind:q.data_kind,provenance:q.provenance+'\n配位搜索；'+q.amplitudeSource+'；'+q.amplitudeNote+'；'+t.label+'；初值 '+t.start,paths_reviewed:true};
}
export function trialResult(q:SearchInput,t:Trial,j:ComputeJob):TrialResult{
 const r=j.result;const p=r?.paths?.find(p=>p.filename===q.target);const warnings=[...(r?.warnings||[])];
 for(const [key,p] of Object.entries(r?.parameters||{})){if(p.vary&&Math.min(p.value-p.min,p.max-p.value)<.005*(p.max-p.min))warnings.push(key+' 接近边界');if(p.correlations&&Object.values(p.correlations).some(v=>Math.abs(v)>.95))warnings.push(key+' 存在强相关');}
 if(r?.optimizer_success!==true)warnings.push('优化器未确认收敛');
 const rf=r?.statistics?.rfactor;
 return {trial:t,job:j.id,state:j.state,error:j.error||undefined,rfactor:j.state==='succeeded'&&r?.optimizer_success===true&&typeof rf==='number'&&Number.isFinite(rf)?rf:null,n:p?.effective_coordination?.value??t.n,stderr:p?.effective_coordination?.stderr??null,distance:p?.r_or_half_path??null,warnings};
}
export function searchSummary(r:SearchRecord){
 const valid=r.results.filter(x=>x.rfactor!==null&&x.n!==null&&Number.isFinite(x.n));
 const best=(xs:TrialResult[])=>[...xs].sort((a,b)=>a.rfactor!-b.rfactor!)[0];
 const free=best(valid.filter(x=>x.trial.group==='free'));
 const profile=[...new Set(r.plan.filter(t=>t.group==='profile').map(t=>t.n!))].map(n=>({n,result:best(valid.filter(x=>x.trial.group==='profile'&&x.trial.n===n))}));
 const warnings:string[]=[];
 if(r.state!=='completed')warnings.push('搜索尚未完整结束，当前结果仅供检查');
 if(r.results.some(x=>x.rfactor===null))warnings.push('存在失败或未确认收敛的拟合，不能据此排除对应配位数');
 if(r.input.amplitudeSource==='assumed')warnings.push('使用假定 S₀²，绝对配位数依赖该假设');
 if(!free)warnings.push('尚无收敛的连续配位数拟合');
 if(free){warnings.push(...free.warnings);const gridBest=best(valid.filter(x=>x.trial.group==='profile'));if(gridBest&&gridBest.rfactor!<free.rfactor!*.99)warnings.push('扫描找到更优解，多初值可能仍遗漏极小值');}
 return {free,profile,warnings:[...new Set(warnings)],checks:valid.filter(x=>x.trial.group==='s02'||x.trial.group==='window')};
}
