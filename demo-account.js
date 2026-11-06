import {readPrintAsset} from './photo-input.js';
import {allowBytes, DEMO_CAPACITY, monthAfter, removeMedia, sweep, usage, vault} from './demo-vault.js';

const signKey = 'photoprint-demo-profile';
export function demoAuth() {
  return {authorized: localStorage.getItem(signKey) === 'signed-in', userId: 'local-demo'};
}
export function demoSignIn() { localStorage.setItem(signKey,'signed-in'); }
export function demoSignOut() { localStorage.removeItem(signKey); }
const newId = () => crypto.randomUUID();
function descriptor(row) {
  return {...row, assetId: row.id, url: 'local-photo:' + row.id};
}
function requireUser() {
  if (!demoAuth().authorized) throw Error('Войдите в демопрофиль, чтобы работать со своими фотографиями.');
}
export async function demoFile(info) {
  requireUser();
  return vault('readwrite', async api => {
    await sweep(api);
    const file = await api.get('blobs', info.assetId || info.id);
    if (!(file instanceof Blob)) throw Error('Фотография удалена или истёк срок хранения.');
    return new File([file], info.name, {type:file.type});
  });
}
export async function demoUsage() {
  return vault('readwrite', async api => { await sweep(api); return {used:await usage(api),limit:DEMO_CAPACITY}; });
}
async function storePhoto(api, file, dimensions, draftId, albumId) {
  if (albumId && !await api.get('albums',albumId)) throw Error('Альбом больше не существует.');
  await allowBytes(api,file.size);
  const now = Date.now();
  const photo = {id:newId(), name:file.name, bytes:file.size, createdAt:now, expiresAt:monthAfter(now),
    width:dimensions.width, height:dimensions.height, ext:dimensions.extension || dimensions.ext, albumId:albumId || null, draftId:draftId || null};
  await api.put('media',photo);
  await api.put('blobs',file,photo.id);
  return descriptor(photo);
}
async function draftFor(api,id,create=false) {
  let draft = await api.get('drafts',id);
  if (!draft && create) {
    draft = {draftId:id, revision:0, updatedAt:Date.now(),state:null};
    await api.put('drafts',draft);
  }
  if (!draft) throw Error('Черновик удалён или срок хранения истёк.');
  return draft;
}

