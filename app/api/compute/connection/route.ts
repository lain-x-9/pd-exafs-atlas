import {env} from 'cloudflare:workers';
import {ComputeError,computeUrl,connection,failure,owner,remote,respond,seal} from '@/lib/compute-server';
export const dynamic='force-dynamic';

async function healthResponse(response:Response){
 let value:unknown;
 try{value=await response.json();}catch{
  console.error('exafs_compute_health_non_json',{status:response.status,contentType:response.headers.get('Content-Type')});
  throw new ComputeError('HTTPS 地址返回的不是计算接口 JSON。请只填写隧道域名，不要附加 /health 或网页地址。',502);
 }
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ComputeError('健康检查响应格式不正确，请核对计算接口地址',502);
 const health=value as {ok?:boolean;version?:string};
 if(health.ok!==true||health.version!=='0.1.0')throw new ComputeError('接口版本不匹配，需要 exafs-compute 0.1.0',502);
 return health;
}

export async function GET(){
 let phase='身份验证';
 try{
  const id=await owner();phase='读取已保存的连接';
  const row=await env.DB!.prepare('SELECT base_url,updated_at FROM compute_connections WHERE user_id=?').bind(id).first<{base_url:string;updated_at:string}>();
  return respond(row?{configured:true,baseUrl:row.base_url,updatedAt:row.updated_at,temporary:true}:{configured:false});
 }catch(e){return failure(e,{operation:'connection_get',phase});}
}

export async function PUT(request:Request){
 let phase='身份验证';
 try{
  const id=await owner(request);phase='读取连接设置';
  const text=await request.text();
  if(text.length>6000)throw new ComputeError('连接设置过长');
  let body:unknown;try{body=JSON.parse(text);}catch{throw new ComputeError('连接设置不是有效 JSON，请刷新网页后重试');}
  if(!body||typeof body!=='object'||Array.isArray(body))throw new ComputeError('连接设置格式不正确');
  const input=body as {baseUrl?:unknown;token?:unknown};phase='检查 HTTPS 地址';
  if(typeof input.baseUrl!=='string')throw new ComputeError('请输入完整的 HTTPS 计算接口地址');
  const baseUrl=computeUrl(input.baseUrl);
  phase='检查访问密钥';
  const token=typeof input.token==='string'?input.token.trim():'';
  if(!/^[A-Za-z0-9_-]{32,512}$/.test(token))throw new ComputeError('密钥只填写 EXAFS_API_TOKEN 等号右侧的值，不包括变量名、引号、空格或换行');
  phase='验证服务器接口';
  const response=await remote(baseUrl,token,'/health');
  phase='读取服务器健康检查';
  const health=await healthResponse(response);
  phase='加密保存连接密钥';
  const encrypted=await seal(token,id);
  const now=new Date().toISOString();phase='保存连接设置';
  await env.DB!.prepare('INSERT INTO compute_connections(user_id,base_url,encrypted_token,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET base_url=excluded.base_url,encrypted_token=excluded.encrypted_token,updated_at=excluded.updated_at').bind(id,baseUrl,encrypted,now).run();
  return respond({configured:true,baseUrl,updatedAt:now,temporary:true,health});
 }catch(e){return failure(e,{operation:'connection_save',phase});}
}

export async function POST(request:Request){
 let phase='身份验证';
 try{
  const id=await owner(request);phase='读取已保存的连接';
  const c=await connection(id);phase='验证服务器接口';
  const r=await remote(c.baseUrl,c.token,'/health');phase='读取服务器健康检查';
  return respond({health:await healthResponse(r),checkedAt:new Date().toISOString()});
 }catch(e){return failure(e,{operation:'connection_check',phase});}
}
