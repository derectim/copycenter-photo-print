import { demoCatalog } from './catalog.js';
import { makeZip } from './zip.js';
import { photoPreview, releasePreviews, createCropEditor, cropPose, setCropPose } from './photo-editor.js?v=2.1';
import { constrainFrameEdits, layoutPrint, renderPrint } from './print-render.js';
import { readPrintAsset } from './photo-input.js';
import {connectWorkspace} from './photo-workspace.js';
import {productionRuns, safePrintBasename} from './production-folders.js';

const root = document.getElementById('print-app');
const $ = (id) => root.querySelector('#' + id);
const runtime = window.COPYCENTER_PRINT;
const endpoint = runtime?.endpoint ? new URL(runtime.endpoint, location.href) : null;
const fields = [
  { key: 'paperId', list: 'papers', allowed: 'paperIds', label: 'Бумага' },
  { key: 'fitId', list: 'fits', allowed: 'fitIds', label: 'Кадрирование' },
  { key: 'frameId', list: 'frames', allowed: 'frameIds', label: 'Рамка' }
];
const samples = [
  ['sample-coast.jpg', 'Побережье.jpg'],
  ['sample-lake.jpg', 'Озеро.jpg'],
  ['sample-city.jpg', 'Город.jpg']
];
const priceFormat = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2, minimumFractionDigits: 0 });
const money = (kopecks) => priceFormat.format(kopecks / 100);
const MAX_ITEMS = 5000;
const MAX_SOURCE_BYTES = 20_000_000_000;
const PAGE_SIZE = 36;
const defaultLimits = { maxOrderBytes: MAX_SOURCE_BYTES, maxFileBytes: 20 * 1024 * 1024, maxItems: MAX_ITEMS };
let limits = { ...defaultLimits };
const id = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  return Array.from(bytes, (b, i) => ([4, 6, 8, 10].includes(i) ? '-' : '') + b.toString(16).padStart(2, '0')).join('');
};
let catalog;
let catalogVersion;
let sessid;
let signedUserId;
let groups = [];
let active;
let centerId;
let busy = false;
let checkoutKey = '';
let checkoutRequest;
let draftId;
let openDialog;
let workspace;
const selectedPhotos = new Set();
let groupPrices = new Map();
const catalogIndexes = new WeakMap();

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function button(label, css, listener) {
  const element = el('button', css, label);
  element.type = 'button';
  element.addEventListener('click', listener);
  return element;
}
function iconButton(label, icon, listener) {
  const control = button('', 'icon-button', listener);
  control.title = label;
  control.setAttribute('aria-label', label);
  if (typeof window.printIcon === 'function') control.innerHTML = window.printIcon(icon);
  else control.textContent = { edit: '✎', trash: '×', x: '×' }[icon];
  return control;
}
function feedback(message, tone = 'info') {
  $('feedback').textContent = message;
  $('feedback').dataset.tone = tone;
}
function byId(list, key) {
  const entries = catalog[list];
  if (!entries) return undefined;
  if (!catalogIndexes.has(entries)) catalogIndexes.set(entries, new Map(entries.map((entry) => [entry.id, entry])));
  return catalogIndexes.get(entries).get(key);
}
function formatOf(group) { return byId('formats', group.formatId); }
function validChoices(format, field) {
  return format[field.allowed].map((key) => byId(field.list, key)).filter(Boolean);
}
function settings(format, existing = {}) {
  const result = {
    copies: existing.copies || 1,
    extraIds: (format.extraIds || []).filter((key) => existing.extraIds?.includes(key)).sort()
  };
  for (const field of fields) {
    result[field.key] = format[field.allowed].includes(existing[field.key]) ? existing[field.key] : format[field.allowed][0];
  }
  return result;
}
function makeGroup(format) {
  return { formatId: format.id, defaults: settings(format), photos: [] };
}
function surcharge(format, list, choice) {
  return Math.round(Number(format.surcharges?.[list]?.[choice.id] ?? choice.surcharge ?? 0) * 100);
}
function choiceLabel(format, list, choice) {
  const cost = surcharge(format, list, choice);
  return cost ? choice.label + ' (+' + money(cost) + ')' : choice.label;
}
function pricesOf(group) {
  if (groupPrices.has(group)) return groupPrices.get(group);
  const format = formatOf(group);
  const count = group.photos.reduce((sum, photo) => sum + photo.copies, 0);
  const tiers = format.tiers.filter((tier) => tier.min <= Math.max(count, 1));
  const tier = tiers.reduce((highest, current) => current.min > highest.min ? current : highest);
  const unit = (photo) => {
    const options = fields.reduce((sum, field) => sum + surcharge(format, field.list, byId(field.list, photo[field.key])), 0);
    const extras = (photo.extraIds || []).reduce((sum, key) => sum + surcharge(format, 'extras', byId('extras', key)), 0);
    return Math.round(tier.price * 100) + options + extras;
  };
  let total = 0;
  const units = new Map([[group.defaults, unit(group.defaults)]]);
  for (const photo of group.photos) {
    const price = unit(photo);
    units.set(photo, price);
    total += price * photo.copies;
  }
  const prices = { count, total, units };
  groupPrices.set(group, prices);
  return prices;
}
const countCopies = (group) => pricesOf(group).count;
const subtotal = (group) => pricesOf(group).total;
const unitPrice = (group, photo) => pricesOf(group).units.get(photo);
function needsQuote(group) {
  const limit = formatOf(group).quoteLimit;
  return limit && countCopies(group) > limit;
}
function canCheckout() {
  return allPhotos().length > 0 && !groups.some(needsQuote) && !orderLimitIssue();
}
function allPhotos() { return groups.flatMap((group) => group.photos); }
function orderLimitIssue() {
  const rows = allPhotos();
  if (rows.length > limits.maxItems) return 'В заказе может быть до ' + limits.maxItems.toLocaleString('ru-RU') + ' снимков.';
  const unique = new Set(rows.map((row) => row.asset));
  let size = 0;
  for (const asset of unique) {
    if (asset.file.size > limits.maxFileBytes) return 'Размер файла «' + asset.file.name + '» превышает текущий лимит магазина.';
    size += asset.file.size;
  }
  return size > limits.maxOrderBytes ? 'Суммарный размер оригиналов превышает ' + limits.maxOrderBytes / 1e9 + ' ГБ.' : '';
}
function applyLimits(data) {
  limits = { ...defaultLimits };
  for (const key of Object.keys(limits)) {
    const value = data?.[key];
    if (Number.isSafeInteger(value) && value > 0) limits[key] = Math.min(value, limits[key]);
  }
  const hint = root.querySelector('[data-order-limits]');
  if (hint) hint.textContent = 'До ' + (limits.maxFileBytes / MiB).toLocaleString('ru-RU') + ' МБ за файл. Общее хранилище — 20 ГБ.'
    + (limits.maxOrderBytes < MAX_SOURCE_BYTES ? ' На один заказ — до ' + (limits.maxOrderBytes/1e9).toLocaleString('ru-RU') + ' ГБ.' : '');
}
function setOptions(select, options, value) {
  select.replaceChildren(...options.map((entry) => new Option(entry.label, entry.id)));
  select.value = value;
}
function updateDefaults(key, value) {
  active.defaults[key] = value;
  for (const photo of active.photos) changePhoto(photo, { [key]: value }, formatOf(active));
  render();
}
function changePhoto(photo, values, nextFormat, previousFormat = nextFormat, previousCatalog = catalog) {
  const geometryChanged = previousFormat !== nextFormat || previousCatalog !== catalog ||
    (values.fitId !== undefined && values.fitId !== photo.fitId) || (values.frameId !== undefined && values.frameId !== photo.frameId);
  const pose = geometryChanged && photo.crop ? cropPose(photo, previousFormat, previousCatalog) : null;
  if (values.frameId !== undefined && values.frameId !== photo.frameId && photo.edits?.frame) {
    photo.edits = {...photo.edits};
    delete photo.edits.frame;
  }
  Object.assign(photo, values);
  constrainFrameEdits(photo,nextFormat,catalog);
  if (pose) setCropPose(photo, nextFormat, catalog, pose);
}
function bindOptionFields(container, format, values, onChange, buttonPaper) {
  container.replaceChildren();
  for (const field of fields) {
    if (!buttonPaper && field.key === 'frameId') continue; // The editor's frame tab owns this selection.
    const group = el('div', 'option-group');
    const choices = validChoices(format, field);
    if (buttonPaper && field.key === 'paperId') {
      const label = el('span', 'option-label', field.label);
      const controls = el('div', 'option-choices');
      controls.setAttribute('role', 'group');
      controls.setAttribute('aria-label', field.label);
      for (const choice of choices) {
        const control = button(choiceLabel(format, field.list, choice), 'option-choice', () => onChange(field.key, choice.id));
        control.dataset.focusKey = field.key + '-' + choice.id;
        control.setAttribute('aria-pressed', String(choice.id === values[field.key]));
        controls.append(control);
      }
      group.append(label, controls);
    } else {
      const label = el('label', 'option-label', field.label);
      const select = el('select', 'option-select');
      label.htmlFor = select.id = (buttonPaper ? 'print-' : 'edit-') + field.key;
      select.dataset.focusKey = field.key;
      setOptions(select, choices.map((choice) => ({ id: choice.id, label: choiceLabel(format, field.list, choice) })), values[field.key]);
      if (values[field.key] === null) {
        const placeholder = new Option('Разные значения', '', true, true);
        placeholder.disabled = true;
        select.prepend(placeholder);
        select.value = '';
      }
      select.addEventListener('change', () => onChange(field.key, select.value));
      group.append(label, select);
    }
    container.append(group);
  }
}