// Uses the same response shapes as the CMS. The demo profile and its media are
// local to one browser. Production requests always use the same-site PHP endpoint.
export async function demoCall(action, args = {}) {
  requireUser();
  let dimensions;
  if (args.file) {
    dimensions = await readPrintAsset(args.file);
    URL.revokeObjectURL(dimensions.url);
  }
  return vault('readwrite', async api => {
    await sweep(api);
    if (action === 'libraryList') {
      return {photos:(await api.all('media')).filter(p=>!p.draftId).map(descriptor), albums:await api.all('albums')};
    }
    if (action === 'libraryUpload') return {photo:await storePhoto(api,args.file,dimensions,null,args.albumId)};
    if (action === 'upload' || action === 'phoneUpload') {
      let draftId=args.draftId, pair;
      if (action === 'phoneUpload') {
        pair=await api.get('pairs',args.token);
        if (!pair) throw Error('QR-код истёк или создан в другом браузере. Для демо откройте ссылку во второй вкладке.');
        draftId=pair.draftId;
      }
      const draft=await draftFor(api,draftId,action === 'upload');
      const photo=await storePhoto(api,args.file,dimensions,draftId,null);
      if (pair) {
        const stored=await api.get('media',photo.id);
        Object.assign(stored,{pending:true,formatId:pair.formatId});
        await api.put('media',stored);
      }
      draft.updatedAt=Date.now();
      await api.put('drafts',draft);
      return action==='upload' ? photo : {photo};
    }
    if (action === 'albumSave') {
      const name=String(args.name||'').trim();
      if (!name || name.length>100) throw Error('Введите название альбома длиной до 100 символов.');
      const album={id:args.id||newId(),name};
      await api.put('albums',album);
      return {album};
    }
    if (action === 'albumDelete' || action === 'libraryMove' || action === 'libraryDelete') {
      if (action==='libraryMove' && args.albumId && !await api.get('albums',args.albumId)) throw Error('Альбом удалён.');
      const ids = new Set(args.ids || []);
      for (const photo of await api.all('media')) {
        if (photo.draftId) continue;
        if (action==='albumDelete' ? photo.albumId!==args.id : !ids.has(photo.id)) continue;
        if (action==='libraryDelete') await removeMedia(api,photo.id);
        else { photo.albumId=action==='albumDelete'?null:args.albumId||null; await api.put('media',photo); }
      }
      if (action==='albumDelete') await api.del('albums',args.id);
      return {ok:true};
    }
    if (action === 'libraryCapture') {
      const old=await api.get('media',args.assetId);
      if (!old || old.draftId!==args.draftId) throw Error('Исходник не найден в черновике.');
      const file=await api.get('blobs',old.id);
      return {photo:await storePhoto(api,new File([file],old.name,{type:file.type}),old,null,args.albumId)};
    }
    if (action === 'draftList') return {drafts:(await api.all('drafts')).filter(d=>d.state).sort((a,b)=>b.updatedAt-a.updatedAt)
      .map(({draftId,updatedAt,revision})=>({draftId,updatedAt,revision,expiresAt:updatedAt+3*86400000}))};
    if (action === 'draftLoad') {
      const draft=await draftFor(api,args.draftId);
      return {...draft,assets:(await api.all('media')).filter(row=>row.draftId===args.draftId).map(descriptor)};
    }
    if (action === 'draftSave') {
      const draft=await draftFor(api,args.draftId,true);
      if (draft.revision !== args.revision) {
        const error=Error('Этот черновик изменился в другой вкладке. Откройте его заново.');
        error.code='DRAFT_CONFLICT'; throw error;
      }
      const wanted=new Set(args.state.groups.flatMap(group=>group.photos.map(p=>p.assetId)));
      const owned=(await api.all('media')).filter(p=>p.draftId===args.draftId);
      const ids=new Set(owned.map(p=>p.id));
      if ([...wanted].some(id=>!ids.has(id))) throw Error('В черновике отсутствует исходная фотография.');
      for (const row of owned) if (!wanted.has(row.id) && !row.pending) await removeMedia(api,row.id);
      Object.assign(draft,{revision:draft.revision+1, updatedAt:Date.now(), state:args.state});
      await api.put('drafts',draft);
      return {revision:draft.revision, updatedAt:draft.updatedAt};
    }
    if (action === 'draftDelete') {
      const draft=await draftFor(api,args.draftId);
      if(args.revision!==undefined&&args.revision!==draft.revision)throw Error('Черновик изменился. Откройте список повторно.');
      await api.del('drafts',args.draftId);
      await sweep(api);
      return {ok:true};
    }
    if (action==='pairCreate' || action==='pairRevoke') {
      await draftFor(api,args.draftId);
      for(const pair of await api.all('pairs')) if(pair.draftId===args.draftId) await api.del('pairs',pair.token);
      if(action==='pairRevoke') return {ok:true};
      const pair={draftId:args.draftId,formatId:args.formatId,token:newId()+newId(),expiresAt:Date.now()+900000};
      await api.put('pairs',pair); return pair;
    }
    if(action==='pairInfo'){
      const pair=await api.get('pairs',args.token);
      if (!pair) throw Error('Ссылка истекла или принадлежит другому браузеру. Откройте новую ссылку из конструктора.');
      return pair;
    }
    if(action==='phoneInbox') return {photos:(await api.all('media')).filter(p=>p.draftId===args.draftId&&p.pending).map(descriptor)};
    if(action==='phoneAck') {
      for(const id of args.assetIds) {
        const row=await api.get('media',id);
        if(row?.draftId===args.draftId){ delete row.pending; await api.put('media',row); }
      }
      return {ok:true};
    }
    if(action==='basketProjects') return {projects:[]};
    throw Error('Неизвестное действие демопрофиля.');
  });
}
