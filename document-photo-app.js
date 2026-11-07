import {createAccountAPI} from './account-api.js?v=2.3.5';
import {readPrintAsset} from './photo-input.js';
import {cropPose,setCropPose} from './photo-editor.js?v=2.1';
import {layoutPrint} from './print-render.js';
import {documentCropFormat,documentCropPhoto,documentRenderCatalog,documentSheetLayout,normalizeDocumentGuides,
  defaultDocumentGuides,paintDocumentCrop,paintDocumentSheet,renderDocumentSheet} from './document-photo-layout.js?v=2.4.0';

const root = document.getElementById('document-photo-app');
const $ = id => root.querySelector('#dp-'+id);
const endpoint = window.COPYCENTER_DOCUMENTS?.endpoint || null;
const account = createAccountAPI(endpoint);
const api = {
  call(action,args = {}) {
    if (args instanceof FormData) { args.set('service','documents'); return account.call(action,args); }
    return account.call(action,{...args,service:'documents'});
  },
  file(info) {
    const url = new URL(info.url,location.href); url.searchParams.set('service','documents');
    return account.file({...info,url:url.href});
  }
};
const money = value => new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:2}).format(value);
const keys = new URL(location.href).searchParams;
let config, catalogVersion, auth, preset, photo, sets = 1, busy = false, ready = false;
let guides = {...defaultDocumentGuides}, paintVersion = 0, paintFrame, drag;
let draftId = keys.get('photo_draft') || crypto.randomUUID(), jobId = keys.get('photo_job');
let revision = 0, savedSignature = '', saveQueue = Promise.resolve(), saveTimer, conflict = false;
let sheetCache, printCache, checkoutKey = '', checkoutRequest;

function notice(text,kind = 'info') { $('feedback').textContent=text; $('feedback').dataset.kind=kind; }
function progress(text) { $('progress-text').textContent=text; }
function selectedPreset() { return config.formats.find(item => item.id === $('format').value); }
function presetGuides(value = preset) {
  const saved=value?.guides;
  return saved?normalizeDocumentGuides({crown:saved.top/100,eyes:saved.eyes/100,chin:saved.chin/100,headWidth:saved.width/100}):{...defaultDocumentGuides};
}
function printable() { return ready && config.enabled && preset?.available && Number.isFinite(preset.price) && preset.price >= 0; }
function controls() {
  for (const control of root.querySelectorAll('button,input,select')) control.disabled=busy || !ready;
  $('cart').disabled=busy || !photo || !printable() || !auth?.authorized || conflict;
  $('download').disabled=busy || !photo;
  $('minus').disabled=busy || !ready || sets<=1; $('plus').disabled=busy || !ready || sets>=99;
  $('drafts').disabled=busy || !ready || !auth?.authorized;
  $('upload').disabled=busy || !ready || Boolean(endpoint && !auth?.authorized);
  $('file').disabled=$('upload').disabled; $('replace').disabled=$('upload').disabled;
  if (!photo) for (const control of $('edit').querySelectorAll('button,input,select')) control.disabled=true;
}
function setBusy(value,text) {
  busy=value; root.setAttribute('aria-busy',String(value)); $('progress').hidden=!value;
  if (text) progress(text);
  controls();
}
function settings() { return {paperId:'mt',fitId:'cover',frameId:'none',extraIds:[],copies:sets}; }
function snapshot() {
  return {activeFormatId:preset.id,documentGuides:{...guides},groups:[{formatId:preset.id,defaults:settings(),
    photos:photo ? [{...settings(),assetId:photo.asset.assetId,crop:photo.crop||null,edits:photo.edits}] : []}]};
}
function writeAddress() {
  const url=new URL(location.href);url.searchParams.set('photo_draft',draftId);
  if(jobId)url.searchParams.set('photo_job',jobId);else url.searchParams.delete('photo_job');
  history.replaceState(history.state,'',url);
}
function authPanel(error) {
  const panel=$('auth');panel.hidden=false;panel.replaceChildren();
  const note=document.createElement('p');note.textContent=error?.message || 'Для загрузки фотографий войдите в аккаунт магазина.';
  const link=document.createElement('a');link.className='dp-button dp-primary';link.textContent='Войти на сайт';
  const login=new URL(auth?.loginUrl || '/bitrix/tools/copycenter.photoprint/signin.php',location.origin);
  if(login.origin !== location.origin)throw Error('Проверьте адрес входа в магазин.');
  login.searchParams.set('backurl',location.pathname+location.search);link.href=login.href;
  panel.append(note,link);
  if(photo && auth?.authorized) {
    link.target='_blank';link.rel='noopener noreferrer';
    const resume=document.createElement('button');resume.type='button';resume.className='dp-button dp-secondary';resume.textContent='Я вошёл, продолжить';
    resume.onclick=async()=>{try{await account.refresh();panel.hidden=true;await saveDraft();notice('Вход подтверждён. Можно продолжать.');controls();}catch(error){notice(error.message,'error');}};
    panel.append(resume);
  }
}
account.onAuthRequired=authPanel;

