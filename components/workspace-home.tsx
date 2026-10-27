 'use client';
import {Activity,Atom,ArrowRight,FileText,FolderOpen,ListChecks,Server} from 'lucide-react';
import type {WorkspaceView} from '@/lib/workspace-navigation';
export default function WorkspaceHome({onNavigate}:{onNavigate:(view:WorkspaceView)=>void}){
 const cards=[
 {id:'experiment' as const,icon:FolderOpen,title:'我有实验谱',engine:'实验数据 → 配位与近边分析',text:'先检查与处理数据。没有 CIF 时可探索第一壳层；已有参考谱可做近边分析。'},
 {id:'prediction' as const,icon:Atom,title:'我有候选结构',engine:'候选结构 → 理论预测谱',text:'检查结构、可选预优化，生成并查看预测谱。不要求先选择实验谱。'},
 {id:'validation' as const,icon:Activity,title:'实验谱 + 多个模型',engine:'共同条件 → 证据比较',text:'关联一个实验目标与多个候选模型，统一比较条件，保存“目前无法区分”的判断。'},
 ];
 return <div className="workspace-home"><section className="panel workspace-card"><h2>你现在想做什么？</h2><p>按手头材料选择一条任务流程。原始实验谱、候选结构、理论预测和实验拟合分别保留，通过分析任务关联。</p></section><div className="workspace-home-grid beginner-cards">{cards.map(c=><button className="workspace-workflow-card" key={c.id} onClick={()=>onNavigate(c.id)}><c.icon size={27}/><small>{c.engine}</small><h2>{c.title}</h2><p>{c.text}</p><b>开始这项分析 <ArrowRight size={15}/></b></button>)}</div><section className="panel workspace-card"><h2>继续已有工作</h2><div className="sl-actions"><button className="button" onClick={()=>onNavigate('spectra')}><FolderOpen size={15}/>查看保存的实验谱</button><button className="button" onClick={()=>onNavigate('tasks')}><ListChecks size={15}/>查看任务和结果</button><button className="button" onClick={()=>onNavigate('mace')}><Atom size={15}/>可选：预优化结构</button><button className="button" onClick={()=>onNavigate('settings')}><Server size={15}/>服务器连接</button></div></section></div>;
}
