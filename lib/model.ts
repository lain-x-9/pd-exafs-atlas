import { z } from 'zod';
const finite = z.number().finite();
export const shellSchema = z.object({pair:z.string().min(1).max(30),n:finite.min(0).max(30).nullable(),r:finite.positive().max(15).nullable()});
export const candidateSchema = z.object({
 id:z.string().min(1).max(100), name:z.string().min(1).max(100), motif:z.string().max(100),
 b:z.boolean(), provenance:z.enum(['example','theory','literature']), source:z.string().max(1000), method:z.string().max(200), notes:z.string().max(3000),
 shells:z.array(shellSchema).min(1).max(20), rf:finite.min(0).max(1).nullable(), chi:finite.min(0).nullable(), nind:finite.positive().nullable(), variables:finite.int().min(0).nullable(), fitGroup:z.string().max(150)
}).superRefine((v,c)=>{if(new Set(v.shells.map(s=>s.pair)).size!==v.shells.length)c.addIssue({code:'custom',message:'同一候选中配位壳层名称不能重复'});});
export const constraintSchema=z.object({id:z.string().min(1).max(100),pair:z.string().min(1).max(30),metric:z.enum(['n','r']),target:finite.min(0),tolerance:finite.positive(),provenance:z.enum(['example','experimental']),source:z.string().min(1).max(1000)}).superRefine((v,c)=>{if(v.metric==='r'&&v.target<=0)c.addIssue({code:'custom',message:'键长目标必须大于 0'});});
export const workspaceSchema=z.object({schemaVersion:z.literal(1),candidates:z.array(candidateSchema).max(1000),constraints:z.array(constraintSchema).max(30)}).superRefine((v,c)=>{for(const list of [v.candidates,v.constraints])if(new Set(list.map(x=>x.id)).size!==list.length)c.addIssue({code:'custom',message:'存在重复 ID'});if(new Set(v.constraints.map(x=>x.pair+x.metric)).size!==v.constraints.length)c.addIssue({code:'custom',message:'同一壳层和指标只能有一个约束'});});
export type Candidate=z.infer<typeof candidateSchema>;
export type Constraint=z.infer<typeof constraintSchema>;
export type Workspace=z.infer<typeof workspaceSchema>;
export const emptyWorkspace:Workspace={schemaVersion:1,candidates:[],constraints:[]};
export const statusNames:Record<string,string>={pass:'容差内',warn:'轻度偏离',fail:'明显偏离',missing:'待补充',none:'未设约束'};
export function residual(c:Candidate,k:Constraint){const s=c.shells.find(s=>s.pair===k.pair);const v=s?.[k.metric];return v==null?null:{value:v,delta:v-k.target,z:(v-k.target)/k.tolerance};}
export function assess(c:Candidate,ks:Constraint[]){const all=ks.map(k=>residual(c,k));const missing=all.filter(x=>x===null).length;const zs=all.filter(x=>x!==null).map(x=>Math.abs(x.z));const max=zs.length?Math.max(...zs):0;const status=!ks.length?'none':max>2+1e-9?'fail':max>1+1e-9?'warn':missing?'missing':'pass';return {max,missing,status,complete:missing===0&&ks.length>0};}
const base={method:'VASP · PBE-D3（演示）',source:'合成示例，仅用于验证界面',notes:'所有结构参数与拟合指标均为虚构示例，不代表真实样品。',provenance:'example' as const,nind:14.2,variables:7,fitGroup:'DEMO · k 3–12 Å⁻¹ / R 1–3 Å'};
export function demoWorkspace():Workspace{return {schemaVersion:1,constraints:[
 {id:'k1',pair:'Pd-O',metric:'n',target:3.5,tolerance:0.6,provenance:'example',source:'虚构演示约束 · 手动容差'},
 {id:'k2',pair:'Pd-O',metric:'r',target:2.02,tolerance:0.04,provenance:'example',source:'虚构演示约束 · 手动容差'},
 {id:'k3',pair:'Pd-Ti',metric:'n',target:3,tolerance:0.7,provenance:'example',source:'虚构演示约束 · 手动容差'},
 {id:'k4',pair:'Pd-Ti',metric:'r',target:2.85,tolerance:0.08,provenance:'example',source:'虚构演示约束 · 手动容差'}],candidates:[
 {...base,id:'PD-01',name:'B 邻位 · O₄ 配位',motif:'B 邻位',b:true,shells:[{pair:'Pd-O',n:4,r:2.04},{pair:'Pd-Ti',n:3,r:2.88},{pair:'Pd-B',n:1,r:2.7}],rf:.0142,chi:18.4},
 {...base,id:'PD-02',name:'氧空位 · O₃ 配位',motif:'氧空位',b:true,shells:[{pair:'Pd-O',n:3,r:2.0},{pair:'Pd-Ti',n:3,r:2.83}],rf:.0178,chi:22.1},
 {...base,id:'PD-03',name:'桥位 · O₃Ti₂',motif:'桥位',b:true,shells:[{pair:'Pd-O',n:3,r:2.07},{pair:'Pd-Ti',n:2,r:2.92}],rf:.0235,chi:31.6},
 {...base,id:'PD-04',name:'表面嵌入 · O₅',motif:'表面嵌入',b:true,shells:[{pair:'Pd-O',n:5,r:2.12},{pair:'Pd-Ti',n:4,r:3.06}],rf:.0386,chi:57.2},
 {...base,id:'PD-05',name:'无 B 对照 · O₄',motif:'无 B 对照',b:false,shells:[{pair:'Pd-O',n:4,r:2.06},{pair:'Pd-Ti',n:3,r:2.94}],rf:.0211,chi:28.7},
 {...base,id:'PD-06',name:'B 远位 · O₂ 配位',motif:'B 远位',b:true,shells:[{pair:'Pd-O',n:2,r:1.94},{pair:'Pd-Ti',n:2,r:2.76}],rf:.0458,chi:68.3},
 {...base,id:'PD-07',name:'次表层 · O₆ 配位',motif:'次表层',b:false,shells:[{pair:'Pd-O',n:6,r:2.16},{pair:'Pd-Ti',n:4,r:3.12}],rf:.0624,chi:93.5},
 {...base,id:'PD-08',name:'B 邻位 · 待补全',motif:'B 邻位',b:true,shells:[{pair:'Pd-O',n:3,r:2.03},{pair:'Pd-Ti',n:null,r:null}],rf:null,chi:null,nind:null,variables:null}
]};}
export const csvFields=['id','name','motif','b','provenance','source','method','pd_o_n','pd_o_r','pd_ti_n','pd_ti_r','pd_b_n','pd_b_r','pd_pd_n','pd_pd_r','rf','chi','nind','variables','fitGroup','notes'];
const pairs=['Pd-O','Pd-Ti','Pd-B','Pd-Pd'];
export function toCSV(cs:Candidate[]){const escape=(x:unknown)=>{let s=x==null?'':String(x);if(/^[=+@\-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};return '\ufeff'+[csvFields,...cs.map(c=>[c.id,c.name,c.motif,String(c.b),c.provenance,c.source,c.method,...pairs.flatMap(p=>{const s=c.shells.find(s=>s.pair===p);return [s?.n,s?.r]}),c.rf,c.chi,c.nind,c.variables,c.fitGroup,c.notes])].map(row=>row.map(escape).join(',')).join('\r\n');}
export function parseCSV(text:string){const rows:string[][]=[];let row:string[]=[],cell='',quote=false;const s=text.replace(/^\ufeff/,'');for(let i=0;i<s.length;i++){const ch=s[i];if(ch==='"'){if(quote&&s[i+1]==='"'){cell+='"';i++;}else quote=!quote;}else if(ch===','&&!quote){row.push(cell);cell='';}else if((ch==='\n'||ch==='\r')&&!quote){if(ch==='\r'&&s[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';}else cell+=ch;}if(quote)throw Error('CSV 引号未闭合');row.push(cell);if(row.some(x=>x.trim()))rows.push(row);if(rows.length<2)throw Error('CSV 需要表头及至少一条记录');const headers=rows.shift()!.map(x=>x.trim());if(new Set(headers).size!==headers.length)throw Error('CSV 存在重复列名');if(!headers.includes('name'))throw Error('CSV 缺少 name 列');return rows.map((r,i)=>{if(r.length!==headers.length)throw Error(`第 ${i+2} 行列数不匹配`);const v=Object.fromEntries(headers.map((k,j)=>[k,r[j].trim()]));const num=(k:string)=>{if(!v[k])return null;const n=Number(v[k]);if(!Number.isFinite(n))throw Error(`第 ${i+2} 行 ${k} 必须是数字`);return n;};if(v.b&&!['true','false','1','0'].includes(v.b))throw Error(`第 ${i+2} 行 b 必须为 true 或 false`);return candidateSchema.parse({id:v.id||`IMP-${crypto.randomUUID().slice(0,8)}`,name:v.name,motif:v.motif||'导入结构',b:v.b==='true'||v.b==='1',provenance:v.provenance||'theory',source:v.source||'用户导入的参数表',method:v.method||'',notes:v.notes||'',shells:pairs.map((p,j)=>({pair:p,n:num(['pd_o_n','pd_ti_n','pd_b_n','pd_pd_n'][j]),r:num(['pd_o_r','pd_ti_r','pd_b_r','pd_pd_r'][j])})).filter(s=>s.n!==null||s.r!==null),rf:num('rf'),chi:num('chi'),nind:num('nind'),variables:num('variables'),fitGroup:v.fitGroup||''});});}
export function parseImport(text:string,filename:string):{candidates:Candidate[],constraints:Constraint[]}{if(filename.toLowerCase().endsWith('.csv'))return {candidates:parseCSV(text),constraints:[]};const raw=JSON.parse(text);if(Array.isArray(raw))return {candidates:z.array(candidateSchema).parse(raw),constraints:[]};const ws=workspaceSchema.parse(raw);return {candidates:ws.candidates,constraints:ws.constraints};}
export function validateMerge(ws:Workspace,imp:{candidates:Candidate[],constraints:Constraint[]}){return workspaceSchema.parse({...ws,candidates:[...ws.candidates,...imp.candidates],constraints:[...ws.constraints,...imp.constraints]});}