function toggleExtra(settings, key, selected) {
  const ids = new Set(settings.extraIds || []);
  if (selected) ids.add(key);
  else ids.delete(key);
  settings.extraIds = Array.from(ids).sort();
}
function bindExtras(container, format, settingsList, changed, groupMode) {
  if (!format.extraIds?.length) return;
  const fieldset = el('fieldset', 'print-extras');
  fieldset.append(el('legend', 'option-label', 'Дополнительные услуги'));
  for (const key of format.extraIds) {
    const extra = byId('extras', key);
    const label = el('label', 'print-extra');
    const check = el('input');
    check.type = 'checkbox';
    check.dataset.focusKey = (groupMode ? 'group-extra-' : 'photo-extra-') + key;
    const selected = settingsList.filter((item) => item.extraIds?.includes(key)).length;
    check.checked = selected === settingsList.length;
    check.indeterminate = selected > 0 && selected < settingsList.length;
    check.addEventListener('change', () => changed(key, check.checked));
    label.append(check, el('span', '', extra.label));
    const cost = surcharge(format, 'extras', extra);
    label.append(el('span', 'print-extra-price', cost ? '+' + money(cost) : '0 ₽'));
    fieldset.append(label);
  }
  const note = endpoint ? 'Доплата за каждый отпечаток.' : 'Демонстрационные доплаты за каждый отпечаток.';
  fieldset.append(el('p', 'print-extras-note', note));
  container.append(fieldset);
}

