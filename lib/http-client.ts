/** Parse API responses without exposing HTML, credentials or raw upstream pages to the UI. */
export async function readApiJson<T>(response:Response):Promise<T>{
 const text=await response.text();
 if(/^\s*</.test(text)||response.headers.get('content-type')?.includes('text/html')){
  const blocked=/Sorry, you have been blocked|Attention Required! \| Cloudflare/i.test(text);
  throw Error(blocked?`网站访问被 Cloudflare 防护拦截（HTTP ${response.status}）。请保留拦截页的 Ray ID 联系支持；不要重复提交计算。`:`接口返回了 HTML 页面（HTTP ${response.status}），可能是登录页、访问拦截或服务错误。请重新打开工作台检查登录；已有计算可能仍在运行。`);
 }
 let data:unknown;try{data=JSON.parse(text);}catch{throw Error(`接口返回的内容不是有效 JSON（HTTP ${response.status}）。请刷新任务状态，不要重复提交计算。`);}
 if(!response.ok){const error=data&&typeof data==='object'&&'error' in data?String(data.error):response.status===401?'请重新使用 ChatGPT 登录':`请求失败（HTTP ${response.status}）`;throw Error(error);}
 if(data===null||typeof data!=='object')throw Error('接口响应结构无效，请刷新后重试');
 return data as T;
}
