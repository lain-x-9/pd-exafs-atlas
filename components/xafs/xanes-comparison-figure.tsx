'use client';
import {useMemo,useState} from 'react';
import {Download} from 'lucide-react';
import type {FdmnesComparison} from '@/lib/fdmnes';
import {xanesFigureSvg} from '@/lib/xanes-figure';
import {safeName} from '@/lib/project-export';
export default function XanesComparisonFigure({comparison,label}:{comparison:FdmnesComparison;label:string}){
 const [showYTicks,setShowYTicks]=useState(false);
 const svg=useMemo(()=>xanesFigureSvg(comparison,label,showYTicks),[comparison,label,showYTicks]);
 function download(){const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=safeName(label)+'_XANES.svg';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <figure className="xanes-publication-figure"><div className="xanes-figure-tools"><label><input type="checkbox" checked={showYTicks} onChange={e=>setShowYTicks(e.target.checked)}/>显示纵轴数值</label><button className="button small" onClick={download}><Download size={14}/>导出 SVG 矢量图</button></div><div className="xanes-figure-canvas" dangerouslySetInnerHTML={{__html:svg}}/><figcaption>黑色点线：实验谱；蓝色实线：理论谱。仅展示已保存比较窗口，沿用报告中的理论能量平移；不额外平滑或缩放曲线。</figcaption></figure>;
}