function releaseUnused(asset) {
  if (!allPhotos().some((photo) => photo.asset === asset)) URL.revokeObjectURL(asset.url);
}
function removeGroup(group) {
  const remove = () => {
    groups = groups.filter((item) => item !== group);
    if (active === group) active = groups[0];
    for (const photo of group.photos) selectedPhotos.delete(photo);
    const remaining = new Set(allPhotos().map((photo) => photo.asset));
    const removed = new Set(group.photos.map((photo) => photo.asset));
    for (const asset of removed) if (!remaining.has(asset)) URL.revokeObjectURL(asset.url);
    render();
  };
  if (!group.photos.length) { remove(); return; }
  const dialog = showDialog('Удалить формат?');
  dialog.content.append(el('p', '', 'Из заказа будут удалены снимки формата ' + formatOf(group).label + '.'));
  dialog.actions.append(button('Отмена', 'button secondary', dialog.close), button('Удалить формат', 'button primary', () => { dialog.close(); remove(); }));
}
function renderTabs() {
  $('format-tabs').replaceChildren(...groups.map((group) => {
    const wrap = el('div', 'format-tab-wrap');
    const tab = button(formatOf(group).label, 'format-tab', () => { active = group; feedback(''); render(); });
    tab.dataset.focusKey = 'tab-' + group.formatId;
    tab.setAttribute('aria-pressed', String(group === active));
    wrap.append(tab);
    if (groups.length > 1) {
      const close = iconButton('Удалить формат ' + formatOf(group).label, 'x', () => removeGroup(group));
      close.classList.add('format-remove');
      wrap.append(close);
    }
    return wrap;
  }));
  $('add-format').disabled = busy || groups.length >= catalog.formats.length;
}
function renderPhoto(group, photo) {
  const card = el('article', 'photo-card');
  const format = formatOf(group);
  const meta = el('div', 'photo-meta');
  const name = el('div', 'photo-name', photo.asset.file.name);
  name.title = photo.asset.file.name;
  const extraNames = (photo.extraIds || []).map((key) => byId('extras', key).label);
  const details = el('div', 'photo-details', [photo.copies + ' шт.', byId('papers', photo.paperId).label, ...extraNames].join(' · '));
  meta.append(name, details);
  const controls = el('div', 'photo-actions');
  controls.append(iconButton('Редактировать ' + photo.asset.file.name, 'edit', () => editPhotos(group, [photo])),
    iconButton('Удалить ' + photo.asset.file.name, 'trash', () => {
      group.photos = group.photos.filter((item) => item !== photo);
      selectedPhotos.delete(photo);
      releaseUnused(photo.asset);
      feedback('Удалено: ' + photo.asset.file.name);
      render();
    }));
  const choose=el('label','photo-select');
  const check=el('input');
  check.type='checkbox';check.checked=selectedPhotos.has(photo);
  check.setAttribute('aria-label','Выбрать '+photo.asset.file.name);
  check.addEventListener('change',()=>{check.checked?selectedPhotos.add(photo):selectedPhotos.delete(photo);selectionState();});
  choose.append(check, document.createTextNode('Выбрать'));
  card.append(photoPreview(photo, format, catalog, 'photo-preview'), meta, controls, choose);
  return card;
}
function selectionState(){
  const picked=active.photos.filter(p=>selectedPhotos.has(p));
  $('selection-tools').hidden=!active.photos.length;
  $('select-all-photos').checked=!!active.photos.length && picked.length===active.photos.length;
  $('select-all-photos').indeterminate=picked.length>0 && picked.length<active.photos.length;
  for(const key of ['selection-edit','selection-delete','selection-store'])$(key).disabled=!picked.length;
}
function priceBreakdown(){
  const box=$('format-estimate');box.replaceChildren();
  const filled=groups.filter(group=>group.photos.length);
  box.hidden=!filled.length;
  if(!filled.length)return;
  box.append(el('h4','','По форматам'));
  for(const group of filled){
    const row=el('div','estimate-row');
    const rates=new Map();
    for(const photo of group.photos){
      const price=unitPrice(group,photo);
      rates.set(price,(rates.get(price)||0)+photo.copies);
    }
    const quoted=needsQuote(group);
    row.append(el('strong','',formatOf(group).label),el('b','',quoted?'По запросу':money(subtotal(group))),
      el('small','',quoted?countCopies(group)+' шт.':Array.from(rates,([price,n])=>n+' шт. × '+money(price)).join(' + ')));
    box.append(row);
  }
}
function render() {
  groupPrices = new Map();
  const focusKey = document.activeElement?.dataset.focusKey;
  renderTabs();
  setOptions($('format-select'), catalog.formats, active.formatId);
  const physical=formatOf(active);
  $('format-physical').textContent=(physical.width*10).toLocaleString('ru-RU')+' × '+(physical.height*10).toLocaleString('ru-RU')+' мм';
  for (const option of $('format-select').options) option.disabled = groups.some((g) => g !== active && g.formatId === option.value);
  bindOptionFields($('option-fields'), formatOf(active), active.defaults, updateDefaults, true);
  const groupSettings = [active.defaults, ...active.photos];
  bindExtras($('option-fields'), formatOf(active), groupSettings, (key, selected) => {
    for (const item of groupSettings) toggleExtra(item, key, selected);
    render();
  }, true);
  $('copies-input').value = active.defaults.copies;
  $('copies-minus').disabled = busy || active.defaults.copies <= 1;
  $('copies-plus').disabled = busy || active.defaults.copies >= 999;
  $('empty-upload').hidden = active.photos.length > 0;
  if ($('more-files')) $('more-files').hidden = active.photos.length === 0;
  if ($('bulk-edit')) $('bulk-edit').hidden = active.photos.length === 0;
  const pages = Math.max(1, Math.ceil(active.photos.length / PAGE_SIZE));
  active.page = Math.min(active.page || 0, pages - 1);
  const first = active.page * PAGE_SIZE;
  releasePreviews($('photos'));
  $('photos').replaceChildren(...active.photos.slice(first, first + PAGE_SIZE).map((photo) => renderPhoto(active, photo)));
  let nav = $('photo-pagination');
  if (!nav) {
    nav = el('nav', 'photo-pagination');
    nav.id = 'photo-pagination';
    $('photos').after(nav);
  }
  pageNavigation(nav, active.photos.length, active.page, (page) => { active.page = page; render(); });
  $('photo-count').textContent = String(active.photos.length);
  $('summary-count').textContent = String(groups.reduce((sum, group) => sum + countCopies(group), 0));
  const quotation = groups.find(needsQuote);
  const unitCosts = (active.photos.length ? active.photos : [active.defaults]).map((photo) => unitPrice(active, photo));
  const low = Math.min(...unitCosts), high = Math.max(...unitCosts);
  $('summary-price').textContent = needsQuote(active) ? 'По запросу' : low === high ? money(low) : money(low) + ' – ' + money(high);
  $('summary-total').textContent = quotation ? 'По запросу' : money(groups.reduce((sum, group) => sum + subtotal(group), 0));
  $('checkout-button').disabled = busy || !canCheckout();
  let note = $('quote-note');
  if (!note) {
    note = el('p', 'review-note');
    note.id = 'quote-note';
    note.setAttribute('role', 'status');
    $('checkout-button').after(note);
  }
  const sizeIssue = orderLimitIssue();
  note.hidden = !quotation && !sizeIssue;
  note.textContent = sizeIssue || (quotation ? 'Для такого тиража ' + formatOf(quotation).label + ' стоимость рассчитает менеджер копицентра.' : '');
  selectionState();
  priceBreakdown();
  workspace?.changed();
  if (focusKey) Array.from(root.querySelectorAll('[data-focus-key]')).find((node) => node.dataset.focusKey === focusKey)?.focus({ preventScroll: true });
}
function pageNavigation(nav, length, page, change) {
  const pages = Math.ceil(length / PAGE_SIZE);
  nav.replaceChildren();
  nav.hidden = pages < 2;
  if (nav.hidden) return;
  nav.setAttribute('aria-label', 'Страницы фотографий');
  const prev = button('‹', 'crop-command', () => change(page - 1));
  const next = button('›', 'crop-command', () => change(page + 1));
  prev.setAttribute('aria-label', 'Предыдущая страница');
  next.setAttribute('aria-label', 'Следующая страница');
  prev.disabled = page === 0;
  next.disabled = page === pages - 1;
  const select = el('select', 'option-select');
  select.setAttribute('aria-label', 'Диапазон фотографий');
  for (let i = 0; i < pages; i++) select.add(new Option((i * PAGE_SIZE + 1) + '–' + Math.min(length, (i + 1) * PAGE_SIZE) + ' из ' + length, i));
  select.value = page;
  select.addEventListener('change', () => change(Number(select.value)));
  nav.append(prev, select, next);
}

