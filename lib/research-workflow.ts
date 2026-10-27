import {z} from 'zod';
import type {ComputeJob} from './compute-types.ts';
import type {Spectrum} from './spectra.ts';
import {normOf,chiOf} from './spectra.ts';
import {compareTheory,comparisonDefaults,type FdmnesComparison,type FdmnesResult} from './fdmnes.ts';
const theorySchema=z.object({energy:z.array(z.number().finite()).min(40).max(24000),mu:z.array(z.number().finite()).min(40).max(24000),axis:z.literal('relative_to_fermi_eV'),signal:z.string(),native_convolution:z.boolean(),gaussian_parameter_eV:z.number().finite(),method:z.string(),source_job:z.string()});
export const journeys={
 experiment:{title:'我有实验谱',description:'检查与处理数据，比较标样，探索局部配位；无需先准备结构。',steps:[['spectra','保存与检查实验谱'],['assistant','预处理并检查参数'],['xanes','近边与参考谱比较'],['compute','无结构第一壳层 / 配位搜索']]},
 prediction:{title:'我有候选结构',description:'检查候选结构，可选优化，计算并查看预测谱；无需实验谱。',steps:[['mace','保存结构与可选预优化'],['xanes','计算 XANES 预测谱'],['tasks','查看计算记录与预测结果']]},
 validation:{title:'实验谱 + 多个模型',description:'关联一个实验目标与多个候选模型，在一致条件下比较，保留无法区分的结论。',steps:[['spectra','核对实验目标与处理'],['xanes','逐模型计算 XANES'],['compute','逐模型 EXAFS 拟合'],['validation','统一比较与记录判断']]},
} as const;
export type Journey=keyof typeof journeys;
const id=z.string().regex(/^[a-f0-9]{32}$/);
export const caseSchema=z.object({id:z.string().uuid().optional(),revision:z.number().int().min(0).default(0),kind:z.enum(['experiment','prediction','validation']),name:z.string().trim().min(1).max(120),question:z.string().trim().max(2000),target:z.object({collectionId:z.string().uuid(),spectrumId:z.string().min(1),revision:z.number().int().min(1)}).nullable(),models:z.array(id).max(8),fitJobs:z.array(id).max(8),theoryJobs:z.array(id).max(4),fitTargetConfirmed:z.boolean().default(false),decision:z.enum(['undetermined','needs_data','supports']).default('undetermined'),supportedModel:z.string().default(''),note:z.string().trim().max(4000)}).superRefine((v,c)=>{
 for(const k of ['models','fitJobs','theoryJobs'] as const)if(new Set(v[k]).size!==v[k].length)c.addIssue({code:'custom',path:[k],message:'记录不可重复'});
 if(v.kind==='prediction'&&v.target)c.addIssue({code:'custom',path:['target'],message:'结构预测任务不关联实验谱；请另建验证任务'});
 if(v.decision==='supports'&&(!v.models.includes(v.supportedModel)||v.note.length<10))c.addIssue({code:'custom',path:['note'],message:'支持某模型时须选择已关联模型并填写证据与限制（至少10字符）'});
 if(v.kind==='prediction'&&v.decision==='supports')c.addIssue({code:'custom',message:'仅结构预测不能形成实验支持结论'});
});
export type CaseDraft=z.infer<typeof caseSchema>;
export type FrozenTarget={collectionId:string;spectrumId:string;revision:number;sha256:string;collectionName:string;example:boolean;spectrum:Spectrum};
export type GroupReport={status:'comparable'|'needs_data'|'inconsistent';message:string;checks:string[];rows:{job:string;model:string;label:string;rfactor:number|null;error?:string;variables?:number|null;nind?:number|null;comparison?:FdmnesComparison}[];};
export type ResearchCase=Omit<CaseDraft,'id'|'revision'>&{id:string;revision:number;created:string;updated:string;frozenTarget:FrozenTarget|null;modelRecords:ComputeJob[];fitRecords:ComputeJob[];theoryRecords:ComputeJob[];exafs:GroupReport;xanes:GroupReport};
export type AnalysisContext={nonce:number;target:CaseDraft['target'];structure?:string};
export function emptyCase(kind:Journey):CaseDraft{return {revision:0,kind,name:'',question:'',target:null,models:[],fitJobs:[],theoryJobs:[],fitTargetConfirmed:false,decision:'undetermined',supportedModel:'',note:''};}
export function sourceStages(s:Spectrum){return {normalization:!!normOf(s),exafs:!!chiOf(s),fitCurve:!!s.fit,fitReport:!!s.fitReport};}
export function resultNature(j:ComputeJob){return j.kind==='fit'?'实验与模型的拟合':j.kind==='fdmnes'?'结构预测谱':j.quickShellSource?'QFS 人工计算簇':j.kind==='structure'?'候选结构':'计算任务';}
const stable=(v:unknown):string=>{if(v&&typeof v==='object'&&!Array.isArray(v))return JSON.stringify(Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,JSON.parse(stable(x))])));return JSON.stringify(v??null);};
const blank=(message:string):GroupReport=>({status:'needs_data',message,checks:[],rows:[]});
export function compareExafs(jobs:ComputeJob[],confirmed:boolean):GroupReport{
 if(jobs.length<2)return blank('至少关联两份完成的 EXAFS 拟合，才能比较候选模型。');
 if(new Set(jobs.map(j=>j.request.feff_job)).size<2)return {...blank('所选拟合来自同一路径模型；请关联不同候选模型的结果。'),status:'inconsistent'};
 const keys=['kmin','kmax','rmin','rmax','kweight','dk','window','data_kind'];const checks:string[]=[];
 const all=jobs.every(j=>j.kind==='fit'&&j.state==='succeeded'&&j.result?.optimizer_success===true&&typeof j.result?.statistics?.rfactor==='number'&&Number.isFinite(j.result.statistics.rfactor));
 if(!all)checks.push('存在失败、未确认收敛或缺失指标的拟合。');
 if(jobs.some(j=>{const s=j.result?.statistics;return !Number.isFinite(s?.nvarys)||!Number.isFinite(s?.n_independent)||Number(s?.nvarys)>=Number(s?.n_independent);}))checks.push('变量数 / 独立信息量不满足要求或缺失。');
 const hashes=jobs.map(j=>j.result?.input?.sha256);if(hashes.some(h=>!h)||new Set(hashes).size!==1)checks.push('拟合输入 χ(k) 的 SHA-256 不一致或缺失。');
 if(keys.some(k=>jobs.some(j=>j.request[k]==null)||new Set(jobs.map(j=>stable(j.request[k]))).size!==1))checks.push('k/R 窗口、权重、窗函数或数据属性不一致/缺失。');
 const amps=jobs.map(j=>j.request.s02 as {value?:number;vary?:boolean}|undefined);if(amps.some(p=>!p||p.vary!==false||!Number.isFinite(p.value))||new Set(amps.map(p=>p?.value)).size!==1)checks.push('S₀² 需要具有相同的固定值。');
 if(!confirmed)checks.push('尚未确认所选拟合输入对应本任务的实验目标。');
 return {status:checks.length?'inconsistent':'comparable',message:checks.length?'条件未统一，停止跨模型指标比较。':'输入与主要拟合口径一致；仍无法仅凭指标确定唯一模型。',checks,rows:jobs.map(j=>({job:j.id,model:String(j.request.feff_job||''),label:j.label||j.id,rfactor:checks.length?null:j.result?.statistics?.rfactor??null,variables:j.result?.statistics?.nvarys??null,nind:j.result?.statistics?.n_independent??null}))};
}
export function compareXanes(target:FrozenTarget|null,jobs:ComputeJob[]):GroupReport{
 if(!target||!normOf(target.spectrum))return blank('关联并保存一条已有归一化结果的实验目标，才能进行 XANES 比较。');
 if(jobs.length<2)return blank('至少关联两个候选结构的已完成 XANES 预测谱。');
 const keys=['edge','radius','method','scf','emin','emax','step','broadening','gaussian','gamma_hole','gamma_max','ecent','elarg'];
 const checks:string[]=[];
 if(keys.some(k=>new Set(jobs.map(j=>stable(j.request[k]))).size!==1))checks.push('候选模型的计算半径、方法、能量网格或展宽设置不一致。');
 for(const k of ['edge','radius','method','scf','emin','emax','step','broadening'])if(jobs.some(j=>j.request[k]==null))checks.push('缺失必要计算设置：'+k);
 const models=jobs.map(j=>j.request.structure_job);if(new Set(models).size<2)checks.push('需要来自至少两个不同候选结构的预测谱。');
 if(jobs.some(j=>j.kind!=='fdmnes'||j.state!=='succeeded'))checks.push('所选预测谱尚未全部成功完成。');
 if(checks.length)return {status:'inconsistent',message:'计算条件未统一，停止跨模型比较。',checks,rows:[]};
 try{
  const s=target.spectrum;
  const spectra=jobs.map(j=>{const r=j.result as unknown as FdmnesResult;const p=theorySchema.parse(r?.spectrum);if(p.source_job!==j.id)throw Error('理论谱来源编号不一致');if(!s.element||!s.edge)throw Error('请先在谱库核对实验吸收元素和吸收边');if(r.absorber_element!==s.element||r.edge!==s.edge)throw Error('理论与实验的元素或吸收边不一致');return p;});
  const defaults=spectra.map(p=>comparisonDefaults(s,p,false,0));const emin=Math.max(...defaults.map(p=>p.emin)),emax=Math.min(...defaults.map(p=>p.emax));if(!(emax>emin))throw Error('所有候选与实验没有共同可用比较窗口');
  const rows=jobs.map((j,i)=>{const comparison=compareTheory(s,spectra[i],{emin,emax,initialOffset:defaults[i].initialOffset,refine:false,bound:0});return {job:j.id,model:String(j.request.structure_job),label:j.label||j.id,rfactor:comparison.rfactor,comparison};});
  return {status:'comparable',message:'采用同一实验快照、共同窗口和相同对齐规则；当前不判定唯一结构。',checks:[`共同能量窗口 ${emin.toFixed(2)}–${emax.toFixed(2)} eV。`,'理论按各自导数峰生成有记录的初始能量平移，不精调；实验能量不变。','不跨条件排名，不把近边相似度解释成确定配位数或精确价态。'],rows};
 }catch(e){return {status:'needs_data',message:'无法完成共同条件下的 XANES 比较。',checks:[(e as Error).message],rows:[]};}
}
