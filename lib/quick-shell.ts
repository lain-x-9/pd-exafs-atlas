import {z} from 'zod';
import type {ComputeJob,PathRow} from './compute-types.ts';
export const quickShellSchema=z.object({scatterer:z.enum(['B','C','N','O','F','Si','P','S','Cl','Ti','Fe','Co','Ni','Cu','Zn','Pd']),distance:z.number().finite().min(1.3).max(3),kmax:z.number().finite().min(8).max(20),firstShell:z.literal(true)}).strict();
export type QuickShellInput=z.infer<typeof quickShellSchema>;
export type QuickShellSource={method:'qfs-rocksalt-v1';absorber:'Pd';edge:'K';scatterer:string;nominalDistance:number;firstShellOnly:true;scaffoldOnly:true;target?:string};
export type QuickShellRecord={id:string;created:string;input:QuickShellInput;state:'structure'|'feff'|'ready'|'failed'|'interrupted';structure?:string;feff?:string;error?:string};
export function quickShellSource(q:QuickShellInput):QuickShellSource{return {method:'qfs-rocksalt-v1',absorber:'Pd',edge:'K',scatterer:q.scatterer,nominalDistance:q.distance,firstShellOnly:true,scaffoldOnly:true};}
/** Artificial rock-salt calculation scaffold, never an inferred sample structure. */
export function quickShellPoscar(q:QuickShellInput){
 const a=2*q.distance;const first=['0 0 0','0 .5 .5','.5 0 .5','.5 .5 0'],second=['.5 0 0','0 .5 0','0 0 .5','.5 .5 .5'];
 return ['QFS artificial rock-salt scaffold; NOT a predicted sample structure','1.0',`${a} 0 0`,`0 ${a} 0`,`0 0 ${a}`,q.scatterer==='Pd'?'Pd':`Pd ${q.scatterer}`,q.scatterer==='Pd'?'8':'4 4','Direct',...first,...second,''].join('\n');
}
export function quickShellFeff(q:QuickShellInput,j:ComputeJob){
 const r=j.result;const atoms=r?.atoms||[];const center=atoms.find(a=>a.element==='Pd'&&a.position.length===3&&a.position.every(v=>Math.abs(v)<1e-5));
 if(j.kind!=='structure'||j.state!=='succeeded'||r?.atom_count!==8||!r.pbc?.every(Boolean)||r.pbc.length!==3||!center)throw Error('快速壳层计算簇解析异常，未找到预期的周期晶胞与吸收原子');
 return {structure_job:j.id,absorber_index:center.index,edge:'K',cluster_radius:Math.max(5,2*q.distance),rpath:q.distance*1.1,kmax:q.kmax,nleg:2,potential_mode:'non_scf'};
}
export function quickShellPath(q:QuickShellInput,rows:PathRow[]){
 const candidates=rows.filter(p=>p.nleg===2&&p.geometry?.length===2&&String(p.geometry[1][0])===q.scatterer&&Math.abs(p.reff-q.distance)<.02);
 if(candidates.length!==1||Math.abs(candidates[0].degen-6)>.01)throw Error('未找到唯一且几何简并度为 6 的最近邻单散射路径；请检查 FEFF 报告，不能使用其他路径替代');
 return candidates[0];
}