function showDialog(title) {
  openDialog?.close();
  const dialog = el('dialog', 'print-dialog');
  const body = el('div', 'dialog-body');
  const header = el('div', 'dialog-header');
  const heading = el('h2', '', title);
  heading.id = 'print-dialog-title';
  dialog.setAttribute('aria-labelledby', heading.id);
  const content = el('div', 'dialog-content');
  const actions = el('div', 'dialog-actions');
  const close = () => dialog.close();
  header.append(heading, iconButton('Закрыть', 'x', close));
  body.append(header, content, actions);
  dialog.append(body);
  dialog.addEventListener('close', () => { dialog.remove(); if (openDialog === dialog) openDialog = null; }, { once: true });
  dialog.addEventListener('click', (event) => { if (event.target === dialog && !dialog.dataset.working) close(); });
  $('dialogs').append(dialog);
  openDialog = dialog;
  dialog.showModal();
  return { dialog, content, actions, close };
}
function editPhotos(group, photos, bulk = false) {
  if (!photos.length || busy) return;
  const entireFormat = bulk && (photos === group.photos || (photos.length > 1 && photos.length === group.photos.length));
  bulk = bulk && photos.length > 1;
  const dialog = showDialog(bulk ? 'Редактор группы' : 'Редактор снимка');
  dialog.dialog.classList.add('crop-dialog');
  const drafts = photos.map((photo) => ({ ...photo, crop: photo.crop ? { ...photo.crop } : null,
    edits: photo.edits ? structuredClone(photo.edits) : null, extraIds: [...(photo.extraIds || [])] }));
  const format = formatOf(group);
  const common = (key) => drafts.every((draft) => draft[key] === drafts[0][key]) ? drafts[0][key] : null;
  const values = Object.fromEntries(fields.map(({ key }) => [key, common(key)]));
  const changedDefaults = {};
  const changedExtras = new Map();
  const editor = createCropEditor(drafts, format, catalog, bulk, (frameId) => {
    changedDefaults.frameId = frameId;
    for (const draft of drafts) changePhoto(draft, {frameId}, format);
  });
  const controls = el('div', 'edit-options');
  bindOptionFields(controls, format, values, (key, value) => {
    if (key === 'fitId' || key === 'frameId') editor.flush();
    changedDefaults[key] = value;
    for (const draft of drafts) changePhoto(draft, { [key]: value }, format);
    editor.redraw();
  }, false);
  bindExtras(controls, format, drafts, (key, selected) => {
    changedExtras.set(key, selected);
    for (const draft of drafts) toggleExtra(draft, key, selected);
  }, false);
  const label = el('label', 'dialog-field', 'Количество экземпляров');
  const copies = el('input', 'option-select');
  Object.assign(copies, { type: 'number', min: '1', max: '999', step: '1', required: !bulk, value: common('copies') ?? '', placeholder: 'Разные значения' });
  let copiesEdited = false;
  copies.addEventListener('input', () => { copiesEdited = true; });
  label.append(copies);
  if (bulk) {
    const scope = entireFormat ? 'Изменения применятся ко всем снимкам формата ' + format.label + '.'
      : 'Изменения затронут только выделенные фотографии (' + photos.length + ' из ' + group.photos.length + ').';
    dialog.content.append(el('p', 'crop-scope', scope));
  }
  const settingsPanel = el('div', 'crop-settings');
  settingsPanel.append(controls, label);
  dialog.content.append(editor.element, settingsPanel);
  dialog.actions.append(button('Отмена', 'button secondary', dialog.close), button('Сохранить', 'button primary', () => {
    if (!copies.reportValidity()) return;
    editor.flush();
    drafts.forEach((draft, index) => {
      if (copies.value) draft.copies = Number(copies.value);
      Object.assign(photos[index], draft);
    });
    if (entireFormat) {
      Object.assign(group.defaults, changedDefaults);
      for (const [key, selected] of changedExtras) toggleExtra(group.defaults, key, selected);
      if (copiesEdited && copies.value) group.defaults.copies = Number(copies.value);
    }
    dialog.close();
    render();
  }));
}
function addFormat() {
  const available = catalog.formats.filter((entry) => !groups.some((group) => group.formatId === entry.id));
  if (!available.length || busy) return;
  const dialog = showDialog('Добавить формат');
  const label = el('label', 'dialog-field', 'Формат печати');
  const select = el('select', 'option-select');
  setOptions(select, available, available[0].id);
  label.append(select);
  dialog.content.append(label);
  const duplicate = el('input');
  duplicate.type = 'checkbox';
  if (active.photos.length && allPhotos().length + active.photos.length <= limits.maxItems) {
    const copyLabel = el('label', 'dialog-check');
    copyLabel.append(duplicate, document.createTextNode(' Добавить снимки из формата ' + formatOf(active).label));
    dialog.content.append(copyLabel);
  }
  dialog.actions.append(button('Отмена', 'button secondary', dialog.close), button('Добавить', 'button primary', () => {
    const format = byId('formats', select.value);
    const group = makeGroup(format);
    if (duplicate.checked) group.photos = active.photos.map((source) => {
      const copy = { asset: source.asset, ...settings(format, source), crop: null,
        edits: source.edits ? structuredClone(source.edits) : null };
      if (copy.frameId !== source.frameId && copy.edits) delete copy.edits.frame;
      constrainFrameEdits(copy,format,catalog);
      if (source.crop) setCropPose(copy, format, catalog, cropPose(source, formatOf(active), catalog));
      return copy;
    });
    groups.push(group);
    active = group;
    dialog.close();
    feedback('');
    render();
  }));
}

