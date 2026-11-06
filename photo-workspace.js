import {createAccountAPI} from './account-api.js';
import {openLibrary} from './photo-library.js';
import {readPrintAsset} from './photo-input.js';

function node(tag,text='',cls=''){
  const e=document.createElement(tag);e.textContent=text;e.className=cls;return e;
}
function button(text,run,cls='button secondary'){
  const e=node('button',text,cls);e.type='button';e.addEventListener('click',run);return e;
}
function timeText(value){
  if (!value) return '';
  const ms=typeof value==='number'&&value<1e12?value*1000:value;
  return new Date(ms).toLocaleString('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'});
}
function qrCanvas(qrcode,text){
  const code=qrcode(0,'M'); code.addData(text,'Byte');code.make();
  const n=code.getModuleCount(),scale=5,quiet=4;
  const canvas=node('canvas','','qr-code');canvas.width=canvas.height=(n+quiet*2)*scale;
  canvas.setAttribute('aria-label','QR-код для добавления фотографий с телефона');
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#141713';
  for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(code.isDark(y,x))ctx.fillRect((x+quiet)*scale,(y+quiet)*scale,scale,scale);
  return canvas;
}

export async function connectWorkspace(ui,data) {
  const local=!ui.endpoint ? await import('./demo-account.js'):null;
  let auth=local ? local.demoAuth():data.auth;
  const api=createAccountAPI(ui.endpoint,()=>ui.sessid(),()=>auth?.userId);
  const keys=new URL(location.href).searchParams;
  let draftId=keys.get('photo_draft') || crypto.randomUUID();
  let editJob=keys.get('photo_job') || null;
  let revision=0, last='',allowSave=false, blocked=false, timer, chain=Promise.resolve(), scheduled=false;
  let pollTimer, fetching=false, sessionEnding=false;
  const status=ui.$('draft-status');
  const message=text=>{status.textContent=text;};
  function report(error) {
    if(error.code==='AUTH_REQUIRED'){auth={...auth,authorized:false};profileLabel();}
    ui.feedback(error.message,'error');
  }
  const launch=fn=>async(...args)=>{try{return await fn(...args);}catch(e){report(e);}};
  const phoneKey=keys.get('photo_pair');
  const requireAuth=()=>{if(!auth?.authorized)throw Error('Для работы с фотографиями войдите в аккаунт сайта.');};
  function writeAddress(){
    if(phoneKey)return;
    const url=new URL(location.href);url.searchParams.set('photo_draft',draftId);
    if(editJob)url.searchParams.set('photo_job',editJob);else url.searchParams.delete('photo_job');
    history.replaceState(history.state,'',url);
  }
  function profile(after) {
    const dialog=ui.showDialog(auth?.authorized?'Аккаунт фотопечати':'Вход для загрузки фото');
    if(auth?.authorized){
      dialog.content.append(node('p',local?'Демопрофиль этого браузера. Файлы и заказы доступны в нём после входа.':'Вы вошли в аккаунт магазина.'));
      if(local)dialog.actions.append(button('Выйти из демопрофиля',launch(async()=>{await save();local.demoSignOut();location.reload();})));
      dialog.actions.append(button('Закрыть',dialog.close));return;
    }
    dialog.content.append(node('p',local?'На GitHub Pages используется локальный демопрофиль. В магазине для загрузки понадобится обычный аккаунт «Копицентра».':'Войдите в аккаунт магазина. После входа вы вернётесь к конструктору.'));
    if(local)dialog.actions.append(button('Войти в демопрофиль',launch(async()=>{
      local.demoSignIn();auth=local.demoAuth();profileLabel();dialog.close();
      if(phoneKey)await phoneScreen();else if(after)await after();
    }),'button primary'));
    else {
      const login=node('a','Войти на сайт','button primary');
      const url=new URL(auth?.loginUrl || '/bitrix/tools/copycenter.photoprint/signin.php',location.origin);
      if(url.origin!==location.origin)throw Error('Проверьте адрес авторизации магазина.');
      url.searchParams.set('backurl',location.pathname+location.search+location.hash);login.href=url.href;
      dialog.actions.append(login);
    }
  }
  function profileLabel(){ui.$('profile-open').textContent=auth?.authorized?(local?'Демопрофиль':'Мой аккаунт'):(local?'Войти в демо':'Войти');}
  const gate=work=>auth?.authorized?launch(work)():profile(work);

  async function saveOnce(force){
    if(!auth?.authorized||!allowSave||blocked||phoneKey||sessionEnding)return;
    const target=draftId;
    if(!force&&!ui.rows().length&&!revision)return;
    const assets=[...new Set(ui.rows().map(p=>p.asset))];
    for(const [index,asset] of assets.entries()){
      if(!asset.assetId) {
        message('Сохраняем оригинал '+(index+1)+' из '+assets.length+': '+asset.file.name);
        asset.assetId=(await api.call('upload',{draftId:target,file:asset.file})).assetId;
      }
      if(!asset.assetId)throw Error('Исходник не сохранился в черновике.');
    }
    if(target!==draftId)return;
    const state=ui.snapshot();
    if(state.groups.some(g=>g.photos.some(row=>!row.assetId))){scheduled=true;return;}
    const signature=JSON.stringify(state);
    if(signature===last && revision)return;
    const result=await api.call('draftSave',{draftId,revision,state});
    if(target!==draftId)return;
    revision=result.revision;last=signature;writeAddress();
    message('Черновик сохранён · '+timeText(result.updatedAt)+' · хранится 3 дня');
  }
  function save(force=false){
    clearTimeout(timer);
    const pending=chain.catch(()=>{}).then(async()=>{
      if(blocked)throw Error('Черновик изменился в другой вкладке. Откройте сохранённую версию в разделе «Черновики».');
      do{scheduled=false;await saveOnce(force);}while(scheduled);
    });
    chain=pending.catch(e=>{if(e.code==='DRAFT_CONFLICT')blocked=true;if(e.code==='AUTH_REQUIRED')report(e);message('Сохранение черновика: '+e.message);throw e;});
    chain.catch(()=>{});
    return chain;
  }
  function changed(){
    if(!allowSave||blocked||phoneKey||!auth?.authorized||sessionEnding)return;
    if((revision||ui.rows().length)&&JSON.stringify(ui.snapshot())!==last)message('Сохраняем изменения…');
    clearTimeout(timer);timer=setTimeout(()=>save().catch(()=>{}),650);
  }
  async function restore(id,{copy=false,job=null,ignoreCurrent=false}={}){
    if(!ignoreCurrent && !blocked)await save();
    const loaded=await api.call('draftLoad',{draftId:id});
    if(!loaded.state)throw Error('В черновике пока нет сохранённых фотографий.');
    const infos=new Map(loaded.assets.map(a=>[a.assetId,a]));
    const assets=new Map();
    try{
      for(const key of new Set(loaded.state.groups.flatMap(g=>g.photos.map(p=>p.assetId)))){
        if(!infos.has(key))throw Error('Один из оригиналов черновика недоступен.');
        message('Восстанавливаем фото '+(assets.size+1)+'…');
        const asset=await readPrintAsset(await api.file(infos.get(key)));
        if(!copy)asset.assetId=key;assets.set(key,asset);
      }
    }catch(e){for(const a of assets.values())URL.revokeObjectURL(a.url);throw e;}
    allowSave=false;
    try{
      ui.restore(loaded.state,assets);
      draftId=copy?crypto.randomUUID():id;editJob=copy?null:job;
      revision=copy?0:loaded.revision;last=copy?'':JSON.stringify(ui.snapshot());blocked=false;
      writeAddress();message(copy?'Сохраняем копию черновика…':'Черновик открыт · '+timeText(loaded.updatedAt));
    }finally{allowSave=true;}
    if(copy)await save(true);
    startPolling();
  }
  async function openDrafts(){
    const dialog=ui.showDialog('Мои черновики');
    dialog.content.append(node('p','Черновики хранятся 3 дня с последнего изменения.','review-note'));
    if(!blocked)await save();
    const {drafts}=await api.call('draftList');
    for(const [i,draft] of drafts.entries()){
      const row=node('div','','draft-row'),actions=node('div','','lib-actions');
      const title=node('strong',draft.name||'Черновик от '+timeText(draft.updatedAt));
      row.append(title);
      if(draft.expiresAt)row.append(node('p','Доступен до '+timeText(draft.expiresAt)));
      actions.append(button('Открыть',launch(async()=>{await restore(draft.draftId,{job:draft.draftId===draftId?editJob:null});dialog.close();})),
        button('Дублировать',launch(async()=>{await restore(draft.draftId,{copy:true});dialog.close();})),
        button('Удалить',launch(async()=>{
          if(!confirm('Удалить этот черновик и его исходники?'))return;
          await api.call('draftDelete',{draftId:draft.draftId,revision:draft.revision});
          if(draft.draftId===draftId)newProject();
          row.remove();
        })));
      row.dataset.index=i;row.append(actions);dialog.content.append(row);
    }
    if(!drafts.length)dialog.content.append(node('p','Черновиков пока нет.'));
    dialog.actions.append(button('Новый заказ',()=>{newProject();dialog.close();},'button primary'));
  }
  function newProject(){
    allowSave=false;ui.reset();draftId=crypto.randomUUID();editJob=null;revision=0;last='';blocked=false;allowSave=true;
    clearTimeout(pollTimer);clearTimeout(timer);writeAddress();message('Новый черновик');
  }
  async function projects(){
    const {projects}=await api.call('basketProjects');
    const dialog=ui.showDialog('Фотопечать в корзине');
    if(!projects.length)dialog.content.append(node('p','В текущей корзине пока нет проектов фотопечати.'));
    for(const job of projects){
      const row=node('div','','draft-row'),actions=node('div','','lib-actions');
      row.append(node('strong',job.centerLabel+' · '+job.total.toLocaleString('ru-RU')+' ₽'));
      if(job.draftId)actions.append(button('Изменить',launch(async()=>{await restore(job.draftId,{job:job.jobId});dialog.close();})),
        button('Дублировать',launch(async()=>{await restore(job.draftId,{copy:true});dialog.close();})));
      actions.append(button('Убрать из корзины',launch(async()=>{
        if(!confirm('Убрать этот проект из корзины?'))return;
        await api.call('basketRemove',{jobId:job.jobId});row.remove();if(editJob===job.jobId){editJob=null;writeAddress();}
      })));
      row.append(actions);dialog.content.append(row);
    }
  }
  async function fetchInbox(){
    if(fetching||!allowSave||blocked||sessionEnding||document.hidden||ui.busy()||!auth?.authorized||phoneKey)return;
    fetching=true;
    const target=draftId;
    try{
      const {photos}=await api.call('phoneInbox',{draftId:target});
      if(!photos.length||draftId!==target)return;
      const acknowledged=[];
      for(const photo of photos){
        if(target!==draftId)break;
        if(!ui.containsAsset(photo.assetId,photo.formatId)){
          const source=await api.file(photo);
          if(target!==draftId)return;
          await ui.addRemote(photo,source);
        }
        acknowledged.push(photo.assetId);
      }
      if(target!==draftId)return;
      await save(true);
      if(target!==draftId)return;
      if(acknowledged.length)await api.call('phoneAck',{draftId:target,assetIds:acknowledged});
      ui.feedback('Добавлены фотографии с телефона: '+acknowledged.length);
    }catch(e){message(e.message);}finally{fetching=false;}
  }
  function startPolling(){
    clearTimeout(pollTimer);
    const poll=async()=>{await fetchInbox();if(!sessionEnding)pollTimer=setTimeout(poll,6500);};
    pollTimer=setTimeout(poll,1500);
  }
  async function qr(){
    await save(true);
    const pair=await api.call('pairCreate',{draftId,formatId:ui.activeFormat()});
    const url=new URL(location.pathname,location.origin);
    url.searchParams.set('photo_pair',pair.token);url.hash='print-app';
    const qrcode=(await import('./vendor/qr/qrcode.js')).default;
    const dialog=ui.showDialog('Добавить фото с телефона');
    dialog.content.append(qrCanvas(qrcode,url.href),node('p',api.demo
      ?'В демо откройте ссылку во второй вкладке этого браузера. На сайте Битрикса её можно сканировать телефоном и войти в тот же аккаунт.'
      :'Отсканируйте QR-код телефоном и войдите в тот же аккаунт магазина. Снимки появятся в выбранном формате этого заказа.','qr-note'));
    dialog.content.append(node('p','Ссылка действует до '+timeText(pair.expiresAt)+'.','review-note'));
    const link=node('a','Открыть ссылку для загрузки','qr-link');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';
    dialog.content.append(link);
    dialog.actions.append(button('Отозвать ссылку',launch(async()=>{await api.call('pairRevoke',{draftId});dialog.close();})),
      button('Готово',dialog.close,'button primary'));
    startPolling();
  }
  async function phoneScreen(){
    const screen=ui.$('phone-screen');
    screen.hidden=false;screen.replaceChildren(node('h2','Фотографии с телефона'));
    ui.root.querySelector('.work-grid').hidden=true;ui.root.querySelector('.account-tools').hidden=true;
    if(!auth?.authorized){
      screen.append(node('p','Войдите в тот же аккаунт, который открыт на компьютере.'),button(local?'Войти в демопрофиль':'Войти на сайт',()=>profile(),'button primary'));return;
    }
    try{
      const info=await api.call('pairInfo',{token:phoneKey});
      const input=node('input');input.type='file';input.multiple=true;input.accept='image/jpeg,image/png,image/webp,.heic,.heif';
      const label=node('label','Выберите фотографии для формата '+info.formatId);label.append(input);
      const out=node('p');out.setAttribute('role','status');screen.append(label,out);
      input.addEventListener('change',async()=>{
        const files=[...input.files];input.disabled=true;
        let count=0;const errors=[];
        try{
          for(const file of files){
            out.textContent='Передаём '+file.name+'…';
            try{await api.call('phoneUpload',{token:phoneKey,file});count++;}
            catch(e){errors.push(file.name+': '+e.message);}
          }
          out.textContent='Добавлено в заказ: '+count+'. '+errors.join(' ');
        }finally{input.value='';input.disabled=false;}
      });
    }catch(e){screen.append(node('p',e.message));}
  }
  async function library(){
    await openLibrary({showDialog:ui.showDialog,api,notify:ui.feedback,addPhotos:async items=>{
      const files=[];
      for(const photo of items)files.push(await api.file(photo));
      await ui.loadFiles(files);
      await save();
    }});
  }
  async function saveSelection(photos){
    if(!photos.length)return;
    await save(true);
    let count=0;
    for(const asset of new Set(photos.map(photo=>photo.asset))){
      await api.call('libraryCapture',{draftId,assetId:asset.assetId});count++;
    }
    ui.feedback('Сохранено в библиотеку: '+count+'. Срок хранения — один месяц.');
  }
  profileLabel();ui.$('profile-open').onclick=()=>profile();
  ui.$('library-open').onclick=()=>gate(library);
  ui.$('phone-open').onclick=()=>gate(qr);
  ui.$('drafts-open').onclick=()=>gate(openDrafts);
  ui.$('projects-open').hidden=api.demo;
  ui.$('projects-open').onclick=()=>gate(projects);
  allowSave=true;
  if(phoneKey){await phoneScreen();}
  else if(keys.has('photo_draft')&&auth?.authorized){
    try{await restore(draftId,{job:editJob,ignoreCurrent:true});}
    catch(e){allowSave=false;message(e.message+' Откройте другой черновик или создайте новый.');}
  }else if(keys.has('photo_draft'))profile(()=>location.reload());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&revision)fetchInbox();});
  window.addEventListener('beforeunload', event=>{
    if (!allowSave || phoneKey || !auth?.authorized || (!revision&&!ui.rows().length)) return;
    if (JSON.stringify(ui.snapshot())!==last) {
      event.preventDefault();event.returnValue='';
    }
  });
  window.addEventListener('pagehide',()=>{sessionEnding=true;clearTimeout(pollTimer);});
  window.addEventListener('pageshow',()=>{sessionEnding=false;if(revision)startPolling();});
  return { gate,changed,save,capture:photos=>gate(()=>saveSelection(photos)),get draftId(){return draftId;},get jobId(){return editJob;} };
}
