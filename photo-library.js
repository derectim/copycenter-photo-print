import {readPrintAsset} from './photo-input.js';

function element(tag,text='',className='') {
  const e=document.createElement(tag); e.textContent=text; e.className=className; return e;
}
function button(label,work,cls='button secondary'){
  const e=element('button',label,cls); e.type='button'; e.addEventListener('click',work);return e;
}
function field(label,input){
  const wrap=element('label','','lib-field');wrap.append(element('span',label),input);return wrap;
}
function select(options,label){
  const e=element('select');e.setAttribute('aria-label',label);
  for(const [value,title] of options)e.add(new Option(title,value));return e;
}
export async function openLibrary({showDialog,api,addPhotos,notify}) {
  const dialog=showDialog('Моя библиотека');
  dialog.dialog.classList.add('library-dialog');
  const toolbar=element('div','','library-toolbar');
  const query=element('input');query.type='search';query.placeholder='Имя фотографии';
  const scope=select([['all','Все фотографии'],['new','Новые за неделю'],['today','Загруженные сегодня'],['unfiled','Без альбома']],'Раздел библиотеки');
  const sort=select([['recent','Сначала новые'],['name','По имени'],['size','По размеру'],['album','По альбомам']],'Сортировка фотографий');
  toolbar.append(field('Поиск',query),field('Раздел',scope),field('Сортировка',sort));
  const manager=element('div','','lib-albums');
  const albumName=element('input');albumName.maxLength=100;albumName.placeholder='Название альбома';
  const fileInput=element('input');fileInput.type='file';fileInput.multiple=true;fileInput.hidden=true;
  fileInput.accept='image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';
  const info=element('p','Фотографии хранятся один месяц с момента сохранения в библиотеку.','review-note');
  const status=element('p','','lib-status');status.setAttribute('role','status');
  const grid=element('div','','library-grid');
  const nav=element('div','','lib-actions');
  const selection=element('div','','lib-actions');
  const targetAlbum=select([['','Без альбома']],'Альбом для выбранных фото');
  const chosen=new Set();
  let photos=[], albums=[],page=0,sequence=0,working=false;
  const urls=new Set();
  const upload=button('Загрузить в библиотеку',()=>fileInput.click());
  const create=button('Создать альбом',()=>run(async()=>{
    const name=albumName.value.trim();
    if(!name)throw Error('Введите название альбома.');
    const result=await api.call('albumSave',{name});albumName.value='';await reload();
    if(result.album?.id)scope.value='album:'+result.album.id;render();
  }));
  const selectedAlbum=()=>scope.value.startsWith('album:')?scope.value.slice(6):null;
  const rename=button('Переименовать',()=>run(async()=>{
    if(!albumName.value.trim())throw Error('Введите новое название альбома.');
    await api.call('albumSave',{id:selectedAlbum(),name:albumName.value.trim()});albumName.value='';await reload();
  }));
  const removeAlbum=button('Удалить альбом',()=>run(async()=>{
    if(!window.confirm('Удалить альбом? Фотографии останутся в библиотеке.'))return;
    await api.call('albumDelete',{id:selectedAlbum()});scope.value='all';await reload();
  }));
  manager.append(field('Альбомы',albumName),create,rename,removeAlbum,upload,fileInput);
  const add=button('Добавить в заказ',()=>run(async()=>{
    const items=photos.filter(p=>chosen.has(p.id));
    await addPhotos(items);
    dialog.close();
  }),'button primary');
  const move=button('Переместить',()=>run(async()=>{
    await api.call('libraryMove',{ids:[...chosen],albumId:targetAlbum.value||null});await reload();
  }));
  const del=button('Удалить фото',()=>run(async()=>{
    if(!window.confirm('Удалить выбранные фотографии из библиотеки?'))return;
    await api.call('libraryDelete',{ids:[...chosen]});chosen.clear();await reload();
  }));
  const selectAll=button('Выбрать все',()=>{const set=filtered();const all=set.length&&set.every(p=>chosen.has(p.id));set.forEach(p=>all?chosen.delete(p.id):chosen.add(p.id));render();});
  const count=element('span');
  selection.append(selectAll,count,targetAlbum,move,del);
  dialog.content.append(info,toolbar,manager,selection,grid,nav,status);
  dialog.actions.append(button('Закрыть',dialog.close),add);
  function actionState(){
    add.disabled=move.disabled=del.disabled=working||!chosen.size;
    count.textContent='Выбрано: '+chosen.size;
    rename.hidden=removeAlbum.hidden=!selectedAlbum();
  }
  async function run(work){
    if(working)return;
    working=true;dialog.content.inert=true;actionState();
    try {await work();}
    catch(e){status.textContent=e.message;notify(e.message,'error');}
    finally {working=false;dialog.content.inert=false;actionState();}
  }
  function filtered(){
    const today=new Date().setHours(0,0,0,0);
    const albumNames=new Map(albums.map(album=>[album.id,album.name]));
    return photos.filter(p=>{
      const date=timestamp(p.createdAt);
      if(scope.value==='today'&&date<today || scope.value==='new'&&date<Date.now()-7*86400000)return false;
      if(scope.value==='unfiled'&&p.albumId || selectedAlbum() && p.albumId!==selectedAlbum())return false;
      return p.name.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase());
    }).sort((a,b)=>sort.value==='size'?b.bytes-a.bytes:sort.value==='name'?a.name.localeCompare(b.name,'ru'):
      sort.value==='album'?(albumNames.get(a.albumId)||'Без альбома').localeCompare(albumNames.get(b.albumId)||'Без альбома','ru')||a.name.localeCompare(b.name,'ru'):timestamp(b.createdAt)-timestamp(a.createdAt));
  }
  function timestamp(value){return typeof value==='number' ? value*(value<1e12?1000:1) : Date.parse(value);}
  function clearURLs(){for(const url of urls)URL.revokeObjectURL(url);urls.clear();}
  function render(){
    const gen=++sequence;clearURLs();grid.replaceChildren();nav.replaceChildren();
    const rows=filtered(),last=Math.max(0,Math.ceil(rows.length/18)-1);
    page=Math.min(page,last);
    if(!rows.length)grid.append(element('p','В этом разделе пока нет фотографий.'));
    let previousAlbum;
    const thumbs=[];
    for(const photo of rows.slice(page*18,page*18+18)){
      if(sort.value==='album'&&photo.albumId!==previousAlbum){
        previousAlbum=photo.albumId;grid.append(element('h3',albums.find(a=>a.id===photo.albumId)?.name||'Без альбома','lib-group'));
      }
      const label=element('label','','lib-photo'),img=element('img'),cb=element('input');
      img.alt=photo.name;cb.type='checkbox';cb.checked=chosen.has(photo.id);
      cb.setAttribute('aria-label','Выбрать '+photo.name);
      cb.addEventListener('change',()=>{cb.checked?chosen.add(photo.id):chosen.delete(photo.id);actionState();});
      label.append(img,cb,element('span',photo.name),element('small',photo.width+' × '+photo.height+' px'));
      grid.append(label); thumbs.push({img,photo});
    }
    (async()=>{
      for(const {img,photo} of thumbs){
        if(gen!==sequence||!dialog.dialog.open)return;
        try{
          const asset=await readPrintAsset(await api.file(photo));
          if(gen!==sequence||!dialog.dialog.open){URL.revokeObjectURL(asset.url);return;}
          urls.add(asset.url);img.src=asset.url;
        }catch{img.alt=photo.name+' — превью недоступно';}
      }
    })();
    if(last>0){
      const prev=button('Назад',()=>{--page;render();}),next=button('Вперёд',()=>{++page;render();});
      prev.disabled=page===0;next.disabled=page===last;nav.append(prev,element('span',(page+1)+' / '+(last+1)),next);
    }
    actionState();
  }
  async function reload(){
    const data=await api.call('libraryList');photos=data.photos;albums=data.albums;
    const activeScope=scope.value, dest=targetAlbum.value;
    while(scope.options.length>4)scope.remove(4);
    targetAlbum.replaceChildren(new Option('Без альбома',''));
    for(const album of albums){scope.add(new Option(album.name,'album:'+album.id));targetAlbum.add(new Option(album.name,album.id));}
    scope.value=[...scope.options].some(o=>o.value===activeScope)?activeScope:'all';
    if(albums.some(a=>a.id===dest))targetAlbum.value=dest;
    for(const id of chosen)if(!photos.some(p=>p.id===id))chosen.delete(id);
    status.textContent=''; render();
  }
  fileInput.addEventListener('change',()=>run(async()=>{
    const files=[...fileInput.files]; fileInput.value='';
    const failures=[];
    for(let i=0;i<files.length;i++){
      status.textContent='Сохраняем '+(i+1)+' / '+files.length;
      try{await api.call('libraryUpload',{file:files[i],albumId:selectedAlbum()});}
      catch(e){failures.push(files[i].name+': '+e.message);}
    }
    await reload();status.textContent=failures.slice(0,3).join(' ');
  }));
  for(const [node,type] of [[query,'input'],[sort,'change'],[scope,'change']])node.addEventListener(type,()=>{page=0;render();});
  dialog.dialog.addEventListener('close',()=>{sequence++;clearURLs();},{once:true});
  status.textContent='Загружаем библиотеку…';
  await run(reload);
}
