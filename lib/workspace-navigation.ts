export const workspaceGroups=[
 {label:'按任务开始',items:[{id:'experiment',label:'我有实验谱'},{id:'prediction',label:'我有候选结构'},{id:'validation',label:'实验谱 + 多个模型'}]},
 {label:'数据准备',items:[{id:'spectra',label:'实验谱库'},{id:'assistant',label:'谱预处理'}]},
 {label:'计算分析',items:[{id:'mace',label:'结构预优化 · MACE'},{id:'xanes',label:'近边理论谱 · FDMNES'},{id:'compute',label:'EXAFS 拟合'}]},
 {label:'结果管理',items:[{id:'tasks',label:'任务中心'},{id:'library',label:'结构参数记录'},{id:'compare',label:'参数并排对照'},{id:'constraints',label:'实验约束'}]},
 {label:'设置与帮助',items:[{id:'settings',label:'服务器连接'},{id:'guide',label:'使用说明'}]},
] as const;
export type WorkspaceView='home'|typeof workspaceGroups[number]['items'][number]['id'];
export const workspaceLabels:Record<WorkspaceView,string>={experiment:'实验谱分析任务',prediction:'结构预测任务',validation:'实验与多模型验证任务',home:'研究工作台',spectra:'实验谱库',assistant:'谱预处理',mace:'结构预优化 · MACE',xanes:'近边理论谱 · FDMNES',compute:'EXAFS 拟合 · FEFF / Larch',tasks:'任务中心',library:'结构参数记录',compare:'参数并排对照',constraints:'实验约束',settings:'服务器连接',guide:'使用说明'};
export const workspaceDescriptions:Record<WorkspaceView,string>={
 experiment:'从实验谱出发，完成检查、预处理、参考谱分析和无结构第一壳层探索。',
 prediction:'从候选结构出发，生成明确标为预测的理论谱；无需实验谱。',
 validation:'关联同一实验目标与多个模型，检查比较条件，保存证据与无法区分的判断。',
 home:'从你的分析目标开始：检查实验数据、了解局部配位，或比较候选结构与实验谱。',
 spectra:'保存原始实验文件，查看文件内的各条谱及处理记录。',
 assistant:'处理 Athena 工程或单条谱，检查归一化、背景扣除和拟合日志。',
 mace:'上传候选结构，用 MACE 预优化原子位置；保留原始结构、固定设置与优化轨迹。',
 xanes:'由 CIF 计算理论 XANES，自定义能量网格和展宽，再与实验近边比较。',
 compute:'从实验 χ(k) 出发，可用快速第一壳层或已有结构路径检验配位假设。',
 tasks:'统一查看计算状态、当前阶段、耗时、日志及实际提交的参数。',
 library:'保存候选配位环境的派生参数与来源。',
 compare:'逐项比较候选结构、实验约束和拟合质量。',
 constraints:'管理用于对照的实验派生参数与手动容差。',
 settings:'统一管理 MACE、FDMNES、FEFF 与 Larch 共用的服务器连接。',
 guide:'按数据准备、计算分析和结果管理完成一次研究流程。',
};
export function isWorkspaceView(value:string):value is WorkspaceView{return Object.hasOwn(workspaceLabels,value);}
