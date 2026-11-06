import { constrainFrameEdits, effectiveDpi, frameMargins, layoutPrint, paintPrint, sheetMillimeters } from './print-render.js';
import { presetLabels, toneLabels } from './photo-color.js';

const clamp = (v, min = 0, max = 1) => Math.max(min, Math.min(max, v));
const rounded = value => Math.round(value * 1e6) / 1e6;
const neutral = {zoom:1, x:0.5, y:0.5};
const frameNames = {left:'Слева',right:'Справа',top:'Сверху',bottom:'Снизу'};
const clone = value => value ? structuredClone(value) : {};
const angle = value => rounded(((value + 180) % 360 + 360) % 360 - 180);

function coverWindow(photo, format, catalog) {
  const layout = layoutPrint({...photo, crop:null}, format, catalog);
  const target = layout.width * layout.aperture.width / (layout.height * layout.aperture.height);
  const ratio = layout.view.width / layout.view.height;
  const width = Math.min(1, target / ratio), height = Math.min(1, ratio / target);
  return {x:(1-width)/2, y:(1-height)/2, width, height};
}

export function cropPose(photo, format, catalog) {
  if (!photo.crop) return {...neutral};
  const base = coverWindow(photo, format, catalog);
  const rect = layoutPrint(photo, format, catalog).source;
  return {
    zoom:Math.max(1, Math.min(base.width / rect.width, base.height / rect.height)),
    x:rect.width >= .999999 ? .5 : clamp(rect.x / (1-rect.width)),
    y:rect.height >= .999999 ? .5 : clamp(rect.y / (1-rect.height))
  };
}

export function setCropPose(photo, format, catalog, pose) {
  const base = coverWindow(photo, format, catalog);
  const {view} = layoutPrint({...photo,crop:null},format,catalog);
  const maxZoom = Math.max(1, Math.min(base.width * view.width, base.height * view.height));
  const zoom = clamp(pose.zoom, 1, maxZoom);
  const width = Math.max(.000001, rounded(base.width / zoom));
  const height = Math.max(.000001, rounded(base.height / zoom));
  const x = rounded((1-width) * clamp(pose.x)), y = rounded((1-height) * clamp(pose.y));
  const auto = layoutPrint({...photo, crop:null}, format, catalog).source;
  const rect = {x, y, width, height};
  photo.crop = Object.keys(rect).every(k => Math.abs(rect[k] - auto[k]) < .000002) ? null : rect;
}

// Resize toward a pointer while keeping the opposite corner and the print aspect fixed.
export function resizeCrop(rect, base, corner, dx, dy, minWidth = base.width / 6) {
  const right = corner.endsWith('e'), down = corner.startsWith('s');
  const ax = right ? rect.x : rect.x + rect.width, ay = down ? rect.y : rect.y + rect.height;
  const ratio = base.width / base.height;
  const horizontal = (right ? 1 : -1) * dx;
  const vertical = (down ? 1 : -1) * dy * ratio;
  const maxWidth = Math.min(base.width, right ? 1 - ax : ax, (down ? 1 - ay : ay) * ratio);
  const width = clamp(rect.width + (Math.abs(horizontal) >= Math.abs(vertical) ? horizontal : vertical),
    Math.min(minWidth, maxWidth), maxWidth);
  const height = width / ratio;
  return {x:right ? ax : ax-width, y:down ? ay : ay-height, width, height};
}

