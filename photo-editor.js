import { layoutPrint } from './print-render.js';

const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const round = (value) => Math.round(value * 1e6) / 1e6;
const neutral = { zoom: 1, x: 0.5, y: 0.5 };

// Position is the fraction of available travel. A batch can move to the right
// edge of both portrait and landscape originals without copying incompatible pixel crops.
export function cropPose(photo, format, catalog) {
  if (!photo.crop) return { ...neutral };
  const auto = layoutPrint({ ...photo, crop: null }, format, catalog).source;
  const src = layoutPrint(photo, format, catalog).source;
  return {
    zoom: clamp(Math.min(auto.width / src.width, auto.height / src.height), 1, 6),
    x: src.width >= 0.999999 ? 0.5 : clamp(src.x / (1 - src.width)),
    y: src.height >= 0.999999 ? 0.5 : clamp(src.y / (1 - src.height))
  };
}
export function setCropPose(photo, format, catalog, pose) {
  const auto = layoutPrint({ ...photo, crop: null }, format, catalog).source;
  const zoom = clamp(pose.zoom, 1, 6);
  const width = Math.max(0.000001, round(auto.width / zoom));
  const height = Math.max(0.000001, round(auto.height / zoom));
  const x = round((1 - width) * clamp(pose.x));
  const y = round((1 - height) * clamp(pose.y));
  photo.crop = zoom <= 1.000001 && Math.abs(x - auto.x) < 0.000002 && Math.abs(y - auto.y) < 0.000002
    ? null : { x, y, width, height };
}
function node(tag, name, text) {
  const result = document.createElement(tag);
  if (name) result.className = name;
  if (text != null) result.textContent = text;
  return result;
}
function action(text, listener) {
  const element = node('button', 'crop-command', text);
  element.type = 'button';
  element.addEventListener('click', listener);
  return element;
}
function place(element, box) {
  Object.assign(element.style, {
    left: box.x * 100 + '%', top: box.y * 100 + '%',
    width: box.width * 100 + '%', height: box.height * 100 + '%'
  });
}
function draw(sheet, photo, format, catalog) {
  const layout = layoutPrint(photo, format, catalog);
  const ratio = layout.width / layout.height;
  sheet.style.aspectRatio = ratio;
  sheet.style.width = 'min(100cqw, ' + (ratio * 100) + 'cqh)';
  sheet.style.height = 'min(100cqh, ' + (100 / ratio) + 'cqw)';
  sheet.style.backgroundColor = layout.background;
  const window = sheet.firstChild;
  const img = window.firstChild;
  place(window, layout.destination);
  const source = layout.source;
  place(img, { x: -source.x / source.width, y: -source.y / source.height, width: 1 / source.width, height: 1 / source.height });
  if (img.src !== photo.asset.url) img.src = photo.asset.url;
  img.alt = photo.asset.file.name;
  return layout;
}
function newSheet() {
  const sheet = node('div', 'print-sheet crop-sheet');
  const viewport = node('div', 'crop-image-window');
  const img = node('img');
  img.draggable = false;
  viewport.append(img);
  sheet.append(viewport);
  return sheet;
}
export function photoPreview(photo, format, catalog, className) {
  const frame = node('div', className);
  const sheet = newSheet();
  draw(sheet, photo, format, catalog);
  frame.append(sheet);
  return frame;
}
function range(caption, min, max, change) {
  const label = node('label', 'crop-control');
  const text = node('span', '', caption);
  const value = node('span', 'crop-value');
  const input = node('input');
  Object.assign(input, { type: 'range', min, max, step: 1 });
  input.setAttribute('aria-label', caption);
  input.addEventListener('input', () => change(Number(input.value)));
  label.append(text, value, input);
  return { label, input, value };
}

