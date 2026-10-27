import {z} from 'zod';
export const fdmnesRunSchema=z.object({
 action:z.literal('run'),structure_job:z.string().regex(/^[a-f0-9]{32}$/),
 absorber_index:z.number().int().min(0).max(999),edge:z.enum(['K','L1','L2','L3']),
 radius:z.number().finite().min(3).max(6),method:z.enum(['finite_difference','green']),scf:z.boolean(),
 emin:z.number().finite().min(-200).max(2000),emax:z.number().finite().min(-200).max(2000),
 step:z.number().finite().min(.05).max(10),gaussian:z.number().finite().min(0).max(10),
 broadening:z.enum(['native','none']).default('native'),
 gamma_hole:z.number().finite().positive().max(50).nullable().optional(),
 gamma_max:z.number().finite().min(0).max(100).nullable().optional(),
 ecent:z.number().finite().positive().max(500).nullable().optional(),
 elarg:z.number().finite().positive().max(500).nullable().optional(),
 reviewed:z.literal(true),
}).superRefine((v,ctx)=>{
 if(v.emax<=v.emin)ctx.addIssue({code:'custom',message:'计算能量上限必须大于下限'});
 const points=Math.floor((v.emax-v.emin)/v.step)+1;
 if(points<40||points>6000)ctx.addIssue({code:'custom',message:'计算网格需为 40–6000 点，请调整范围或步长'});
 if(v.broadening==='none'&&(v.gaussian!==0||[v.gamma_hole,v.gamma_max,v.ecent,v.elarg].some(x=>x!=null)))ctx.addIssue({code:'custom',message:'不展宽模式不能同时指定卷积参数'});
});
export type FdmnesRun=z.infer<typeof fdmnesRunSchema>;
export function forFdmnesProtocol(config:Omit<FdmnesRun,'action'>,protocol:number){
 if(protocol===2)return config;
 const {broadening,gamma_hole,gamma_max,ecent,elarg,...legacy}=config;
 if(protocol!==1||broadening!=='native'||[gamma_hole,gamma_max,ecent,elarg].some(x=>x!=null)||config.emin< -30||config.emin> -15||config.emax<100||config.emax>180||config.step<.25||config.step>1||config.gaussian>5)throw Error('这些自定义参数需要 FDMNES 扩展 v2。请到“服务器连接”下载升级包，升级后原设置继续使用。');
 return legacy;
}
