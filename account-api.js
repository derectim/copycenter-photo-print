const readActions = new Set(['libraryList','draftList','draftLoad','phoneInbox','basketProjects']);
const uploadActions = new Set(['upload','libraryUpload','phoneUpload']);
export function createAccountAPI(endpoint, sessid, userId) {
  async function call(action,args={}) {
    if (!endpoint) return (await import('./demo-account.js')).demoCall(action,args);
    const url=new URL(endpoint);
    if (url.origin!==location.origin) throw Error('Аккаунт должен находиться на домене магазина.');
    url.searchParams.set('action',action);
    const init={credentials:'same-origin',cache:'no-store',headers:{'X-Photoprint-User':String(userId()||0)}};
    if (readActions.has(action)) {
      for(const [key,val] of Object.entries(args)) if (val != null) url.searchParams.set(key,val);
    } else if(uploadActions.has(action)){
      init.method='POST';
      init.body=new FormData();
      init.body.set('sessid',sessid());
      for(const [key,val] of Object.entries(args)) if(val!=null) init.body.set(key,val);
    } else {
      init.method='POST';
      init.headers['Content-Type']='application/json';
      init.body=JSON.stringify({...args,sessid:sessid()});
    }
    const response=await fetch(url,init);
    const data=await response.json().catch(()=>({error:'Не удалось прочитать ответ магазина.'}));
    if (!response.ok || data.error) {
      const e=Error(data.error || 'Не удалось выполнить запрос.');
      e.code=data.code; throw e;
    }
    return data;
  }
  async function file(info) {
    if(!endpoint) return (await import('./demo-account.js')).demoFile(info);
    const url=new URL(info.url,location.href);
    if(url.origin!==location.origin) throw Error('Недопустимый адрес фотографии.');
    const response=await fetch(url,{credentials:'same-origin',cache:'no-store',headers:{'X-Photoprint-User':String(userId()||0)}});
    if(!response.ok) throw Error('Фотография недоступна или истёк срок хранения.');
    const blob=await response.blob();
    return new File([blob],info.name,{type:blob.type});
  }
  return {call,file,demo:!endpoint};
}
