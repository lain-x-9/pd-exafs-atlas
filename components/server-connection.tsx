'use client';
import {readApiJson} from '@/lib/http-client';
import {useEffect,useState} from 'react';
import {Link2,LoaderCircle,ShieldCheck} from 'lucide-react';
import type {Connection} from '@/lib/compute-types';
export default function ServerConnection(){
 const [saved,setSaved]=useState<Connection>({configured:false}),[url,setUrl]=useState(''),[token,setToken]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 useEffect(()=>{fetch('/api/compute/connection',{cache:'no-store'}).then(async r=>{const d=await readApiJson<Connection&{error?:string}>(r);if(!r.ok)throw Error(d.error);setSaved(d);setUrl(d.baseUrl||'');}).catch(e=>setError(e.message));},[]);
 async function submit(check=false){
  setBusy(true);setError('');setMessage('');
  try{const r=await fetch('/api/compute/connection',{method:check?'POST':'PUT',headers:{'Content-Type':'application/json'},body:check?undefined:JSON.stringify({baseUrl:url,token})}),d=await readApiJson<Connection&{error?:string}>(r);if(!r.ok)throw Error(d.error);if(!check){setSaved(d);setToken('');window.dispatchEvent(new Event('compute-connection-updated'));}setMessage(check?'已保存的计算接口当前可访问':'已验证并保存。MACE、FDMNES 和 EXAFS 共用此连接。');}catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <section className="panel workspace-card connection-settings"><div className="workspace-section-title"><Link2 size={22}/><div><h2>一个连接，服务全部计算</h2><p>配置阿里云上的计算接口。密钥只用于加密保存和接口鉴权，不写入浏览器存储。</p></div></div>{saved.configured&&<p className="sl-success">已保存地址：{saved.baseUrl}</p>}
 <form onSubmit={e=>{e.preventDefault();void submit();}}><label>HTTPS 接口地址<input type="url" required value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://example.trycloudflare.com"/></label><label>计算接口访问密钥<input type="password" required value={token} onChange={e=>setToken(e.target.value)} autoComplete="off" placeholder="EXAFS_API_TOKEN 等号右侧的值"/></label><div className="sl-actions"><button className="button primary" disabled={busy}>{busy?<LoaderCircle size={14} className="spin"/>:<ShieldCheck size={14}/>}验证并保存新设置</button><button className="button" type="button" disabled={!saved.configured||busy} onClick={()=>submit(true)}>检查已保存的连接</button></div></form>
 {error&&<div className="form-error" role="alert">{error}</div>}{message&&<p className="sl-success" role="status">{message}</p>}
 <p className="sl-caption">“检查已保存的连接”使用上次保存的地址。修改地址后需先“验证并保存新设置”。临时隧道重建后地址可能变化。</p>
 <details><summary>计算扩展与升级</summary><p>MACE 环境已安装并验收；FDMNES 扩展 v2 提供自定义能量范围、展宽和原生阶段日志。</p><a className="button" href="/downloads/fdmnes-extension-v2.zip" download>下载 FDMNES 扩展 v2</a><p>上传并解压至 /opt/exafs-app 后，在服务器空闲时执行：</p><pre>{'cd /opt/exafs-app/fdmnes-extension\n/opt/exafs-app/.venv/bin/python install.py --restart'}</pre><p>升级会复用已有 FDMNES 引擎；尚未安装引擎时按包内说明安装。</p><a className="button" href="/downloads/exafs-mace-addon-v1.zip" download>下载 MACE 接入包</a></details>
 </section>;
}