function saveDraft(onProgress) {
  clearTimeout(saveTimer);
  if(!endpoint || !auth?.authorized || !photo)return Promise.resolve();
  const run=saveQueue.catch(()=>{}).then(async()=>{
    if(conflict)throw Error('Этот черновик изменён в другой вкладке. Откройте его заново через «Мои черновики».');
    const current=photo;
    if(!current.asset.assetId) {
      const text='Сохраняем оригинал фотографии…';$('draft-status').textContent=text;onProgress?.(text);
      const result=await api.call('upload',{draftId,file:current.asset.file});
      if(!result.assetId)throw Error('Магазин не подтвердил сохранение оригинала.');
      current.asset.assetId=result.assetId;
    }
    if(photo!==current)return;
    const state=snapshot(),signature=JSON.stringify(state);
    if(revision && signature===savedSignature)return;
    const text='Сохраняем кадрирование…';$('draft-status').textContent=text;onProgress?.(text);
    const result=await api.call('draftSave',{draftId,revision,state});
    revision=result.revision;savedSignature=signature;writeAddress();$('draft-status').textContent='Черновик сохранён · хранится 3 дня';
  });
  saveQueue=run.catch(error=>{if(error.code==='DRAFT_CONFLICT')conflict=true;$('draft-status').textContent='Не удалось сохранить черновик';controls();throw error;});
  saveQueue.catch(()=>{});return saveQueue;
}
function changed() {
  sheetCache=null;printCache=null;checkoutKey='';
  if(endpoint && auth?.authorized && photo && !conflict){clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveDraft().catch(error=>notice(error.message,'error')),700);}
  draw();
}
function priceView() {
  $('size-label').textContent=preset.label;
  $('format-note').textContent=preset.count+' фото '+preset.label+' в одном комплекте · матовая бумага';
  $('sheet-size').textContent=preset.sheetWidthMm/10+' × '+preset.sheetHeightMm/10+' см';
  $('sets').value=sets;
  const known=Number.isFinite(preset.price) && preset.price>=0;
  $('base-price').hidden=!known || !Number.isFinite(preset.basePrice) || preset.basePrice<=preset.price;
  $('base-price').textContent=Number.isFinite(preset.basePrice)?money(preset.basePrice):'';
  $('price').textContent=known?money(preset.price):'Уточняется';$('total').textContent=known?money(preset.price*sets):'—';
  $('price-note').textContent=!known?'Стоимость этого формата пока не указана. Можно подготовить и скачать лист.':
    !preset.available || !config.enabled?'Приём заказов на этот формат пока недоступен.':sets+' компл. · '+(preset.count*sets)+' фотографий';
  $('cart').hidden=!endpoint;
  controls();
}
function guideView() {
  guides=normalizeDocumentGuides(guides);
  const oval=$('guide-oval');oval.setAttribute('cx',50);oval.setAttribute('cy',(guides.crown+guides.chin)*50);
  oval.setAttribute('rx',guides.headWidth*50);oval.setAttribute('ry',(guides.chin-guides.crown)*50);
  for(const key of ['crown','eyes','chin']) {const line=$('guide-'+key);line.setAttribute('y1',guides[key]*100);line.setAttribute('y2',guides[key]*100);$(key).value=Math.round(guides[key]*100);}
  $('head-width').value=Math.round(guides.headWidth*100);$('guides').hidden=!$('guides-visible').checked;
}
function sizeStage() {
  if(!preset)return;
  const stage=$('crop-stage'),parent=stage.parentElement;
  const spaceWidth=Math.max(1,parent.clientWidth-24),spaceHeight=Math.max(1,parent.clientHeight-24),aspect=preset.widthMm/preset.heightMm;
  const width=Math.min(spaceWidth,spaceHeight*aspect);stage.style.width=width+'px';stage.style.height=width/aspect+'px';
}
function pose() { return cropPose(documentCropPhoto(photo,preset),documentCropFormat(preset),documentRenderCatalog); }
function applyPose(value) {
  const working=documentCropPhoto(photo,preset);setCropPose(working,documentCropFormat(preset),documentRenderCatalog,value);photo.crop=working.crop;
}
function setPose(value) {applyPose(value);changed();}
function draw() {
  $('drop').hidden=Boolean(photo);$('edit').hidden=!photo;$('sheet-empty').hidden=Boolean(photo);
  $('sheet').hidden=!photo;guideView();priceView();
  if(!photo)return;
  const currentPose=pose();$('zoom').value=Math.round(currentPose.zoom*100);$('zoom-value').textContent=Math.round(currentPose.zoom*100)+'%';
  $('angle').value=photo.edits.angle;$('angle-value').textContent=photo.edits.angle+'°';sizeStage();
  const token=++paintVersion;cancelAnimationFrame(paintFrame);
  paintFrame=requestAnimationFrame(async()=>{
    const valid=()=>token===paintVersion && Boolean(photo);
    try {
      await paintDocumentCrop($('crop-canvas'),photo,preset,{maxSide:700,valid});if(!valid())return;
      const proof=$('proof'),source=$('crop-canvas');proof.width=source.width;proof.height=source.height;proof.getContext('2d').drawImage(source,0,0);
      await paintDocumentSheet($('sheet'),photo,preset,{maxSide:560,valid});
    }catch(error){if(valid())notice(error.message,'error');}
  });
}
async function loadFile(file) {
  if(!file || busy)return;
  setBusy(true,'Читаем фотографию…');notice('');
  try {
    const asset=await readPrintAsset(file),previous=photo;
    photo={asset,crop:null,edits:{angle:0,orientation:'portrait'},fitId:'cover',frameId:'none'};
    if(previous)URL.revokeObjectURL(previous.asset.url);
    guides=presetGuides();changed();
    notice('Фотография добавлена. Совместите лицо с направляющими.');
  }catch(error){notice(error.message,'error');}
  finally{setBusy(false);$('file').value='';}
  if(photo)saveDraft().catch(error=>notice(error.message,'error'));
}
function rotate(value) {
  if(!photo||busy)return;
  const current=pose();photo.edits.angle=Math.round((((value+180)%360+360)%360-180)*2)/2;
  applyPose(current);changed();
}
function move(dx,dy) {
  if(!photo||busy)return;
  const current=pose(),rect=layoutPrint(documentCropPhoto(photo,preset),documentCropFormat(preset),documentRenderCatalog).source;
  setPose({...current,x:rect.width>=.999999?.5:current.x-dx*rect.width/(1-rect.width),
    y:rect.height>=.999999?.5:current.y-dy*rect.height/(1-rect.height)});
}
function renderKey() {return JSON.stringify([photo.asset.url,preset,photo.crop,photo.edits,catalogVersion]);}
async function sheet() {
  const key=renderKey();
  if(sheetCache?.key===key)return sheetCache.blob;
  const blob=await renderDocumentSheet(photo,preset);sheetCache={key,blob};return blob;
}
async function download() {
  if(!photo||busy)return;setBusy(true,'Готовим печатный лист…');
  try {
    await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
    const blob=await sheet(),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='document-'+preset.widthMm+'x'+preset.heightMm+'-'+preset.count+'pcs.jpg';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),60000);notice('JPG подготовлен: лист '+preset.sheetWidthMm+' × '+preset.sheetHeightMm+' мм, 300 dpi, без направляющих.');
  }catch(error){notice(error.message,'error');}finally{setBusy(false);}
}
async function checkout() {
  if(busy || !photo || !printable() || !auth?.authorized || conflict)return;
  setBusy(true,'Сохраняем фотографию…');notice('');
  try {
    await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
    await saveDraft(progress);
    const key=renderKey();
    progress('Проверяем состав заказа…');
    await api.call('prepare',{draftId,assetIds:[photo.asset.assetId],printIds:printCache?.key===key?[printCache.id]:[]});
    if(printCache?.key!==key) {
      progress('Готовим печатный лист…');const jpeg=await sheet();
      progress('Передаём готовый лист…');
      const result=await api.call('rendition',{draftId,file:new File([jpeg],'document-sheet.jpg',{type:'image/jpeg'}),assetId:photo.asset.assetId,
        formatId:preset.id,fitId:'cover',frameId:'none',crop:JSON.stringify(photo.crop||null),edits:JSON.stringify(photo.edits),catalogVersion});
      if(!result.printId)throw Error('Магазин не подтвердил сохранение печатного листа.');
      printCache={key,id:result.printId};
    }
    const item={...settings(),assetId:photo.asset.assetId,formatId:preset.id,crop:photo.crop||null,edits:photo.edits,printId:printCache.id};
    const requestKey=JSON.stringify(item);if(checkoutKey!==requestKey){checkoutKey=requestKey;checkoutRequest=crypto.randomUUID();}
    progress('Добавляем комплект в корзину…');
    const result=await api.call('basket',{draftId,replaceJobId:jobId,editorPath:location.pathname,requestId:checkoutRequest,catalogVersion,
      renderVersion:1,items:[item],expectedTotal:preset.price*sets});
    if(!result.basketUrl)throw Error('Магазин не передал ссылку на корзину.');
    const url=new URL(result.basketUrl,location.href);if(url.origin!==location.origin || !['https:','http:'].includes(url.protocol))throw Error('Некорректный адрес корзины.');
    location.assign(url.href);
  }catch(error){
    notice(error.message,'error');
    if(['PRICE_CHANGED','CATALOG_CHANGED'].includes(error.code)) {
      try{await configure();changed();notice('Условия печати обновились. Проверьте комплект и сумму, затем повторите добавление.');}catch(refreshError){notice(refreshError.message,'error');}
    }
  }finally{setBusy(false);}
}
async function restore(id) {
  const result=await api.call('draftLoad',{draftId:id}),group=result.state?.groups?.[0],row=group?.photos?.[0];
  if(!row || result.state.groups.length!==1 || group.photos.length!==1)throw Error('Этот черновик не подходит для редактора документов.');
  const nextPreset=config.formats.find(item=>item.id===group.formatId);if(!nextPreset)throw Error('Формат этого черновика больше недоступен.');
  const info=result.assets.find(item=>item.assetId===row.assetId);if(!info)throw Error('Оригинал этого черновика недоступен.');
  progress('Восстанавливаем фотографию…');const asset=await readPrintAsset(await api.file(info));asset.assetId=info.assetId;
  if(photo)URL.revokeObjectURL(photo.asset.url);
  photo={asset,crop:row.crop||null,edits:{angle:row.edits?.angle||0,orientation:'portrait'},fitId:'cover',frameId:'none'};
  preset=nextPreset;$('format').value=preset.id;sets=Math.max(1,Math.min(99,Number(row.copies)||1));guides=result.state.documentGuides?normalizeDocumentGuides(result.state.documentGuides):presetGuides();
  draftId=id;revision=result.revision;conflict=false;savedSignature=JSON.stringify(snapshot());sheetCache=null;printCache=null;checkoutKey='';writeAddress();draw();
  $('draft-status').textContent='Черновик открыт · хранится 3 дня';
}
async function drafts() {
  if(busy||!auth?.authorized)return;setBusy(true,'Открываем черновики…');
  try {
    if(!conflict)await saveDraft();const {drafts}=await api.call('draftList');const list=$('drafts-list');list.replaceChildren();
    for(const draft of drafts) {
      const row=document.createElement('div');row.className='dp-draft-row';const label=document.createElement('span');
      label.textContent='Черновик от '+new Date(draft.updatedAt).toLocaleString('ru-RU');const open=document.createElement('button');
      open.type='button';open.className='dp-button dp-secondary';open.textContent='Открыть';
      open.onclick=async()=>{if(busy)return;setBusy(true,'Открываем черновик…');try{if(!conflict)await saveDraft();const prior=draftId;await restore(draft.draftId);if(prior!==draftId){jobId=null;writeAddress();}$('drafts-panel').hidden=true;}catch(error){notice(error.message,'error');}finally{setBusy(false);}};
      row.append(label,open);list.append(row);
    }
    if(!drafts.length)list.textContent='Черновиков пока нет.';$('drafts-panel').hidden=false;
  }catch(error){notice(error.message,'error');}finally{setBusy(false);}
}
async function configure() {
  const current=preset?.id;let next;
  if(endpoint) {const data=await api.call('config');next=data.documentPhoto;catalogVersion=data.catalogVersion;auth=data.auth;}
  else {const {readDocumentDemoConfig}=await import('./document-photo-demo-config.js?v=2.4.0');next=readDocumentDemoConfig();catalogVersion=JSON.stringify(next);}
  if(!next || !Array.isArray(next.formats) || !next.formats.length)throw Error('Редактор фотографий на документы пока не настроен.');
  for(const item of next.formats){documentSheetLayout(item);documentCropFormat(item);}
  config=next;preset=config.formats.find(item=>item.id===current) || config.formats.find(item=>item.widthMm===35 && item.heightMm===45) || config.formats[0];
  $('title').textContent='Заказать готовые фотографии на документы со скидкой 50%';$('help').replaceChildren(...(config.helpItems||[]).slice(0,3).map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
  $('format').replaceChildren(...config.formats.map(item=>new Option(item.label+' · '+item.count+' шт.',item.id)));$('format').value=preset.id;
  $('demo-note').hidden=Boolean(endpoint);$('drafts').hidden=!endpoint;$('auth').hidden=!endpoint || auth?.authorized;
  if(endpoint && !auth?.authorized)authPanel();
}
function bind() {
  for(const id of ['upload','replace'])$(id).onclick=()=>$('file').click();
  $('file').onchange=()=>loadFile($('file').files[0]);
  $('drop').ondragover=event=>{event.preventDefault();if(!busy)$('drop').classList.add('is-dragging');};
  $('drop').ondragleave=()=>$('drop').classList.remove('is-dragging');
  $('drop').ondrop=event=>{event.preventDefault();$('drop').classList.remove('is-dragging');if(!busy && (!endpoint||auth?.authorized))loadFile(event.dataTransfer.files[0]);};
  $('format').onchange=()=>{const current=photo?pose():null;preset=selectedPreset();guides=presetGuides();if(current)applyPose(current);changed();};
  $('zoom').oninput=()=>{if(photo)setPose({...pose(),zoom:Number($('zoom').value)/100});};
  $('angle').oninput=()=>rotate(Number($('angle').value));
  $('turn-left').onclick=()=>rotate(photo.edits.angle-90);$('turn-right').onclick=()=>rotate(photo.edits.angle+90);
  $('reset').onclick=()=>{if(photo){photo.crop=null;photo.edits={angle:0,orientation:'portrait'};changed();}};
  const setCopies=value=>{if(!Number.isInteger(value)||value<1||value>99){$('sets').value=sets;notice('Количество комплектов — целое число от 1 до 99.','error');return;}sets=value;priceView();if(endpoint){clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveDraft().catch(error=>notice(error.message,'error')),700);}};
  $('sets').onchange=()=>setCopies(Number($('sets').value));$('minus').onclick=()=>setCopies(sets-1);$('plus').onclick=()=>setCopies(sets+1);
  for(const [id,key] of [['crown','crown'],['eyes','eyes'],['chin','chin'],['head-width','headWidth']])$(id).oninput=()=>{guides[key]=Number($(id).value)/100;guideView();if(endpoint){clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveDraft().catch(error=>notice(error.message,'error')),700);}};
  $('guides-visible').onchange=guideView;
  const stage=$('crop-stage');stage.addEventListener('pointerdown',event=>{if(!photo||busy||event.button!==0)return;drag={x:event.clientX,y:event.clientY,id:event.pointerId};stage.setPointerCapture(event.pointerId);stage.classList.add('is-dragging');});
  stage.addEventListener('pointermove',event=>{if(!drag||drag.id!==event.pointerId)return;const bounds=stage.getBoundingClientRect();move((event.clientX-drag.x)/bounds.width,(event.clientY-drag.y)/bounds.height);drag.x=event.clientX;drag.y=event.clientY;});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])stage.addEventListener(name,()=>{drag=null;stage.classList.remove('is-dragging');});
  stage.addEventListener('keydown',event=>{const direction={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];if(!direction)return;event.preventDefault();const step=event.shiftKey ? .04 : .008;move(direction[0]*step,direction[1]*step);});
  $('download').onclick=download;$('cart').onclick=checkout;$('drafts').onclick=drafts;$('drafts-close').onclick=()=>$('drafts-panel').hidden=true;
  $('new').onclick=async()=>{if(busy)return;setBusy(true,'Сохраняем текущий снимок…');try{if(!conflict)await saveDraft();if(photo)URL.revokeObjectURL(photo.asset.url);photo=null;draftId=crypto.randomUUID();jobId=null;revision=0;savedSignature='';conflict=false;sheetCache=null;printCache=null;checkoutKey='';guides={...defaultDocumentGuides};$('draft-status').textContent='';if(endpoint)writeAddress();draw();notice('Можно добавить новую фотографию.');}catch(error){notice(error.message,'error');}finally{setBusy(false);}};
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(sizeStage).observe(stage.parentElement);else window.addEventListener('resize',sizeStage);
  window.addEventListener('beforeunload',event=>{if(endpoint&&photo&&JSON.stringify(snapshot())!==savedSignature){event.preventDefault();event.returnValue='';}});
  if(!endpoint)window.addEventListener('storage',event=>{if(event.key==='copycenter-documents-config-v1'&&!busy)configure().then(()=>{sheetCache=null;draw();}).catch(error=>notice(error.message,'error'));});
}
async function initialize() {
  if(!root)return;
  try {
    await configure();ready=true;bind();setBusy(true,'Открываем редактор…');
    if(endpoint && auth?.authorized && keys.has('photo_draft'))await restore(draftId);
    draw();
  }catch(error){notice(error.message,'error');}finally{setBusy(false);}
}
initialize();