const MiB = 1024 * 1024;
function setBusy(value) {
  busy = value;
  root.setAttribute('aria-busy', String(value));
  if (active) {
    $('checkout-button').disabled = value || !canCheckout();
    $('add-format').disabled = value || groups.length >= catalog.formats.length;
  }
}
async function insertFiles(files, group) {
  const issues = [];
  let added = 0;
  const rows = allPhotos();
  const unique = new Set(rows.map((photo) => photo.asset));
  let totalBytes = Array.from(unique).reduce((sum, asset) => sum + asset.file.size, 0);
  const known = new Map();
  const fileKey = (file) => JSON.stringify([file.name, file.size]);
  const track = (asset) => {
    const key = fileKey(asset.file);
    if (!known.has(key)) known.set(key, []);
    known.get(key).push(asset);
  };
  for (const asset of unique) track(asset);
  let checked = 0;
  for (const file of files) {
    if (rows.length + added >= limits.maxItems) { issues.push('В заказе может быть до ' + limits.maxItems.toLocaleString('ru-RU') + ' снимков.'); break; }
    checked++;
    if (files.length > 30 && (checked === 1 || checked % 20 === 0)) feedback('Читаем фотографию ' + checked + ' из ' + files.length + '…');
    try {
      if (file.size > limits.maxFileBytes) throw Error('файл больше ' + (limits.maxFileBytes / MiB).toLocaleString('ru-RU') + ' МБ');
      let asset;
      for (const candidate of known.get(fileKey(file)) || []) {
        if (await sameFile(candidate.file, file)) { asset = candidate; break; }
      }
      if (!asset) {
        if (totalBytes + file.size > limits.maxOrderBytes) throw Error('превышен суммарный объём оригиналов ' + (limits.maxOrderBytes / 1e9).toLocaleString('ru-RU') + ' ГБ');
        asset = await readPrintAsset(file);
        totalBytes += file.size;
        track(asset);
      }
      group.photos.push({ asset, ...group.defaults });
      added++;
    } catch (error) {
      issues.push(file.name + ': ' + error.message + '.');
    }
  }
  const message = added ? 'Добавлено снимков: ' + added + '.' : '';
  feedback([message, ...issues.slice(0, 3), issues.length > 3 ? 'Другие отклонённые файлы: ' + (issues.length - 3) + '.' : ''].filter(Boolean).join(' '), issues.length ? 'error' : 'info');
}
async function sameFile(first, second) {
  if (first === second) return true;
  for (let offset = 0; offset < first.size; offset += MiB) {
    const buffers = await Promise.all([first, second].map((file) => file.slice(offset, offset + MiB).arrayBuffer()));
    const [a, b] = buffers.map((buffer) => new Uint8Array(buffer));
    if (!a.every((byte, i) => byte === b[i])) return false;
  }
  return true;
}
async function loadFiles(files) {
  if (busy || !active || !files.length) return;
  const group = active;
  setBusy(true);
  feedback('Читаем фотографии…');
  try {
    await insertFiles(files, group);
  } finally {
    setBusy(false);
    render();
  }
  if (workspace) await workspace.save();
}
async function loadSamples() {
  if (busy || !active) return;
  setBusy(true);
  feedback('Загружаем примеры…');
  try {
    const files = await Promise.all(samples.map(async ([path, name]) => {
      const response = await fetch(new URL('./assets/' + path, import.meta.url));
      if (!response.ok) throw Error('Не удалось загрузить примеры. Попробуйте ещё раз.');
      return new File([await response.blob()], name, { type: 'image/jpeg' });
    }));
    await insertFiles(files, active);
  } catch (error) { feedback(error.message, 'error'); }
  finally { setBusy(false); render(); }
}
async function request(action, init = {}) {
  if (endpoint.origin !== location.origin) throw Error('Адрес модуля должен находиться на домене магазина.');
  const url = new URL(endpoint);
  url.searchParams.set('action', action);
  if (action!=='config' && signedUserId) {
    init.headers={...init.headers,'X-Photoprint-User':String(signedUserId)};
  }
  let response;
  try { response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init }); }
  catch { throw Error('Не удалось связаться с магазином. Проверьте соединение и повторите попытку.'); }
  let body;
  try { body = await response.json(); }
  catch { throw Error('Магазин вернул неожиданный ответ. Повторите попытку позже.'); }
  if (!response.ok || body.error) {
    const error = Error(typeof body.error === 'string' ? body.error : 'Не удалось выполнить запрос к магазину.');
    error.code = body.code;
    error.missingAssetIds = body.missingAssetIds;
    error.missingPrintIds = body.missingPrintIds;
    throw error;
  }
  return body;
}
function renditionKey(group, photo) {
  return JSON.stringify([photo.asset.assetId, group.formatId, photo.fitId, photo.frameId, photo.crop || null, photo.edits || null, catalogVersion]);
}
async function preparedId(group, photo, requiredKeys) {
  const asset = photo.asset;
  asset.prints ??= new Map();
  const key = renditionKey(group, photo);
  if (asset.prints.has(key)) return asset.prints.get(key);
  const jpeg = await renderPrint(photo, formatOf(group), catalog);
  if (jpeg.size > limits.maxFileBytes) throw Error('Подготовленный отпечаток «' + asset.file.name + '» больше ' + (limits.maxFileBytes / MiB).toLocaleString('ru-RU') + ' МБ.');
  const form = new FormData();
  form.set('sessid', sessid);
  form.set('draftId', draftId);
  form.set('file', jpeg, 'print.jpg');
  form.set('assetId', asset.assetId);
  form.set('formatId', group.formatId);
  form.set('fitId', photo.fitId);
  form.set('frameId', photo.frameId);
  form.set('crop', JSON.stringify(photo.crop || null));
  form.set('edits', JSON.stringify(photo.edits || null));
  form.set('catalogVersion', catalogVersion);
  const replaceKey = Array.from(asset.prints.keys()).find((candidate) => !requiredKeys.has(candidate));
  if (replaceKey) form.set('replacePrintId', asset.prints.get(replaceKey));
  const data = await request('rendition', { method: 'POST', body: form });
  if (!data.printId) throw Error('Магазин не подтвердил загрузку отпечатка. Повторите попытку.');
  if (replaceKey) asset.prints.delete(replaceKey);
  asset.prints.set(key, data.printId);
  return data.printId;
}
async function goToCheckout(setProgress) {
  await workspace.save(true);
  draftId=workspace.draftId;
  const assets = Array.from(new Set(allPhotos().map((photo) => photo.asset)));
  draftId ??= id();
  const rows = groups.flatMap((group) => group.photos.map((photo) => ({ group, photo })));
  const keepPrints = new Set();
  for (const { group, photo } of rows) {
    const printId = photo.asset.prints?.get(renditionKey(group, photo));
    if (printId) keepPrints.add(printId);
  }
  setProgress('Проверяем состав загрузки…');
  await request('prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessid, draftId, assetIds: assets.map((asset) => asset.assetId).filter(Boolean), printIds: [...keepPrints] }) });
  for (const asset of assets) {
    for (const [key, printId] of asset.prints || []) if (!keepPrints.has(printId)) asset.prints.delete(key);
  }
  for (const [index, asset] of assets.entries()) {
    if (asset.assetId) continue;
    setProgress('Передаём фото ' + (index + 1) + ' из ' + assets.length + '…');
    const form = new FormData();
    form.set('sessid', sessid);
    form.set('draftId', draftId);
    form.set('file', asset.file, asset.file.name);
    const data = await request('upload', { method: 'POST', body: form });
    if (!data.assetId) throw Error('Магазин не подтвердил загрузку. Повторите попытку.');
    asset.assetId = data.assetId;
  }
  const requiredKeys = new Set(rows.map(({group, photo}) => renditionKey(group, photo)));
  const items = [];
  for (const [index, { group, photo }] of rows.entries()) {
    setProgress('Готовим отпечаток ' + (index + 1) + ' из ' + rows.length + '…');
    const printId = await preparedId(group, photo, requiredKeys);
    items.push({
      assetId: photo.asset.assetId, formatId: group.formatId, paperId: photo.paperId, fitId: photo.fitId,
      frameId: photo.frameId, extraIds: photo.extraIds || [], copies: photo.copies, crop: photo.crop || null, edits:photo.edits || null, printId
    });
  }
  setProgress('Добавляем печать в корзину…');
  const key = JSON.stringify({ centerId, items });
  if (key !== checkoutKey) { checkoutKey = key; checkoutRequest = id(); }
  const data = await request('basket', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessid, draftId, replaceJobId:workspace.jobId, editorPath:location.pathname, requestId: checkoutRequest, catalogVersion, renderVersion: 1, centerId, items, expectedTotal: groups.reduce((sum, group) => sum + subtotal(group), 0) / 100 })
  });
  if (!data.checkoutUrl) throw Error('Магазин не передал ссылку для оформления.');
  const url = new URL(data.checkoutUrl, location.href);
  if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) throw Error('Некорректная ссылка на оформление заказа.');
  location.assign(url.href);
}
function safeFile(name) {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 140) || 'photo';
}
async function buildDemoOrder(number, setProgress) {
  const center = byId('centers', centerId);
  const entries = [];
  const pathEncoder = new TextEncoder();
  const {demoUsage}=await import('./demo-account.js');
  const available=await demoUsage();
  let archiveBytes=0;
  const totalPhotos = allPhotos().length;
  let printBytes = 0;
  const spec = {
    orderNumber: number, centerId: center.id, center: center.label,
    totalCopies: groups.reduce((sum, group) => sum + countCopies(group), 0),
    total: groups.reduce((sum, group) => sum + subtotal(group), 0) / 100, photos: [],
    formats:groups.filter(g=>g.photos.length).map(g=>({formatId:g.formatId,label:formatOf(g).label,copies:countCopies(g),total:subtotal(g)/100}))
  };
  const runs = productionRuns(groups.flatMap(group => group.photos.map(photo => ({
    group, format: formatOf(group), photo, formatId: group.formatId, paperId: photo.paperId,
    frameId: photo.frameId, frameStyle: byId('frames', photo.frameId).preview || photo.frameId,
    fitId: photo.fitId, fitStyle: byId('fits', photo.fitId).preview || photo.fitId,
    frameEdits: photo.edits?.frame, extraIds: photo.extraIds
  }))));
  for (const {folder, rows} of runs) {
    for (const [index, {group, format, photo}] of rows.entries()) {
      const basename = safePrintBasename(photo.asset.file.name, Math.min(160, 200 - folder.length));
      const stem = String(index + 1).padStart(4, '0') + '_' + basename;
      const printPaths=Array.from({length:photo.copies},(_,i)=>folder+'/'+stem+'_копия_'+String(i+1).padStart(3,'0')+'.jpg');
      const printPath=printPaths[0];
      setProgress('Готовим отпечаток ' + (spec.photos.length + 1) + ' из ' + totalPhotos + '…');
      const jpeg = await renderPrint(photo, format, catalog);
      printBytes += jpeg.size;
      if (jpeg.size > 20 * MiB || printBytes > MAX_SOURCE_BYTES) {
        throw Error('Готовые отпечатки превышают лимит: 20 МБ на файл и 20 ГБ на заказ.');
      }
      archiveBytes += printPaths.reduce((bytes, path) => bytes + jpeg.size + 128 + 2 * pathEncoder.encode(path).length, 0);
      if (archiveBytes > available.limit - available.used) throw Error('Для архива со всеми печатными копиями недостаточно места в общем хранилище 20 ГБ.');
      const layout = layoutPrint(photo, format, catalog);
      const digest = crypto.subtle ? new Uint8Array(await crypto.subtle.digest('SHA-256', await jpeg.arrayBuffer())) : null;
      const line = {
        archiveFile: printPath, printArchiveFile: printPath, folder, crop: photo.crop || null,
        edits: photo.edits || null,
        cropReference: photo.edits?.angle || photo.edits?.mirrorX || photo.edits?.mirrorY ? 'transformed-original' : 'oriented-original',
        printWidth: layout.width, printHeight: layout.height, printSha256: digest ? Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('') : null,
        originalName: photo.asset.file.name, formatId: format.id, formatLabel: format.label,
        width: format.width, height: format.height, paperId: photo.paperId, paperLabel: byId('papers', photo.paperId).label,
        fitId: photo.fitId, fitLabel: byId('fits', photo.fitId).label, frameId: photo.frameId, frameLabel: byId('frames', photo.frameId).label,
        extraIds: photo.extraIds || [], extras: (photo.extraIds || []).map((key) => {
          const extra = byId('extras', key);
          return { ...extra, surcharge: surcharge(format, 'extras', extra) / 100 };
        }),
        copies: photo.copies, unitPrice: unitPrice(group, photo) / 100
      };
      for (const field of fields) {
        const key = field.key.replace(/Id$/, 'Surcharge');
        line[key] = surcharge(format, field.list, byId(field.list, photo[field.key])) / 100;
      }
      line.printArchiveFiles=printPaths;
      spec.photos.push(line);
      for(const path of printPaths)entries.push({path,blob:jpeg});
    }
  }
  setProgress('Упаковываем JPEG по папкам печати…');
  const blob = await makeZip(entries);
  return { spec, blob, filename: safeFile(center.id) + '_' + number + '.zip' };
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = el('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function finishDemoOrder(dialog, message, number) {
  if (await synchronizeDemo()) return;
  const { spec, blob, filename } = await buildDemoOrder(number, (progress) => { message.textContent = progress; });
  if (await synchronizeDemo()) return;
  let saved;
  try {
    const { saveDemoOrder } = await import('./demo-orders.js?v=2.1');
    saved = await saveDemoOrder(spec, blob);
    message.textContent = 'Демозаказ ' + number + ' сохранён. Архив доступен в разделе «Заказы» демоадминки этого браузера.';
  } catch {
    message.textContent = 'Не удалось сохранить заказ в этом браузере. Вы можете скачать готовый архив.';
  }
  dialog.dialog.dataset.orderComplete = 'true';
  dialog.actions.replaceChildren(button('Закрыть', 'button secondary', dialog.close));
  if (saved) {
    const orders = el('a', 'button secondary', 'Заказы в демоадминке');
    orders.href = new URL('./admin.html#orders', import.meta.url);
    orders.target = '_blank';
    orders.rel = 'noopener';
    dialog.actions.append(orders);
  }
  dialog.actions.append(button('Скачать ZIP заказа', 'button primary', () => downloadBlob(blob, saved?.filename || filename)));
}
async function review() {
  if (busy || !canCheckout()) return;
  try{await workspace.save(true);}catch(e){feedback(e.message,'error');return;}
  if (await synchronizeDemo() || openDialog?.open) return;
  const dialog = showDialog('Проверить заказ');
  const list = el('div', 'review-list');
  const rows = [];
  for (const group of groups.filter((entry) => entry.photos.length)) {
    const row = el('div', 'review-row');
    row.append(el('strong', '', formatOf(group).label), el('span', '', countCopies(group) + ' шт. · ' + money(subtotal(group))));
    list.append(row);
    for (const photo of group.photos) rows.push({ group, photo });
  }
  const reviewPhotos = el('div', 'review-list');
  const reviewNav = el('nav', 'photo-pagination');
  function reviewPage(page) {
    reviewPhotos.replaceChildren();
    for (const { group, photo } of rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
      const info = el('div', 'review-photo');
      const options = [formatOf(group).label, ...fields.map((field) => byId(field.list, photo[field.key]).label),
        ...(photo.extraIds || []).map((key) => byId('extras', key).label)].join(' · ');
      info.append(el('span', 'review-name', photo.asset.file.name), el('span', '', options + ' · ' + photo.copies + ' шт. × ' + money(unitPrice(group, photo))));
      reviewPhotos.append(info);
    }
    pageNavigation(reviewNav, rows.length, page, reviewPage);
  }
  reviewPage(0);
  list.append(reviewPhotos, reviewNav);
  const center = byId('centers', centerId);
  const total = groups.reduce((sum, group) => sum + subtotal(group), 0);
  const totalRow = el('div', 'review-row review-total');
  totalRow.append(el('strong', '', 'Итого'), el('strong', '', money(total)));
  dialog.content.append(list, el('p', '', 'Самовывоз: ' + center.label), totalRow);
  const message = el('p', 'review-note', endpoint
    ? 'Данные получателя и способ оплаты вы укажете при оформлении в магазине.'
    : 'Демозаказ появится в админке этого браузера. В ZIP каждый заказанный экземпляр будет отдельным JPEG в папке своего формата, бумаги, рамки и полей.');
  message.setAttribute('role', 'status');
  dialog.content.append(message);
  if (!endpoint) {
    const assets = new Set(rows.map(({ photo }) => photo.asset));
    const bytes = Array.from(assets).reduce((sum, asset) => sum + asset.file.size, 0);
    if (bytes > 500 * MiB || rows.length > 500) {
      dialog.content.append(el('p', 'review-note', 'Большой архив потребует свободного места на устройстве. Держите вкладку открытой, пока браузер готовит файлы.'));
    }
  }
  const number = 'DEMO-' + Date.now().toString(36).toUpperCase() + '-' + id().slice(0, 6).toUpperCase();
  const action = button(endpoint ? 'Перейти к оформлению' : 'Создать демозаказ', 'button primary', async () => {
    dialog.dialog.dataset.working = 'true';
    dialog.dialog.addEventListener('cancel', preventCancel);
    for (const control of dialog.dialog.querySelectorAll('button')) control.disabled = true;
    setBusy(true);
    try {
      if (endpoint) await goToCheckout((status) => { message.textContent = status; });
      else await finishDemoOrder(dialog, message, number);
    } catch (error) {
      message.textContent = error.name === 'QuotaExceededError' || error instanceof RangeError
        ? 'Браузеру не хватило места для подготовки архива. Освободите место или разделите заказ на части.' : error.message;
      if (['PRICE_CHANGED', 'CATALOG_CHANGED', 'SESSION_EXPIRED', 'ASSET_EXPIRED', 'PRINT_EXPIRED'].includes(error.code)) {
        try {
          if (error.code === 'ASSET_EXPIRED') {
            const expired = Array.isArray(error.missingAssetIds) ? new Set(error.missingAssetIds) : null;
            for (const asset of new Set(allPhotos().map((photo) => photo.asset))) {
              if (!expired || expired.has(asset.assetId)) {
                delete asset.assetId;
                asset.prints?.clear();
              }
            }
          } else if (error.code === 'PRINT_EXPIRED') {
            const expired = Array.isArray(error.missingPrintIds) ? new Set(error.missingPrintIds) : null;
            for (const { asset } of allPhotos()) {
              for (const [key, printId] of asset.prints || []) {
                if (!expired || expired.has(printId)) asset.prints.delete(key);
              }
            }
          }
          const changes = await refreshCatalog();
          dialog.close();
          const restored = ['PRICE_CHANGED', 'CATALOG_CHANGED'].includes(error.code)
            ? 'Магазин обновил параметры печати. Проверьте форматы, опции и сумму.'
            : 'Фотографии сохранены в этой вкладке. Проверьте заказ и повторите оформление.';
          feedback([restored, ...changes].join(' '), 'info');
        } catch (refreshError) { message.textContent = refreshError.message; }
      }
    }
    finally {
      delete dialog.dialog.dataset.working;
      dialog.dialog.removeEventListener('cancel', preventCancel);
      for (const control of dialog.dialog.querySelectorAll('button')) control.disabled = false;
      setBusy(false);
    }
  });
  dialog.actions.append(button('Вернуться', 'button secondary', dialog.close), action);
}
function preventCancel(event) { event.preventDefault(); }

function validCatalog(data) {
  const lists = ['formats', 'papers', 'fits', 'frames', 'centers'];
  if (!data || !lists.every((list) => Array.isArray(data[list]) && data[list].length)) return false;
  const extras = data.extras ?? [];
  if (!Array.isArray(extras) || extras.some((extra) => !extra.id || !extra.label || !Number.isFinite(Number(extra.surcharge)) || extra.surcharge < 0)) return false;
  return data.formats.every((fmt) =>
    fmt.width > 0 && fmt.height > 0 && Array.isArray(fmt.tiers) && fmt.tiers.some((tier) => tier.min === 1)
    && Array.isArray(fmt.extraIds ?? []) && (fmt.extraIds || []).every((key) => extras.some((extra) => extra.id === key))
    && fields.every((field) => Array.isArray(fmt[field.allowed]) && fmt[field.allowed].length
      && fmt[field.allowed].every((key) => data[field.list].some((opt) => opt.id === key))));
}
async function readCatalog() {
  let data;
  if (endpoint) {
    data = await request('config');
  } else {
    const { readDemoCatalog } = await import('./admin-catalog.js');
    const catalog = readDemoCatalog();
    const checked = validCatalog(catalog) ? catalog : demoCatalog;
    data = { catalog: checked, catalogVersion: JSON.stringify(checked) };
  }
  if (!validCatalog(data.catalog)) throw Error('Фотопечать пока недоступна. Проверьте настройки форматов и копицентров в магазине.');
  if (endpoint && !data.sessid) throw Error('Не удалось открыть сессию магазина. Обновите страницу.');
  return data;
}
async function refreshCatalog(data) {
  data ??= await readCatalog();
  const previous = catalog;
  catalog = data.catalog;
  applyLimits(data.limits);
  sessid = data.sessid;
  catalogVersion = data.catalogVersion;
  const changes = new Set();
  const refreshed = new Map();
  const priorActive = active;
  for (const group of groups) {
    let format = byId('formats', group.formatId);
    if (!format) {
      const old = previous.formats.find((entry) => entry.id === group.formatId);
      format = catalog.formats[0];
      changes.add('Вместо недоступного формата ' + old.label + ' выбран ' + format.label + '.');
    }
    const next = refreshed.get(format.id) || makeGroup(format);
    if (!refreshed.has(format.id)) next.defaults = settings(format, group.defaults);
    for (const photo of group.photos) {
      const updated = settings(format, photo);
      for (const field of fields) {
        if (updated[field.key] !== photo[field.key]) changes.add(field.label + ': выбран доступный вариант «' + byId(field.list, updated[field.key]).label + '».');
      }
      for (const key of photo.extraIds || []) {
        if (!updated.extraIds.includes(key)) {
          const label = previous.extras?.find((extra) => extra.id === key)?.label || key;
          changes.add('Услуга «' + label + '» больше недоступна для этого формата и исключена из расчёта.');
        }
      }
      changePhoto(photo, updated, format, previous.formats.find((entry) => entry.id === group.formatId), previous);
      next.photos.push(photo);
    }
    refreshed.set(format.id, next);
    if (group === priorActive) active = next;
  }
  groups = Array.from(refreshed.values());
  if (!byId('centers', centerId)) {
    centerId = catalog.centers[0].id;
    changes.add('Выбран доступный пункт выдачи «' + catalog.centers[0].label + '».');
  }
  setOptions($('center-select'), catalog.centers, centerId);
  render();
  return changes;
}
async function synchronizeDemo() {
  if (endpoint || !active) return false;
  const data = await readCatalog();
  if (catalogVersion === data.catalogVersion) return false;
  if (!openDialog?.dataset.orderComplete) openDialog?.close();
  const changes = await refreshCatalog(data);
  feedback(['Настройки демо обновились. Проверьте параметры, пункт выдачи и сумму заказа.', ...changes].join(' '));
  return true;
}

function bindControls() {
  $('file-input').accept = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';
  $('file-input').multiple = true;
  $('file-input').addEventListener('change', (event) => {
    const files = Array.from(event.target.files);
    event.target.value = '';
    workspace?.gate(()=>loadFiles(files));
  });
  root.addEventListener('click', (event) => {
    const control = event.target.closest('#upload-button, [data-action="upload"], #sample-button, [data-action="sample"]');
    if (!control || busy) return;
    if (control.matches('#sample-button, [data-action="sample"]')) workspace?.gate(loadSamples);
    else workspace?.gate(()=>$('file-input').click());
  });
  root.addEventListener('click', (event) => {
    if (busy && !event.target.closest('dialog')) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  $('add-format').addEventListener('click', addFormat);
  $('bulk-edit')?.addEventListener('click', () => editPhotos(active, active.photos, true));
  $('format-select').addEventListener('change', (event) => {
    const previousFormat = formatOf(active);
    const format = byId('formats', event.target.value);
    active.formatId = format.id;
    active.defaults = settings(format, active.defaults);
    for (const photo of active.photos) changePhoto(photo, settings(format, photo), format, previousFormat);
    render();
  });
  $('center-select').addEventListener('change', (event) => { centerId = event.target.value; workspace?.changed(); });
  $('copies-minus').addEventListener('click', () => updateDefaults('copies', Math.max(1, active.defaults.copies - 1)));
  $('copies-plus').addEventListener('click', () => updateDefaults('copies', Math.min(999, active.defaults.copies + 1)));
  const copies = $('copies-input');
  Object.assign(copies, { type: 'number', min: '1', max: '999', step: '1', required: true });
  copies.addEventListener('change', () => {
    if (!copies.checkValidity()) {
      copies.value = active.defaults.copies;
      feedback('Количество экземпляров — целое число от 1 до 999.', 'error');
      return;
    }
    updateDefaults('copies', Number(copies.value));
  });
  $('checkout-button').addEventListener('click', ()=>workspace?.gate(review));
  $('select-all-photos').addEventListener('change',e=>{
    for(const photo of active.photos)e.target.checked?selectedPhotos.add(photo):selectedPhotos.delete(photo);
    render();
  });
  const picked=()=>active.photos.filter(photo=>selectedPhotos.has(photo));
  $('selection-edit').onclick=()=>editPhotos(active,picked(),true);
  $('selection-store').onclick=()=>workspace?.capture(picked());
  $('selection-delete').onclick=()=>{
    const remove=picked();
    if(!remove.length||!confirm('Удалить выбранные фотографии из этого формата?'))return;
    active.photos=active.photos.filter(p=>!selectedPhotos.has(p));
    for(const p of remove){selectedPhotos.delete(p);releaseUnused(p.asset);}
    render();
  };
  $('view-mode').onclick=()=>{
    const list=$('photos').classList.toggle('list-mode');
    $('view-mode').setAttribute('aria-pressed',String(list));$('view-mode').textContent=list?'Плитка':'Список';
  };
  $('view-scale').oninput=e=>$('photos').style.setProperty('--photo-thumb-size',e.target.value+'px');
  const panel=root.querySelector('.workspace');
  $('view-fullscreen').onclick=()=>{
    const full=panel.classList.toggle('is-expanded');$('view-fullscreen').textContent=full?'Свернуть':'Во весь экран';
  };
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!openDialog&&panel.classList.contains('is-expanded'))$('view-fullscreen').click();});
  const fileDrag = (event) => event.dataTransfer.types.includes('Files');
  root.addEventListener('dragover', (event) => {
    if (!fileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
    if (!busy) $('empty-upload').classList.add('is-dragging');
  });
  root.addEventListener('dragleave', (event) => {
    if (!root.contains(event.relatedTarget)) $('empty-upload').classList.remove('is-dragging');
  });
  root.addEventListener('drop', (event) => {
    if (!fileDrag(event)) return;
    event.preventDefault();
    $('empty-upload').classList.remove('is-dragging');
    const files=Array.from(event.dataTransfer.files);
    if (!busy && !openDialog) workspace?.gate(()=>loadFiles(files));
  });
}
function draftSnapshot() {
  return {centerId,activeFormatId:active.formatId,groups:groups.map(group=>({
    formatId:group.formatId, defaults:group.defaults,
    photos:group.photos.map(photo=>({...settings(formatOf(group),photo),assetId:photo.asset.assetId,
      crop:photo.crop||null,edits:photo.edits||null}))
  }))};
}
function replaceRows(next,chosen,center){
  const old=new Set(allPhotos().map(p=>p.asset));
  groups=next;active=groups.find(g=>g.formatId===chosen)||groups[0];
  centerId=byId('centers',center)?center:catalog.centers[0].id;
  $('center-select').value=centerId;checkoutKey='';checkoutRequest=null;selectedPhotos.clear();
  for(const asset of old)URL.revokeObjectURL(asset.url);
  render();
}
function restoreRows(state,assets){
  const rebuilt=new Map();
  for(const saved of state.groups){
    const format=byId('formats',saved.formatId)||catalog.formats[0];
    const group=rebuilt.get(format.id)||makeGroup(format);
    group.defaults=settings(format,saved.defaults||{});
    for(const row of saved.photos){
      const asset=assets.get(row.assetId);
      if(!asset)throw Error('Исходник черновика не найден.');
      const photo={asset,...settings(format,row),crop:row.crop||null,edits:row.edits||null};
      constrainFrameEdits(photo,format,catalog);
      group.photos.push(photo);
    }
    rebuilt.set(format.id,group);
  }
  replaceRows(rebuilt.size?[...rebuilt.values()]:[makeGroup(catalog.formats[0])],state.activeFormatId,state.centerId);
}
async function addPhonePhoto(info,file){
  const existing=allPhotos().find(p=>p.asset.assetId===info.assetId);
  const format=byId('formats',info.formatId)||catalog.formats[0];
  let group=groups.find(g=>g.formatId===format.id);
  if(!group){group=makeGroup(format);groups.push(group);}
  if(allPhotos().length>=limits.maxItems)throw Error('Лимит фотографий в заказе исчерпан.');
  const asset=existing?.asset||await readPrintAsset(file);asset.assetId=info.assetId;
  group.photos.push({asset,...group.defaults});render();
}
async function initialize() {
  if (!root) return;
  setBusy(true);
  $('checkout-button').disabled = true;
  if (endpoint) {
    for (const item of root.querySelectorAll('.demo-only, #sample-button, [data-action="sample"]')) item.hidden = true;
    for (const item of root.querySelectorAll('[data-privacy]')) item.textContent = 'Оригиналы сохраняются в закрытом хранилище магазина. Черновик доступен 3 дня.';
  }
  try {
    const data = await readCatalog();
    catalog = data.catalog;
    applyLimits(data.limits);
    catalogVersion = data.catalogVersion;
    sessid = data.sessid;
    signedUserId = data.auth?.userId;
    active = makeGroup(catalog.formats[0]);
    groups = [active];
    centerId = catalog.centers[0].id;
    setOptions($('center-select'), catalog.centers, centerId);
    bindControls();
    workspace=await connectWorkspace({root,$,endpoint,sessid:()=>sessid,showDialog,feedback,
      snapshot:draftSnapshot,restore:restoreRows,reset:()=>replaceRows([makeGroup(catalog.formats[0])],catalog.formats[0].id,catalog.centers[0].id),
      rows:allPhotos,busy:()=>busy,activeFormat:()=>active.formatId,loadFiles,addRemote:addPhonePhoto,
      containsAsset:(id,fmt)=>groups.some(g=>g.formatId===(byId('formats',fmt)?.id||catalog.formats[0].id)&&g.photos.some(p=>p.asset.assetId===id))},data);
    if (!endpoint) {
      const checkDemoSettings = () => {
        if (!busy) synchronizeDemo().catch((error) => feedback(error.message, 'error'));
      };
      window.addEventListener('storage', (event) => {
        if (event.key === null || event.key === 'copycenter-demo-catalog-v1') checkDemoSettings();
      });
      window.addEventListener('pageshow', checkDemoSettings);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDemoSettings(); });
    }
    setBusy(false);
    render();
  } catch (error) {
    for (const control of root.querySelectorAll('button, input, select')) control.disabled = true;
    root.setAttribute('aria-busy', 'false');
    feedback(error.message, 'error');
  }
}
initialize();
