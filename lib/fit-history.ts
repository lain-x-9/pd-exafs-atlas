import type {Param,PathDraft,PathRow} from './compute-types.ts';
import {initialPath} from './compute-types.ts';
const isParam=(v:unknown):v is Param=>{const p=v as Param;return !!p&&typeof p.vary==='boolean'&&[p.value,p.min,p.max].every(Number.isFinite)&&p.min<p.max&&p.value>=p.min&&p.value<=p.max;};
/** Restore saved model settings only; the archived upload must never become a new target implicitly. */
export function fitHistorySettings(request:Record<string,unknown>,rows:PathRow[]){
 const numeric=['kmin','kmax','rmin','rmax','kweight','dk'] as const;
 if(!numeric.every(k=>typeof request[k]==='number'&&Number.isFinite(request[k]))||!isParam(request.s02)||!isParam(request.e0)||!Array.isArray(request.paths))throw Error('历史拟合参数不完整；请查看原报告，不能用默认参数替代历史记录。');
 const saved=request.paths as PathDraft[];
 if(saved.some(p=>!rows.some(r=>r.filename===p.filename)||!isParam(p.deltar)||!isParam(p.sigma2)||p.coordination!=null&&!isParam(p.coordination)))throw Error('历史路径与 FEFF 记录不一致，请查看原报告。');
 if(request.window!=='hanning'&&request.window!=='kaiser')throw Error('历史窗函数未识别');
 return {kmin:request.kmin as number,kmax:request.kmax as number,rmin:request.rmin as number,rmax:request.rmax as number,kweight:request.kweight as number,dk:request.dk as number,window:request.window,s02:{...request.s02},e0:{...request.e0},provenance:typeof request.provenance==='string'?request.provenance:'',paths:rows.map(row=>{const p=saved.find(p=>p.filename===row.filename);return p?{...p,selected:true,deltar:{...p.deltar},sigma2:{...p.sigma2},coordination:p.coordination?{...p.coordination}:null}:initialPath(row);})};
}