function node(tag, css, text) {
  const out = document.createElement(tag);
  if (css) out.className = css;
  if (text != null) out.textContent = text;
  return out;
}
function command(title, callback) {
  const control = node('button', 'crop-command', title);
  control.type = 'button';
  control.addEventListener('click', callback);
  return control;
}
function selectField(label, choices, callback) {
  const field = node('label','editor-field',label);
  const select = node('select');
  select.append(...Object.entries(choices).map(([key, text]) => new Option(text, key)));
  select.addEventListener('change', () => callback(select.value));
  field.append(select);
  return {field, select};
}
function slider(label, min, max, step, act, unit = '') {
  const field = node('label','crop-control'), value = node('output','crop-value');
  const input = node('input');
  Object.assign(input,{type:'range',min,max,step});
  input.setAttribute('aria-label',label);
  input.addEventListener('input',() => act(Number(input.value)));
  field.append(node('span','',label),value,input);
  return {field,input,update(n) {input.value = n; value.textContent = new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(n) + unit;}};
}

const cardQueue = [];
let loadingCards = 0;
function drainCards() {
  while (loadingCards < 2 && cardQueue.length) {
    const job = cardQueue.shift();
    if (!job.canvas.isConnected) continue;
    loadingCards++;
    paintPrint(job.canvas, job.photo, job.format, job.catalog, {maxSide:320,valid:() => job.canvas.isConnected})
      .catch(() => {job.canvas.setAttribute('aria-label','Предпросмотр недоступен');})
      .finally(() => {loadingCards--; drainCards();});
  }
}
const cardJobs = new WeakMap();
const cards = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) {
    cards.unobserve(entry.target);
    cardQueue.push(cardJobs.get(entry.target));
  }
  drainCards();
},{rootMargin:'140px'}) : null;
export function photoPreview(photo, format, catalog, className) {
  const frame = node('div',className), canvas = node('canvas','print-sheet snapshot-proof');
  const layout = layoutPrint(photo,format,catalog);
  canvas.style.setProperty('--sheet-ratio', String(layout.width/layout.height));
  canvas.setAttribute('role','img');
  canvas.setAttribute('aria-label',photo.asset.file.name);
  frame.append(canvas);
  const job={canvas,photo,format,catalog};
  if (cards) {cardJobs.set(canvas,job); cards.observe(canvas);}
  else requestAnimationFrame(() => {cardQueue.push(job); drainCards();});
  return frame;
}
export function releasePreviews(gallery) {
  gallery.querySelectorAll('canvas.snapshot-proof').forEach(canvas => cards?.unobserve(canvas));
}

function writeValue(edits, path, value) {
  const [section, name] = path.split('.');
  if (name) {
    edits[section] = {...edits[section]};
    if (value == null) delete edits[section][name];
    else edits[section][name] = value;
    if (!Object.keys(edits[section]).length) delete edits[section];
  } else if (value == null) delete edits[section];
  else edits[section] = value;
}

// Carry the original focal point through a turn or reflection. Translating the
// normalized coordinates unchanged would select a different subject after a turn.
function focalAfterTransform(photo, updated, format, catalog) {
  const before = layoutPrint(photo,format,catalog);
  const after = layoutPrint({...updated,crop:null},format,catalog);
  const r = before.source;
  const x = (r.x + r.width / 2 - .5) * before.view.width * (photo.edits?.mirrorX ? -1 : 1);
  const y = (r.y + r.height / 2 - .5) * before.view.height * (photo.edits?.mirrorY ? -1 : 1);
  const c = Math.cos(before.view.radians), s = Math.sin(before.view.radians);
  const ox = x * c + y * s, oy = -x * s + y * c;
  const ca = Math.cos(after.view.radians), sa = Math.sin(after.view.radians);
  return {
    x:.5 + (ox * ca - oy * sa) * (updated.edits?.mirrorX ? -1 : 1) / after.view.width,
    y:.5 + (ox * sa + oy * ca) * (updated.edits?.mirrorY ? -1 : 1) / after.view.height
  };
}

