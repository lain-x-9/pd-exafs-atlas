/** Numerical routines used by the browser assistant. Originals are never mutated. */
export type DataKind='mu'|'transmission'|'fluorescence'|'normalized'|'chi';
export type Mapping={kind:DataKind;x:number;y:number;i0:number;unit:'eV'|'keV';confirmed:boolean};
export type Settings={e0:number;pre1:number;pre2:number;norm1:number;norm2:number;order:number;shift:number;reference:string;rbkg:number;kmin:number;kmax:number;kweight:number;rmin:number;rmax:number};
export type Sample={id:string;name:string;text:string;originalBase64:string;sha256:string;example:boolean;composition:string;element:string;edge:string;goal:string;standard:string;mapping:Mapping;settings:Settings|null};
export type Session={version:1;samples:Sample[];active:string;path:{name:string;pair:string;degen:number;reff:number;source:string;confirmed:boolean;s02:number;calibrated:boolean;calibrationSource:string}};
export type Issue={level:'error'|'warning'|'info';title:string;detail:string};
export type Parsed={rows:number[][];headers:string[];issues:Issue[];lineNumbers:number[]};
export type Spectrum={x:number[];y:number[];issues:Issue[]};
export type Processed={x:number[];mu:number[];norm?:number[];pre?:number[];post?:number[];edgeStep?:number;ft?:{r:number;mag:number;re:number;im:number}[];method:string};
export const defaultPath=()=>({name:'',pair:'',degen:1,reff:2,source:'',confirmed:false,s02:.9,calibrated:false,calibrationSource:''});
export const emptySession=():Session=>({version:1,samples:[],active:'',path:defaultPath()});
const numberToken=(s:string)=>Number(s.replace(/[dD]([+-]?\d+)$/,'e$1'));
function fields(line:string){return line.includes(',')?line.split(',').map(s=>s.trim().replace(/^"|"$/g,'')):line.trim().split(/[\t\s]+/);}
export function parseSpectrum(text:string):Parsed{
 const rows:number[][]=[],lineNumbers:number[]=[],issues:Issue[]=[];let headers:string[]=[],width=0;const bad:number[]=[];
 for(const [index,raw] of text.replace(/^\uFEFF/,'').split(/\r?\n/).entries()){
  const line=raw.trim();if(!line)continue;
  if(/^[#;!%]/.test(line)){if(!rows.length){const f=fields(line.replace(/^[#;!%]+\s*/,''));if(f.length>1)headers=f;}continue;}
  const f=fields(line);const numericFirst=f[0]!==''&&Number.isFinite(numberToken(f[0]));
  if(!numericFirst&&!rows.length){headers=f;continue;}
  if(!width&&numericFirst)width=f.length;
  const values=f.map(t=>t===''?NaN:numberToken(t));
  if(f.length!==width||f.length<2||values.some(v=>!Number.isFinite(v))){bad.push(index+1);continue;}
  rows.push(values);lineNumbers.push(index+1);
 }
 if(bad.length)issues.push({level:'error',title:`${bad.length} 行无法完整读取`,detail:`原文件行 ${bad.slice(0,12).join('、')}${bad.length>12?'…':''} 存在缺失、非数值或列数不一致。尚未丢弃这些点进行处理；请核对文件格式。`});
 if(rows.length<12)issues.push({level:'error',title:'有效数据点不足',detail:'至少需要 12 个完整数值行；请上传文本谱图，而不是工程文件、图片或结构文件。'});
 if(rows.length>12000)issues.push({level:'error',title:'数据点超过本版限制',detail:'单谱最多 12,000 点。本版不会自动抽稀，请在 Athena 中处理此文件。'});
 if(headers.length!==width)headers=Array.from({length:width},(_,i)=>`第 ${i+1} 列`);
 return {rows,headers,issues,lineNumbers};
}
export function convertSpectrum(p:Parsed,m:Mapping):Spectrum{
 const issues=[...p.issues],x:number[]=[],y:number[]=[];
 if(issues.some(i=>i.level==='error'))return {x,y,issues};
 if(![m.x,m.y,...(['transmission','fluorescence'].includes(m.kind)?[m.i0]:[])].every(i=>Number.isInteger(i)&&i>=0&&i<(p.rows[0]?.length||0)))return {x,y,issues:[...issues,{level:'error',title:'列选择无效',detail:'请在文件预览中核对列号。'}]};
 if(m.x===m.y||(['transmission','fluorescence'].includes(m.kind)&&(m.i0===m.x||m.i0===m.y)))issues.push({level:'error',title:'数据列重复',detail:'横轴、信号及 I₀ 必须使用对应的不同列。'});
 let invalid=0;for(const row of p.rows){const e=row[m.x]*(m.kind!=='chi'&&m.unit==='keV'?1000:1);let v=row[m.y];if(m.kind==='transmission'){if(row[m.i0]<=0||v<=0)invalid++;v=Math.log(row[m.i0]/v);}if(m.kind==='fluorescence'){if(row[m.i0]<=0)invalid++;v=v/row[m.i0];}if(!Number.isFinite(v))invalid++;x.push(e);y.push(v);}
 if(invalid)issues.push({level:'error',title:'探测器信号不能转换',detail:'存在非正 I₀、透射信号非正或非有限值；不会静默删除或插值。'});
 let disorder=0;for(let i=1;i<x.length;i++)if(x[i]<=x[i-1])disorder++;
 if(disorder)issues.push({level:'error',title:'横轴存在重复或逆序',detail:`发现 ${disorder} 处；请核对是否将多次扫描拼接在同一文件。本版不自动排序、去重。`});
 if(m.kind!=='chi'&&x.length&&Math.max(...x)<300)issues.push({level:'warning',title:'请核对能量单位',detail:'能量数值较小，可能为 keV；确认后再继续。'});
 if(m.kind==='chi'&&x.length&&(Math.min(...x)<0||Math.max(...x)>50))issues.push({level:'error',title:'χ(k) 的横轴不合理',detail:'本版接受 0–50 Å⁻¹ 的 k 数据；请检查是否将能量误选为 k。'});
 if(!issues.some(i=>i.level==='error')&&y.length>5){const dif=y.slice(1).map((v,i)=>Math.abs(v-y[i]));const med=[...dif].sort((a,b)=>a-b)[Math.floor(dif.length/2)];const span=Math.max(...y)-Math.min(...y);let spikes=0;for(let i=1;i<y.length-1;i++)if((y[i]-y[i-1])*(y[i+1]-y[i])<0&&Math.min(dif[i-1],dif[i])>Math.max(20*med,.15*span))spikes++;if(spikes)issues.push({level:'warning',title:`${spikes} 处突变候选`,detail:'仅为局部差分提示，吸收特征也可能触发。请检查原谱，本版不自动去毛刺或平滑。'});}
 if(m.kind==='normalized')issues.push({level:'info',title:'已归一化数据',detail:'将保留输入数值，不重复归一化；无法据此验证此前的校准与背景处理。'});
 if(m.kind==='chi')issues.push({level:'info',title:'已提取的 χ(k)',detail:'可检查与进行傅里叶变换；无法从此文件追溯能量校准、归一化和 AUTOBK。'});
 return {x,y,issues};
}
export function suggestSettings(s:Spectrum,kind:DataKind):Settings{
 const {x,y}=s;let e0=0;if(kind!=='chi'&&x.length>4){let best=-Infinity;for(let i=2;i<x.length-2;i++){const d=(y[i+1]-y[i-1])/(x[i+1]-x[i-1]);if(d>best){best=d;e0=x[i];}}}
 const before=e0-(x[0]||0),after=(x.at(-1)||0)-e0;
 return {e0,pre1:-Math.max(5,Math.floor(before*.9)),pre2:-Math.max(2,Math.min(30,before*.2)),norm1:Math.max(15,Math.min(150,after*.25)),norm2:Math.floor(after*.9),order:after>450?2:1,shift:0,reference:'',rbkg:1,kmin:kind==='chi'?Math.max(2,x[0]||0):3,kmax:kind==='chi'?Math.min(12,x.at(-1)||0):Math.max(3,Math.min(12,Math.floor(Math.sqrt(Math.max(0,after)/3.809982)*10)/10)),kweight:2,rmin:1,rmax:3};
}
function solve(a:number[][],b:number[]){const n=b.length;const m=a.map((r,i)=>[...r,b[i]]);for(let j=0;j<n;j++){let pivot=j;for(let i=j+1;i<n;i++)if(Math.abs(m[i][j])>Math.abs(m[pivot][j]))pivot=i;[m[j],m[pivot]]=[m[pivot],m[j]];if(Math.abs(m[j][j])<1e-14)throw Error('拟合矩阵奇异，请扩大区间并检查能量点。');const d=m[j][j];for(let k=j;k<=n;k++)m[j][k]/=d;for(let i=0;i<n;i++)if(i!==j){const f=m[i][j];for(let k=j;k<=n;k++)m[i][k]-=f*m[j][k];}}return m.map(r=>r[n]);}
export function polyfit(x:number[],y:number[],degree:number){const n=degree+1;const a=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>x.reduce((s,v)=>s+v**(i+j),0)));const b=Array.from({length:n},(_,i)=>x.reduce((s,v,j)=>s+v**i*y[j],0));return solve(a,b);}
const polyval=(c:number[],x:number)=>c.reduce((s,v,i)=>s+v*x**i,0);
export function processSpectrum(s:Spectrum,m:Mapping,p:Settings):Processed{
 if(!m.confirmed)throw Error('请先确认数据类型、单位与列选择。');if(s.issues.some(i=>i.level==='error'))throw Error('先解决数据体检中的阻断问题。');
 if(!Object.entries(p).filter(([k])=>!['reference'].includes(k)).every(([,v])=>typeof v==='number'&&Number.isFinite(v)))throw Error('所有数值参数必须有效。');
 if(p.shift!==0&&!p.reference.trim())throw Error('能量平移需要填写参考箔标定依据；不能用样品自身边位移强行对齐。');
 if(m.kind==='chi'&&(p.rbkg<=0||p.kmin<0||p.kmax<=p.kmin||p.rmin<0||p.rmax<=p.rmin||![1,2,3].includes(p.kweight)))throw Error('请检查 Rbkg、k/R 上下限和 k 权重。');
 const x=s.x.map(v=>v+(m.kind==='chi'?0:p.shift)),mu=[...s.y];
 if(m.kind==='chi'){if(p.kmin<x[0]||p.kmax>x.at(-1)!+1e-9)throw Error('变换 k 区间超出输入数据范围。');const points=x.map((v,i)=>({k:v,chi:mu[i]})).filter(v=>v.k>=p.kmin&&v.k<=p.kmax);if(points.length<12)throw Error('k 区间内有效点不足 12 个。');const ft=[];for(let j=0;j<=200;j++){const r=j*.03;let re=0,im=0;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];const term=(v:typeof a)=>{const w=.5*(1-Math.cos(2*Math.PI*(v.k-p.kmin)/(p.kmax-p.kmin)));const amp=v.chi*v.k**p.kweight*w;return {re:amp*Math.cos(2*v.k*r),im:amp*Math.sin(2*v.k*r)};};const ta=term(a),tb=term(b);re+=(ta.re+tb.re)*(b.k-a.k)/2;im+=(ta.im+tb.im)*(b.k-a.k)/2;}re/=Math.sqrt(Math.PI);im/=Math.sqrt(Math.PI);ft.push({r,re,im,mag:Math.hypot(re,im)});}return {x,mu,ft,method:'非均匀 k 网格梯形积分；区间内完整 Hann 窗；1/√π ∫ k^wχ(k)W(k)e^(2ikR)dk；未相位校正。此窗定义不同于 Athena dk 边缘渐变窗，幅值不可直接互换。'};}
 if(m.kind==='normalized')return {x,mu,norm:[...mu],method:'已归一化输入保留原值；仅应用有记录的参考能量平移。'};
 if(!(p.pre1<p.pre2&&p.pre2<0&&p.norm1>0&&p.norm1<p.norm2&&[1,2].includes(p.order)))throw Error('边前需 pre1 < pre2 < 0；边后需 0 < norm1 < norm2，阶数为 1 或 2。');
 if(p.e0<=x[0]||p.e0>=x.at(-1)!)throw Error('E₀ 必须位于光谱能量范围内；能量平移后请核对 E₀。');
 const nearest=(v:number)=>x.reduce((best,a,i)=>Math.abs(a-v)<Math.abs(x[best]-v)?i:best,0);
 const select=(lo:number,hi:number)=>{let first=0;for(let i=0;i<x.length;i++)if(x[i]<=p.e0+lo)first=i;const end=nearest(p.e0+hi);return Array.from({length:Math.max(0,end-first)},(_,i)=>first+i);};const preIds=select(p.pre1,p.pre2),postIds=select(p.norm1,p.norm2);
 if(p.e0+p.pre1<x[0]||p.e0+p.norm2>x.at(-1)!)throw Error('边前或边后区间超出数据范围。');
 if(preIds.length<5||postIds.length<Math.max(8,p.order+3))throw Error('区间点数不足：边前至少 5 点，边后至少 8 点。请调整区间。');
 const scale=Math.max(Math.abs(p.pre1),p.norm2,1),xx=x.map(v=>(v-p.e0)/scale);const cpre=polyfit(preIds.map(i=>xx[i]),preIds.map(i=>mu[i]),1);const pre=xx.map(v=>polyval(cpre,v));const cpost=polyfit(postIds.map(i=>xx[i]),postIds.map(i=>mu[i]-pre[i]),p.order);const edgeStep=polyval(cpost,xx[nearest(p.e0)]);
 if(!Number.isFinite(edgeStep)||edgeStep<=Math.max(1e-12,Math.max(...mu.map(Math.abs))*1e-10))throw Error('边跃为非正或接近零。请核对列、数据类型、E₀ 和归一化区间。');
 return {x,mu,pre,post:xx.map((v,i)=>pre[i]+polyval(cpost,v)),norm:mu.map((v,i)=>(v-pre[i])/edgeStep),edgeStep,method:`线性边前 + ${p.order} 阶边后最小二乘；nvict=0；norm=(μ−pre)/edge_step；边界取点为下限向下取点、上限最近点且不包含上端；边跃在最近 E₀ 点求值；未 flatten，未 AUTOBK。`};
}
export type Review={stats:{label:string;value:number}[];params:{name:string;value:number;error:number|null}[];issues:Issue[];recognized:boolean};
export function reviewLog(text:string):Review{
 const stats:{label:string;value:number}[]=[],params:{name:string;value:number;error:number|null}[]=[],issues:Issue[]=[];
 const numeric='[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eEdD][-+]?\\d+)?';
 const read=(name:string,re:RegExp)=>{const m=text.match(re);if(m)stats.push({label:name,value:numberToken(m[1])});};
 read('独立点数 Nind',new RegExp('(?:Independent points|n_independent|n_idp)\\s*[:=]\\s*('+numeric+')','i'));
 read('自由参数 Nvar',new RegExp('(?:Number of variables|nvarys|n_varys)\\s*[:=]\\s*('+numeric+')','i'));
 read('R-factor',new RegExp('(?:R-factor|r_factor)\\s*[:=]\\s*('+numeric+')','i'));
 read('Reduced χ²',new RegExp('(?:Reduced chi-square|reduced chi-square|reduced_chi_square|reduced_chisqr)\\s*[:=]\\s*('+numeric+')','i'));
 for(const line of text.split(/\r?\n/)){const m=line.match(new RegExp('^\\s*([A-Za-z][\\w]*)\\s*(?:=|:)\\s*('+numeric+')(?:\\s*(?:#\\s*)?\\+/-\\s*('+numeric+'))?'));if(m&&m[1].length<80&&!['nvarys','n_idp','n_independent','n_varys','r_factor','reduced_chisqr'].includes(m[1].toLowerCase())){const value=numberToken(m[2]),error=m[3]?numberToken(m[3]):null;params.push({name:m[1],value,error});if(error!==null&&error>Math.abs(value)&&value!==0)issues.push({level:'warning',title:`${m[1]} 相对误差较大`,detail:'误差超过参数绝对值。结合相关性与范围敏感性检查，不能只看最优值。'});if(/^(?:sig(?:ma)?2|sigma_?sq|ss)(?:_|\d|$)/i.test(m[1])&&value<0)issues.push({level:'warning',title:`${m[1]} 为负`,detail:'如果此变量代表绝对 σ²，常规模型下不合理；如果是相对修正量，需要检查最终路径表达式。'});if(/^(?:de0|e0|del(?:ta)?e0)(?:_|\d|$)/i.test(m[1])&&Math.abs(value)>15)issues.push({level:'warning',title:`${m[1]} 偏移较大`,detail:'|ΔE₀| > 15 eV 触发本工具的复核提示，并非普适合格阈值。检查标定、路径与模型。'});}}
 const nind=stats.find(s=>s.label==='独立点数 Nind')?.value,nvar=stats.find(s=>s.label==='自由参数 Nvar')?.value;
 if(nind!==undefined&&nvar!==undefined&&nvar>=nind)issues.push({level:'error',title:'自由参数达到或超过独立点数',detail:`Nvar=${nvar}，Nind=${nind}；需要精简模型或改善有效信息量。`});
 if(nind!==undefined&&nvar!==undefined&&nvar<nind&&nind-nvar<2)issues.push({level:'warning',title:'独立信息余量较小',detail:'自由参数虽少于独立点数，仍需核查可辨识性与相关性。'});
 const corr=new RegExp('(?:C\\()?([A-Za-z]\\w*)\\s*(?:,|&)\\s*([A-Za-z]\\w*)\\)?\\s*(?::|=|--?>)\\s*('+numeric+')','g');for(const m of text.matchAll(corr)){const c=numberToken(m[3]);if(Math.abs(c)>=.9&&Math.abs(c)<=1)issues.push({level:'warning',title:`强相关：${m[1]} / ${m[2]}`,detail:`相关系数 ${c}；检查参数是否可独立确定。`});}
 if(/(?:did not|failed to|not)\s+converge|convergence\s*(?:failed|failure)|optimizer_success\s*[:=]\s*false|success\s*[:=]\s*(?:false|0)\b|maximum (?:number of )?(?:function evaluations|iterations).*exceeded|拟合失败|未收敛/i.test(text))issues.push({level:'error',title:'报告包含未收敛或优化失败记录',detail:'此报告不能标记为已完成可靠拟合。请检查优化器终止信息、初始值、参数相关性和有效拟合区间，再运行并保留新报告。'});
 if(!stats.length&&!params.length)issues.push({level:'warning',title:'未识别标准拟合字段',detail:'请粘贴 Artemis 完整拟合报告或 Larch feffit 报告；图片和工程二进制不能作为文本日志解析。'});
 if(!/\+\/-/.test(text))issues.push({level:'info',title:'缺少参数误差',detail:'当前文本不足以评估不确定度，请补充完整报告。'});
 issues.push({level:'info',title:'还需联合查看曲线与模型',detail:'日志检查不验证拟合结构正确，也不能单独确认收敛。检查 χ(k)、χ(R) 幅值和实/虚部、残差、路径来源、S₀² 与 N 的设置及范围敏感性。负 ΔR 本身不代表异常。'});
 return {stats,params,issues,recognized:!!(stats.length||params.length)};
}
export function demoSample():Sample{
 const rows=['# Synthetic teaching spectrum; not experimental data','# energy_eV mu'];for(let e=24050;e<=25150;e+=2){const d=e-24350,k=Math.sqrt(Math.max(0,d)/3.809982);const step=1/(1+Math.exp(-d/2));const mu=.2+.00008*(e-24050)+step*(1+.00008*d+.10*Math.exp(-(((d-7)/5)**2)))+(d>30?.035*Math.sin(2*k*2.15)*Math.exp(-k/12):0);rows.push(`${e.toFixed(3)} ${mu.toFixed(9)}`);}return {id:'teaching-pd',name:'Pd-K_教学合成谱.dat',text:rows.join('\n'),originalBase64:'',sha256:'教学合成数据（无实验来源）',example:true,composition:'Pd / TiO₂（教学情景）',element:'Pd',edge:'K',goal:'配位环境',standard:'none',mapping:{kind:'mu',x:0,y:1,i0:2,unit:'eV',confirmed:false},settings:null};
}
export function derivedText(sample:Sample,result:Processed){const fields=result.pre?['energy_eV','mu','pre_edge','post_edge','norm']:sample.mapping.kind==='chi'?['k_A^-1','chi']:['energy_eV','norm'];return ['# Derived data; original unchanged',`# source=${sample.name}; sha256=${sample.sha256}`,`# ${result.method}`,`# ${fields.join('\t')}`,...result.x.map((x,i)=>result.pre?[x,result.mu[i],result.pre[i],result.post![i],result.norm![i]].join('\t'):[x,(result.norm||result.mu)[i]].join('\t'))].join('\n');}
