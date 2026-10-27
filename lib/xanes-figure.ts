import type {FdmnesComparison} from './fdmnes';
const xml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
export function xanesFigureSvg(comparison:FdmnesComparison,label:string,yTicks=false){
 const {energy,experiment,theory}=comparison;
 if(energy.length<2||experiment.length!==energy.length||theory.length!==energy.length||energy.some((x,i)=>!Number.isFinite(x)||!Number.isFinite(experiment[i])||!Number.isFinite(theory[i])||i>0&&x<=energy[i-1]))throw Error('绘图数据长度、数值或能量顺序无效');
 const x0=energy[0],x1=energy[energy.length-1];let ymin=0,ymax=1;
 for(let i=0;i<energy.length;i++){ymin=Math.min(ymin,experiment[i],theory[i]);ymax=Math.max(ymax,experiment[i],theory[i]);}
 const pad=(ymax-ymin)*.12;const y0=ymin-pad*.35,y1=ymax+pad;
 const left=106,right=865,top=28,bottom=579,width=right-left,height=bottom-top;
 const x=(v:number)=>left+(v-x0)/(x1-x0)*width,y=(v:number)=>bottom-(v-y0)/(y1-y0)*height;
 const path=(values:number[])=>energy.map((e,i)=>(i?'L':'M')+x(e).toFixed(3)+','+y(values[i]).toFixed(3)).join(' ');
 const approximate=(x1-x0)/6,base=10**Math.floor(Math.log10(approximate));const step=([1,2,5,10].find(v=>v*base>=approximate)||10)*base;
 const ticks:number[]=[];for(let value=Math.ceil(x0/step)*step;value<=x1+step*1e-7&&ticks.length<20;value+=step)ticks.push(value);
 const digits=step>=1?0:Math.max(0,Math.ceil(-Math.log10(step)));
 const xTicks=ticks.map(v=>`<path d="M${x(v)} ${bottom}v10"/><text x="${x(v)}" y="${bottom+35}" text-anchor="middle" stroke="none">${v.toFixed(digits)}</text>`).join('');
 const minor=ticks.slice(0,-1).map(v=>`<path d="M${x(v+step/2)} ${bottom}v5"/>`).join('');
 const ys=yTicks?Array.from({length:5},(_,i)=>ymin+(ymax-ymin)*i/4).map(v=>`<path d="M${left} ${y(v)}h-8"/><text x="${left-14}" y="${y(v)+7}" stroke="none" text-anchor="end">${v.toFixed(2)}</text>`).join(''):'';
 const legend=label.length>48?label.slice(0,47)+'…':label;const legendWidth=Math.min(705,Math.max(230,legend.length*15+114));
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 675" width="900" height="675" role="img" aria-label="${xml(label)}：实验与理论归一化 XANES 对照"><title>${xml(label)} · XANES</title><desc>Black dotted line: experiment. Blue solid line: theory. The recorded theory energy shift is applied; no extra smoothing, scaling or experimental data change.</desc><metadata>${xml(JSON.stringify({label,energy_eV:energy,experiment_norm:experiment,theory_norm:theory,alignment:comparison.alignment,comparison_window_eV:[comparison.emin,comparison.emax]}))}</metadata><rect width="900" height="675" fill="white"/><g font-family="Arial,Helvetica,sans-serif" fill="#111111"><rect x="${left}" y="${top}" width="${width}" height="${height}" fill="white" stroke="#111111" stroke-width="2.8"/><g stroke="#111111" stroke-width="2.2" font-size="22" font-weight="600">${xTicks}${minor}${ys}</g><path d="${path(experiment)}" fill="none" stroke="#111111" stroke-width="2.7" stroke-dasharray=".5 5.5" stroke-linecap="round"/><path d="${path(theory)}" fill="none" stroke="#4dbbea" stroke-width="2.8"/><rect x="${left+12}" y="${top+10}" width="${legendWidth}" height="72" fill="white" fill-opacity=".95" stroke="#777777" stroke-width=".8"/><path d="M${left+23},${top+32}h48" stroke="#111111" stroke-width="2.7" stroke-dasharray=".5 5.5" stroke-linecap="round"/><path d="M${left+23},${top+61}h48" stroke="#4dbbea" stroke-width="2.8"/><g font-size="20"><text x="${left+82}" y="${top+39}">${xml(legend)} exp</text><text x="${left+82}" y="${top+68}">theo</text></g><text x="${(left+right)/2}" y="650" text-anchor="middle" font-size="25" font-weight="600">Energy (eV)</text><text x="31" y="${(top+bottom)/2}" text-anchor="middle" font-size="25" font-weight="600" transform="rotate(-90 31 ${(top+bottom)/2})">Normalized intensity (a.u.)</text></g></svg>`;
}