export function createCropEditor(drafts, format, catalog, bulk, onFrame) {
  const element = node('section','crop-editor');
  let selected = 0, activeTab = 'crop', compare = false, expanded = false;
  let pendingEdits = {}, pendingPose = {}, turn = 0, clearCrop = false, clearEdits = false;
  let raf = 0, revision = 0, drag, current, layout;
  const filename = node('strong','crop-filename');
  const previous = command('‹', () => {selected--; redraw();});
  const next = command('›', () => {selected++; redraw();});
  previous.setAttribute('aria-label','Предыдущий снимок');
  next.setAttribute('aria-label','Следующий снимок');
  previous.hidden = next.hidden = !bulk || drafts.length < 2;
  const navigation = node('div','crop-navigation');
  navigation.append(previous,filename,next);

  // Deltas touch only the chosen controls. Each batch member keeps its other edits and its
  // own aspect ratio. Until Save, only the currently visible proof needs to be rendered.
  function projected(photo) {
    const out = {...photo, edits:clearEdits ? {} : clone(photo.edits)};
    const pose = !clearCrop && photo.crop ? cropPose(photo,format,catalog) : null;
    for (const [path,value] of Object.entries(pendingEdits)) writeValue(out.edits,path,value);
    if (turn) out.edits.angle = angle((out.edits.angle || 0) + turn);
    constrainFrameEdits(out,format,catalog);
    if (clearCrop) out.crop = null;
    const geometry = turn || Object.keys(pendingEdits).some(key =>
      ['angle','orientation','mirrorX','mirrorY'].includes(key) || (key.startsWith('frame.') && key !== 'frame.color'));
    if (pose && geometry) {
      const center = focalAfterTransform(photo,out,format,catalog);
      const base = coverWindow(out,format,catalog);
      const w = base.width / pose.zoom, h = base.height / pose.zoom;
      pose.x = w >= .999999 ? .5 : clamp((center.x - w/2)/(1-w));
      pose.y = h >= .999999 ? .5 : clamp((center.y - h/2)/(1-h));
    }
    if ((pose && geometry) || Object.keys(pendingPose).length) setCropPose(out,format,catalog,{...neutral,...pose,...pendingPose});
    if (!Object.keys(out.edits).length) out.edits = null;
    return out;
  }
  function flush() {
    if (!turn && !clearCrop && !clearEdits && !Object.keys(pendingEdits).length && !Object.keys(pendingPose).length) return;
    for (const draft of drafts) {
      const applied = projected(draft);
      draft.edits = applied.edits;
      draft.crop = applied.crop;
    }
    pendingEdits = {}; pendingPose = {}; turn = 0; clearCrop = clearEdits = false;
  }
  function setEdit(path,value) {
    if (path === 'angle') turn = 0;
    pendingEdits[path] = value;
    compare = false;
    redraw();
  }
  function setPose(change) { Object.assign(pendingPose,change); compare = false; redraw(); }

  const views = node('div','edit-views');
  const sourcePane = node('div','edit-pane'), proofPane = node('div','edit-pane');
  const sourceTitle = node('span','edit-view-label','Область печати');
  const sourceStage = node('div','editor-source-stage');
  const sourceSheet = node('div','editor-source-sheet'), sourceCanvas = node('canvas','editor-source');
  sourceCanvas.setAttribute('role','img'); sourceCanvas.setAttribute('aria-label','Полный снимок');
  const box = node('div','editor-crop-box');
  box.tabIndex = 0; box.setAttribute('role','group');
  box.setAttribute('aria-label','Область печати. Стрелки перемещают её, плюс и минус меняют размер.');
  for (const [corner,label] of [['nw','верхний левый'],['ne','верхний правый'],['sw','нижний левый'],['se','нижний правый']]) {
    const handle = node('button','crop-handle ' + corner);
    handle.type = 'button'; handle.dataset.corner = corner;
    handle.setAttribute('aria-label','Изменить ' + label + ' угол стрелками');
    box.append(handle);
  }
  sourceSheet.append(sourceCanvas,box); sourceStage.append(sourceSheet);
  sourcePane.append(sourceTitle,sourceStage);
  const proof = node('canvas','editor-proof'), proofStage = node('div','editor-proof-stage');
  proof.setAttribute('role','img'); proof.setAttribute('aria-label','Готовый отпечаток');
  proofStage.append(proof); proofPane.append(node('span','edit-view-label','Готовый отпечаток'),proofStage);
  views.append(sourcePane,proofPane);
  const quality = node('p','photo-quality');
  const hint = node('p','crop-hint','Перетащите область печати. Потяните за угол, чтобы изменить её размер.');
  const compareButton = command('Показать оригинал',() => {compare = !compare; redraw();});
  const enlargeButton = command('Увеличить область', () => {
    expanded = !expanded;
    views.classList.toggle('source-expanded',expanded);
    enlargeButton.textContent = expanded ? 'Два просмотра' : 'Увеличить область';
    enlargeButton.setAttribute('aria-pressed',String(expanded));
    redraw();
  });
  const reset = command('Сбросить правки',() => {
    pendingEdits = {}; pendingPose = {}; turn=0; clearCrop=clearEdits=true; compare=false;
    if (onFrame && format.frameIds.includes('none')) onFrame('none');
    redraw();
  });
  const actions = node('div','editor-proof-actions'); actions.append(enlargeButton,compareButton,reset);
  const tabRow = node('div','editor-tabs');
  tabRow.setAttribute('role','group'); tabRow.setAttribute('aria-label','Инструменты редактора');
  const panels = {}, tabs = {};
  for (const [id,label] of [['crop','Кадр'],['color','Цвет'],['frame','Рамка']]) {
    const tab = command(label,() => {activeTab = id; redraw();});
    tabs[id] = tab; tabRow.append(tab);
    panels[id] = node('div','editor-tab-panel');
  }

  const orientation = selectField('Ориентация отпечатка',{auto:'По снимку',portrait:'Портретная',landscape:'Альбомная'},
    val => setEdit('orientation',val === 'auto' ? null : val));
  const rotations = node('div','edit-tool-row');
  function quarter(degrees) {turn = angle(turn + degrees); compare = false; redraw();}
  rotations.append(command('↶ 90°',() => quarter(-90)), command('↷ 90°',() => quarter(90)));
  const mx = command('Отразить по горизонтали',() => setEdit('mirrorX',!current.edits?.mirrorX));
  const my = command('Отразить по вертикали',() => setEdit('mirrorY',!current.edits?.mirrorY));
  rotations.append(mx,my);
  const degrees = slider('Угол поворота',-180,180,.5,value => setEdit('angle',angle(value)),'°');
  const zoom = slider('Масштаб',100,600,1,value => setPose({zoom:value/100}),'%');
  const hor = slider('По горизонтали',0,100,1,value => setPose({x:value/100}),'%');
  const ver = slider('По вертикали',0,100,1,value => setPose({y:value/100}),'%');
  const resetCrop = command('Сбросить кадрирование',() => {pendingPose={};clearCrop=true;redraw();});
  panels.crop.append(orientation.field,rotations,degrees.field,zoom.field,hor.field,ver.field,resetCrop);

  const filter = selectField('Фильтр',presetLabels, val => setEdit('preset',val==='none' ? null : val));
  const tones = node('div','edit-tone-grid');
  const toneControls = Object.fromEntries(Object.entries(toneLabels).map(([key,label]) => {
    const control=slider(label,-100,100,1,v => setEdit('tone.'+key,v || null));
    tones.append(control.field); return [key,control];
  }));
  panels.color.append(filter.field,tones);

  const available = Object.fromEntries(format.frameIds.map(key => [key,catalog.frames.find(o=>o.id===key).label]));
  const type = selectField('Тип рамки', available, val => {flush(); onFrame?.(val); redraw();});
  const colorField = node('label','editor-field','Цвет рамки'), color = node('input');
  color.type='color'; color.addEventListener('input',()=>setEdit('frame.color',color.value));
  colorField.append(color);
  const edges = node('div','editor-edges');
  const edgeControls = {};
  for (const [side,label] of Object.entries(frameNames)) {
    const inp=node('input'), field=node('label','editor-field',label + ', мм');
    Object.assign(inp,{type:'number',min:0,step:'0.1'});
    inp.addEventListener('change',()=> {
      if (!inp.value) setEdit('frame.'+side,null);
      else if (inp.reportValidity()) setEdit('frame.'+side,Number(inp.value));
      else redraw();
    });
    field.append(inp); edges.append(field); edgeControls[side] = inp;
  }
  const resetFrame = command('Поля выбранной рамки',() => {
    for (const key of ['color',...Object.keys(frameNames)]) pendingEdits['frame.'+key] = null;
    redraw();
  });
  panels.frame.append(type.field,colorField,edges,resetFrame);

  function place(rect) {
    Object.assign(box.style,{left:rect.x*100+'%',top:rect.y*100+'%',width:rect.width*100+'%',height:rect.height*100+'%'});
  }
  function redraw() {
    current=projected(drafts[selected]);
    layout=layoutPrint(current,format,catalog);
    const pose=cropPose(current,format,catalog);
    const ed=current.edits || {};
    filename.textContent=(bulk ? (selected+1)+' / '+drafts.length+' · ' : '') + current.asset.file.name;
    previous.disabled=selected===0; next.disabled=selected===drafts.length-1;
    previous.hidden=next.hidden=!bulk || drafts.length<2;
    const dpi=effectiveDpi(layout);
    const grade=dpi >= 300 ? 'высокое качество' : dpi >= 150 ? 'подходит для печати' : 'возможна потеря чёткости';
    quality.textContent=current.asset.width+' × '+current.asset.height+' пикс. · '+dpi+' dpi · '+grade;
    quality.dataset.low=String(dpi<150);
    for (const id of Object.keys(tabs)) {
      tabs[id].setAttribute('aria-pressed',String(id===activeTab));
      panels[id].hidden=id!==activeTab;
    }
    const source = compare ? {...current,crop:null,edits:null} : current;
    const raw = layoutPrint(source,format,catalog).view;
    sourceSheet.style.setProperty('--source-ratio',String(raw.width/raw.height));
    proof.style.setProperty('--sheet-ratio',String(layout.width/layout.height));
    sourceTitle.textContent=compare ? 'Оригинал' : 'Область печати';
    box.hidden=hint.hidden=compare;
    place(layout.source);
    compareButton.textContent=compare ? 'Вернуться к обработке' : 'Показать оригинал';
    compareButton.setAttribute('aria-pressed',String(compare));
    orientation.select.value=ed.orientation || 'auto';
    mx.setAttribute('aria-pressed',String(Boolean(ed.mirrorX))); my.setAttribute('aria-pressed',String(Boolean(ed.mirrorY)));
    const base = coverWindow(current,format,catalog);
    const maxZoom = Math.max(1, Math.min(base.width * layout.view.width, base.height * layout.view.height));
    // Keep common zoom levels easy to select. Drag handles can select down to one source pixel.
    zoom.input.max = Math.min(maxZoom * 100, Math.max(600, Math.ceil(pose.zoom * 100)));
    degrees.update(ed.angle || 0); zoom.update(Math.round(pose.zoom*100)); hor.update(Math.round(pose.x*100)); ver.update(Math.round(pose.y*100));
    hor.input.disabled=coverWindow(current,format,catalog).width/pose.zoom >= .999999;
    ver.input.disabled=coverWindow(current,format,catalog).height/pose.zoom >= .999999;
    filter.select.value=ed.preset || 'none';
    for (const [key,control] of Object.entries(toneControls)) control.update(ed.tone?.[key] || 0);
    type.select.value=current.frameId;
    const frame = catalog.frames.find(o=>o.id===current.frameId);
    const noFrame=(frame.preview || frame.id)==='none';
    color.disabled=resetFrame.disabled=noFrame; color.value=layout.background;
    const margins=frameMargins(current,format,catalog);
    const mm=sheetMillimeters(current,format);
    for (const [key,inp] of Object.entries(edgeControls)) {
      const horizontal=key==='left' || key==='right', opp={left:'right',right:'left',top:'bottom',bottom:'top'}[key];
      inp.disabled=noFrame;
      inp.max=Math.max(0,Math.floor(((horizontal?mm.width:mm.height) - margins[opp] - 1)*10)/10);
      inp.value=String(Math.round(margins[key]*10)/10);
    }
    const ticket=++revision;
    cancelAnimationFrame(raf);
    raf=requestAnimationFrame(() => {
      const valid=()=>ticket===revision&&element.isConnected;
      if (!valid()) return;
      Promise.all([
        paintPrint(sourceCanvas,source,format,catalog,{maxSide:expanded ? 1100 : 700,sourceView:true,valid}),
        paintPrint(proof,current,format,catalog,{maxSide:445,valid})
      ]).catch(()=>{if(valid()) quality.textContent='Не удалось показать снимок. Попробуйте открыть редактор заново.';});
    });
  }

  function fromRect(rect) {
    const base=coverWindow(current,format,catalog);
    setPose({zoom:base.width / rect.width,
      x:rect.width >= .999999 ? .5 : rect.x / (1-rect.width),
      y:rect.height >= .999999 ? .5 : rect.y / (1-rect.height)});
  }
  box.addEventListener('pointerdown',e => {
    if (drag || e.button!==0) return;
    const bounds=sourceSheet.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const base=coverWindow(current,format,catalog);
    const pose=cropPose(current,format,catalog);
    const temp={...current}; setCropPose(temp,format,catalog,pose);
    drag={id:e.pointerId,x:e.clientX,y:e.clientY,bounds,rect:temp.crop || base,base,corner:e.target.closest('[data-corner]')?.dataset.corner};
    box.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  box.addEventListener('pointermove',e=>{
    if (!drag || e.pointerId!==drag.id) return;
    const dx=(e.clientX-drag.x)/drag.bounds.width, dy=(e.clientY-drag.y)/drag.bounds.height;
    const r=drag.rect;
    const minWidth = Math.max(1/layout.view.width, (drag.base.width/drag.base.height)/layout.view.height);
    fromRect(drag.corner ? resizeCrop(r,drag.base,drag.corner,dx,dy,minWidth)
      : {...r,x:clamp(r.x+dx,0,1-r.width),y:clamp(r.y+dy,0,1-r.height)});
  });
  box.addEventListener('lostpointercapture',()=>{drag=null;});
  box.addEventListener('keydown',e=>{
    const steps={ArrowLeft:[-.01,0],ArrowRight:[.01,0],ArrowUp:[0,-.01],ArrowDown:[0,.01]};
    const pose=cropPose(current,format,catalog);
    if (e.key==='+'||e.key==='='||e.key==='-') {
      setPose({zoom:Math.max(1,pose.zoom+(e.key==='-'?-.1:.1))});e.preventDefault();return;
    }
    if (!Object.hasOwn(steps,e.key)) return;
    const corner=e.target.dataset.corner;
    const [dx,dy]=steps[e.key].map(v=>v*(e.shiftKey?5:1));
    const base=coverWindow(current,format,catalog);
    const temp={...current};setCropPose(temp,format,catalog,pose);
    const r=temp.crop || base;
    const minWidth = Math.max(1/layout.view.width, (base.width/base.height)/layout.view.height);
    fromRect(corner?resizeCrop(r,base,corner,dx,dy,minWidth):{...r,x:clamp(r.x+dx,0,1-r.width),y:clamp(r.y+dy,0,1-r.height)});
    e.preventDefault();
  });
  element.append(navigation,views,hint,quality,actions,tabRow,...Object.values(panels));
  redraw();
  return {element,redraw,flush};
}