export function createCropEditor(drafts, format, catalog, bulk) {
  const element = node('section', 'crop-editor');
  const area = node('div', 'edit-preview crop-stage');
  const sheet = newSheet();
  area.append(sheet);
  let selected = 0;
  let drag;
  let layout;
  let originalCrops;
  let pending = {};
  let resetPending = false;
  let anyCrop = drafts.some((draft) => draft.crop);
  const filename = node('span', 'crop-filename');
  const navigation = node('div', 'crop-navigation');
  const previous = action('‹', () => { selected--; redraw(); });
  const next = action('›', () => { selected++; redraw(); });
  previous.setAttribute('aria-label', 'Предыдущий снимок');
  next.setAttribute('aria-label', 'Следующий снимок');
  navigation.append(previous, filename, next);
  previous.hidden = next.hidden = drafts.length < 2;
  function remember() {
    if (!originalCrops) originalCrops = new Map(drafts.map((draft) => [draft, draft.crop || null]));
  }
  function materialize(photo) {
    if (!originalCrops) return;
    photo.crop = resetPending ? null : originalCrops.get(photo);
    if (Object.keys(pending).length) setCropPose(photo, format, catalog, { ...cropPose(photo, format, catalog), ...pending });
  }
  function flush() {
    if (!originalCrops) return;
    drafts.forEach(materialize);
    originalCrops = null;
    pending = {};
    resetPending = false;
    anyCrop = drafts.some((draft) => draft.crop);
  }
  function apply(delta) {
    remember();
    Object.assign(pending, delta);
    redraw();
  }
  const zoom = range('Масштаб', 100, 600, (value) => apply({ zoom: value / 100 }));
  const x = range('По горизонтали', 0, 100, (value) => apply({ x: value / 100 }));
  const y = range('По вертикали', 0, 100, (value) => apply({ y: value / 100 }));
  const ranges = node('div', 'crop-ranges');
  ranges.append(zoom.label, x.label, y.label);
  const reset = action('Сбросить кадрирование', () => {
    remember();
    pending = {};
    resetPending = true;
    redraw();
  });
  function redraw() {
    const photo = drafts[selected];
    materialize(photo);
    layout = draw(sheet, photo, format, catalog);
    const pose = cropPose(photo, format, catalog);
    filename.textContent = (bulk ? (selected + 1) + ' / ' + drafts.length + ' · ' : '') + photo.asset.file.name;
    previous.disabled = selected === 0;
    next.disabled = selected === drafts.length - 1;
    for (const [control, number] of [[zoom, pose.zoom], [x, pose.x], [y, pose.y]]) {
      control.input.value = String(Math.round(number * 100));
      control.value.textContent = control.input.value + '%';
    }
    x.input.disabled = layout.source.width >= 0.999999;
    y.input.disabled = layout.source.height >= 0.999999;
    reset.disabled = !(photo.crop || (!resetPending && anyCrop) || Object.keys(pending).length);
  }
  area.addEventListener('pointerdown', (event) => {
    if (drag || event.button !== 0) return;
    const rect = sheet.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, pose: cropPose(drafts[selected], format, catalog), layout, rect };
    area.setPointerCapture(event.pointerId);
    area.classList.add('dragging');
    event.preventDefault();
  });
  area.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const { source, destination } = drag.layout;
    const delta = {};
    if (source.width < 0.999999 && event.clientX !== drag.x) {
      delta.x = clamp(drag.pose.x - (event.clientX - drag.x) * source.width / (drag.rect.width * destination.width * (1 - source.width)));
    }
    if (source.height < 0.999999 && event.clientY !== drag.y) {
      delta.y = clamp(drag.pose.y - (event.clientY - drag.y) * source.height / (drag.rect.height * destination.height * (1 - source.height)));
    }
    if (Object.keys(delta).length) apply(delta);
  });
  area.addEventListener('lostpointercapture', () => { drag = null; area.classList.remove('dragging'); });
  area.addEventListener('wheel', (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    apply({ zoom: clamp(cropPose(drafts[selected], format, catalog).zoom * Math.exp(-event.deltaY / 300), 1, 6) });
  }, { passive: false });
  element.append(navigation, area, node('p', 'crop-hint', 'Передвигайте снимок в рамке или пользуйтесь ползунками.'), ranges, reset);
  redraw();
  return { element, redraw, flush };
}
