export type JobKind = 'structure'|'feff'|'fit'|'fdmnes'|'mace';
export type JobState = 'queued'|'running'|'succeeded'|'failed'|'interrupted';
export type Param = {value:number;vary:boolean;min:number;max:number};
export type AtomRow = {index:number;label:string;element:string;position:number[]};
export type PathRow = {filename:string;reff:number;degen:number;nleg:number;geometry:(string|number)[][];distance_meaning:string;r_or_half_path?:number;stderr?:number|null;meaning?:string;geometric_degeneracy?:number;effective_coordination?:FittedParam|null};
export type FittedParam = Param & {stderr:number|null;correlations:Record<string,number>|null};
export type ComputeResult = {
  kind:JobKind;atom_count?:number;formula?:string;pbc?:boolean[];cell?:number[][];atoms?:AtomRow[];
  paths?:PathRow[];cluster_atom_count?:number;absorber_element?:string;absorber_index?:number;
  warnings?:string[];geometric_check?:Record<string,unknown>;input?:{sha256:string;size_bytes:number;original_filename:string};
  parameters?:Record<string,FittedParam>;statistics?:Record<string,number|null>;data_kind?:string;
  provenance?:string;optimizer_success?:boolean;versions?:Record<string,string>;
};
export type StructureSource={kind:'mace';mace_job:string;original_structure_job:string;filename:string;sha256:string;converged:boolean;fmax_ev_a:number;target_fmax:number;created:string};
export type ComputeJob = {id:string;kind:JobKind;state:JobState;created:number;started:number|null;finished:number|null;error:string|null;request:Record<string,unknown>;result?:ComputeResult;label?:string;cached?:boolean;structureSource?:StructureSource;quickShellSource?:import('./quick-shell').QuickShellSource};
export type Connection = {configured:boolean;baseUrl?:string;updatedAt?:string;temporary?:boolean};
export type Curves = {kind:string;k:number[];chi_data_interpolated:number[];chi_fit_interpolated:number[];r:number[];ft_mag_data:number[];ft_mag_fit:number[];ft_re_data:number[];ft_re_fit:number[];kweight:number};
export type PathDraft = {filename:string;selected:boolean;deltar:Param;sigma2:Param;coordination:Param|null};
export const stateLabels:Record<JobState,string>={queued:'排队中',running:'计算中',succeeded:'已完成',failed:'失败',interrupted:'已中断'};
export const kindLabels:Record<JobKind,string>={structure:'结构解析',feff:'FEFF 路径',fit:'EXAFS 拟合',fdmnes:'FDMNES 近边',mace:'MACE 预优化'};
export const parameterLabels:Record<string,string>={s02:'S₀²',e0:'ΔE₀ / eV'};
export function parameterLabel(key:string){if(parameterLabels[key])return parameterLabels[key];const [field,index]=key.split('_');return `${field==='dr'?'ΔR / Å':field==='sig2'?'σ² / Å²':'有效 N'} · 路径 ${Number(index)+1}`;}
export function parameter(value:number,min:number,max:number,vary=false):Param{return {value,min,max,vary};}
export function initialPath(path:PathRow):PathDraft{return {filename:path.filename,selected:false,deltar:parameter(0,-.1,.1,true),sigma2:parameter(.003,.0001,.02,true),coordination:null};}
export function allowedComputeUrl(raw:string){
  let url:URL;try{url=new URL(raw.trim());}catch{throw Error('请输入完整的 HTTPS 计算接口地址');}
  const h=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash||!['','/'].includes(url.pathname))throw Error('接口地址须为无路径、端口、账号和查询参数的 HTTPS 域名');
  // Initial integration accepts only authenticated Cloudflare tunnel origins.
  if(!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.trycloudflare\.com$/.test(h))throw Error('此版本先通过 *.trycloudflare.com 临时 HTTPS 隧道验证连接；长期域名接入需另行配置');
  return url.origin;
}
export function fitSanity(config:{kmin:number;kmax:number;rmin:number;rmax:number;s02:Param;e0:Param;paths:PathDraft[]}){
  const ps=config.paths.filter(p=>p.selected);if(!ps.length)throw Error('请选择至少一条路径');
  if(ps.length>12)throw Error('最多使用 12 条路径');
  if(!(config.kmax>config.kmin&&config.rmax>config.rmin))throw Error('k/R 上限须大于下限');
  if(config.s02.vary&&ps.some(p=>p.coordination?.vary))throw Error('S₀² 与有效配位数 N 不能同时自由拟合');
  for(const a of [config.s02,config.e0])if(![a.value,a.min,a.max].every(Number.isFinite)||a.min>=a.max||a.value<a.min||a.value>a.max)throw Error('全局参数初值必须在有效边界内');
  let n=Number(config.s02.vary)+Number(config.e0.vary);
  for(const p of ps){for(const a of [p.deltar,p.sigma2,...(p.coordination?[p.coordination]:[])]){if(![a.value,a.min,a.max].every(Number.isFinite)||a.min>=a.max||a.value<a.min||a.value>a.max)throw Error('参数初值必须在有效边界内');n+=Number(a.vary);}}
  const nind=2*(config.kmax-config.kmin)*(config.rmax-config.rmin)/Math.PI+1;
  if(n<1||n>nind-1)throw Error(`自由参数 ${n}，估计 Nind ${nind.toFixed(2)}；自由参数须至少少 1`);
  return {n,nind};
}
