import { demoCatalog } from './catalog.js';
import { makeZip } from './zip.js';

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
const id = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  return Array.from(bytes, (b, i) => ([4, 6, 8, 10].includes(i) ? '-' : '') + b.toString(16).padStart(2, '0')).join('');
};
let catalog;
let catalogVersion;
let sessid;
let groups = [];
let active;
let centerId;
let busy = false;
let checkoutKey = '';
let checkoutRequest;
let openDialog;

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
function byId(list, key) { return catalog[list]?.find((entry) => entry.id === key); }
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
function countCopies(group) { return group.photos.reduce((sum, photo) => sum + photo.copies, 0); }
function surcharge(format, list, choice) {
  return Math.round(Number(format.surcharges?.[list]?.[choice.id] ?? choice.surcharge ?? 0) * 100);
}
function choiceLabel(format, list, choice) {
  const cost = surcharge(format, list, choice);
  return cost ? choice.label + ' (+' + money(cost) + ')' : choice.label;
}
function unitPrice(group, photo) {
  const format = formatOf(group);
  const qty = Math.max(1, countCopies(group));
  const tiers = format.tiers.filter((tier) => tier.min <= qty);
  const tier = tiers.reduce((highest, current) => current.min > highest.min ? current : highest);
  const options = fields.reduce((sum, field) => sum + surcharge(format, field.list, byId(field.list, photo[field.key])), 0);
  const extras = (photo.extraIds || []).reduce((sum, key) => sum + surcharge(format, 'extras', byId('extras', key)), 0);
  return Math.round(tier.price * 100) + options + extras;
}
function subtotal(group) {
  return group.photos.reduce((sum, photo) => sum + unitPrice(group, photo) * photo.copies, 0);
}
function needsQuote(group) {
  const limit = formatOf(group).quoteLimit;
  return limit && countCopies(group) > limit;
}
function canCheckout() {
  return allPhotos().length > 0 && !groups.some(needsQuote);
}
function allPhotos() { return groups.flatMap((group) => group.photos); }
function setOptions(select, options, value) {
  select.replaceChildren(...options.map((entry) => new Option(entry.label, entry.id)));
  select.value = value;
}
function updateDefaults(key, value) {
  active.defaults[key] = value;
  for (const photo of active.photos) photo[key] = value;
  render();
}
function bindOptionFields(container, format, values, onChange, buttonPaper) {
  container.replaceChildren();
  for (const field of fields) {
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

function preview(photo, format, css) {
  const frame = el('div', css);
  const picture = el('div', 'print-sheet');
  const formatRatio = format.width / format.height;
  const landscape = photo.asset.width >= photo.asset.height;
  const ratio = landscape ? Math.max(formatRatio, 1 / formatRatio) : Math.min(formatRatio, 1 / formatRatio);
  picture.style.aspectRatio = String(ratio);
  picture.style.width = 'min(100cqw, ' + (100 * ratio) + 'cqh)';
  picture.style.height = 'min(100cqh, ' + (100 / ratio) + 'cqw)';
  const frameStyle = byId('frames', photo.frameId).preview || photo.frameId;
  const fitStyle = byId('fits', photo.fitId).preview || photo.fitId;
  picture.dataset.frame = frameStyle;
  picture.style.background = 'white';
  picture.style.padding = frameStyle === 'white' ? '4%' : '0';
  const img = el('img');
  img.src = photo.asset.url;
  img.alt = photo.asset.file.name;
  img.style.cssText = 'width:100%;height:100%;display:block;';
  img.style.objectFit = fitStyle === 'contain' ? 'contain' : 'cover';
  picture.append(img);
  frame.append(picture);
  return frame;
}
function releaseUnused(asset) {
  if (!allPhotos().some((photo) => photo.asset === asset)) URL.revokeObjectURL(asset.url);
}
function removeGroup(group) {
  const remove = () => {
    groups = groups.filter((item) => item !== group);
    if (active === group) active = groups[0];
    group.photos.forEach((photo) => releaseUnused(photo.asset));
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
  controls.append(iconButton('Настроить ' + photo.asset.file.name, 'edit', () => editPhoto(group, photo)),
    iconButton('Удалить ' + photo.asset.file.name, 'trash', () => {
      group.photos = group.photos.filter((item) => item !== photo);
      releaseUnused(photo.asset);
      feedback('Удалено: ' + photo.asset.file.name);
      render();
    }));
  card.append(preview(photo, format, 'photo-preview'), meta, controls);
  return card;
}
function render() {
  const focusKey = document.activeElement?.dataset.focusKey;
  renderTabs();
  setOptions($('format-select'), catalog.formats, active.formatId);
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
  $('photos').replaceChildren(...active.photos.map((photo) => renderPhoto(active, photo)));
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
  note.hidden = !quotation;
  note.textContent = quotation ? 'Для такого тиража ' + formatOf(quotation).label + ' стоимость рассчитает менеджер копицентра.' : '';
  if (focusKey) Array.from(root.querySelectorAll('[data-focus-key]')).find((node) => node.dataset.focusKey === focusKey)?.focus({ preventScroll: true });
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
function editPhoto(group, photo) {
  const dialog = showDialog('Настройки снимка');
  const draft = { ...photo };
  const format = formatOf(group);
  let image = preview(draft, format, 'edit-preview');
  const controls = el('div', 'edit-options');
  bindOptionFields(controls, format, draft, (key, value) => {
    draft[key] = value;
    const next = preview(draft, format, 'edit-preview');
    image.replaceWith(next);
    image = next;
  }, false);
  bindExtras(controls, format, [draft], (key, selected) => toggleExtra(draft, key, selected), false);
  const label = el('label', 'dialog-field', 'Количество экземпляров');
  const copies = el('input', 'option-select');
  Object.assign(copies, { type: 'number', min: '1', max: '999', step: '1', required: true, value: String(photo.copies) });
  label.append(copies);
  dialog.content.append(image, el('p', 'edit-filename', photo.asset.file.name), controls, label);
  dialog.actions.append(button('Отмена', 'button secondary', dialog.close), button('Сохранить', 'button primary', () => {
    if (!copies.reportValidity()) return;
    Object.assign(photo, draft, { copies: Number(copies.value) });
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
  if (active.photos.length && allPhotos().length + active.photos.length <= 100) {
    const copyLabel = el('label', 'dialog-check');
    copyLabel.append(duplicate, document.createTextNode(' Добавить снимки из формата ' + formatOf(active).label));
    dialog.content.append(copyLabel);
  }
  dialog.actions.append(button('Отмена', 'button secondary', dialog.close), button('Добавить', 'button primary', () => {
    const format = byId('formats', select.value);
    const group = makeGroup(format);
    if (duplicate.checked) group.photos = active.photos.map((source) => ({ asset: source.asset, ...settings(format, source) }));
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
function supportedImage(bytes) {
  return (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    || [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)
    || (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP');
}
async function readAsset(file) {
  if (file.size > 20 * MiB) throw Error('файл больше 20 МБ');
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!supportedImage(header)) throw Error('нужен файл JPG, PNG или WebP');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch { throw Error('не удалось прочитать изображение'); }
    if (img.naturalWidth * img.naturalHeight > 80000000) throw Error('разрешение превышает 80 Мп');
    const extension = header[0] === 0xff ? 'jpg' : header[0] === 137 ? 'png' : 'webp';
    return { file, url, extension, width: img.naturalWidth, height: img.naturalHeight };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}
async function insertFiles(files, group) {
  const issues = [];
  let added = 0;
  const unique = new Set(allPhotos().map((photo) => photo.asset));
  let totalBytes = Array.from(unique).reduce((sum, asset) => sum + asset.file.size, 0);
  for (const file of files) {
    if (allPhotos().length >= 100) { issues.push('В заказе может быть до 100 снимков.'); break; }
    if (totalBytes + file.size > 500 * MiB) { issues.push(file.name + ': превышен общий объём заказа 500 МБ.'); continue; }
    try {
      const asset = await readAsset(file);
      group.photos.push({ asset, ...group.defaults });
      totalBytes += file.size;
      added++;
    } catch (error) {
      issues.push(file.name + ': ' + error.message + '.');
    }
  }
  const message = added ? 'Добавлено снимков: ' + added + '.' : '';
  feedback([message, ...issues.slice(0, 3), issues.length > 3 ? 'Другие отклонённые файлы: ' + (issues.length - 3) + '.' : ''].filter(Boolean).join(' '), issues.length ? 'error' : 'info');
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
    throw error;
  }
  return body;
}
async function goToCheckout(setProgress) {
  const assets = Array.from(new Set(allPhotos().map((photo) => photo.asset)));
  for (const [index, asset] of assets.entries()) {
    if (asset.assetId) continue;
    setProgress('Передаём фото ' + (index + 1) + ' из ' + assets.length + '…');
    const form = new FormData();
    form.set('sessid', sessid);
    form.set('file', asset.file, asset.file.name);
    const data = await request('upload', { method: 'POST', body: form });
    if (!data.assetId) throw Error('Магазин не подтвердил загрузку. Повторите попытку.');
    asset.assetId = data.assetId;
  }
  setProgress('Добавляем печать в корзину…');
  const items = groups.flatMap((group) => group.photos.map(({ asset, paperId, fitId, frameId, extraIds, copies }) => ({
    assetId: asset.assetId, formatId: group.formatId, paperId, fitId, frameId, extraIds: extraIds || [], copies
  })));
  const key = JSON.stringify({ centerId, items });
  if (key !== checkoutKey) { checkoutKey = key; checkoutRequest = id(); }
  const data = await request('basket', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessid, requestId: checkoutRequest, catalogVersion, centerId, items, expectedTotal: groups.reduce((sum, group) => sum + subtotal(group), 0) / 100 })
  });
  if (!data.checkoutUrl) throw Error('Магазин не передал ссылку для оформления.');
  const url = new URL(data.checkoutUrl, location.href);
  if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) throw Error('Некорректная ссылка на оформление заказа.');
  location.assign(url.href);
}
function safeFile(name) {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 140) || 'photo';
}
async function downloadOrder(number) {
  const center = byId('centers', centerId);
  const entries = [];
  const spec = {
    orderNumber: number, centerId: center.id, center: center.label,
    totalCopies: groups.reduce((sum, group) => sum + countCopies(group), 0),
    total: groups.reduce((sum, group) => sum + subtotal(group), 0) / 100, photos: []
  };
  for (const group of groups) {
    const format = formatOf(group);
    const printRuns = new Map();
    for (const photo of group.photos) {
      const code = [format.id, photo.paperId, photo.fitId, photo.frameId, ...(photo.extraIds || [])].map(safeFile).join('_');
      if (!printRuns.has(code)) printRuns.set(code, []);
      printRuns.get(code).push(photo);
    }
    for (const [code, photos] of printRuns) {
      const quantity = photos.reduce((n, photo) => n + photo.copies, 0);
      const folder = code + '_' + quantity;
      for (const [index, photo] of photos.entries()) {
        const basename = safeFile(photo.asset.file.name.replace(/\.[^.]+$/, ''));
        const path = folder + '/' + String(index + 1).padStart(4, '0') + '_' + photo.copies + 'x_' + basename + '.' + photo.asset.extension;
        const line = {
          archiveFile: path, originalName: photo.asset.file.name, formatId: format.id, formatLabel: format.label,
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
        spec.photos.push(line);
        entries.push({ path, blob: photo.asset.file });
      }
    }
  }
  entries.push({ path: 'specification.json', blob: new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' }) });
  const blob = await makeZip(entries);
  const url = URL.createObjectURL(blob);
  const link = el('a');
  link.href = url;
  link.download = safeFile(center.id) + '_' + number + '.zip';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function review() {
  if (busy || !canCheckout()) return;
  if (await synchronizeDemo() || openDialog?.open) return;
  const dialog = showDialog('Проверить заказ');
  const list = el('div', 'review-list');
  for (const group of groups.filter((entry) => entry.photos.length)) {
    const row = el('div', 'review-row');
    row.append(el('strong', '', formatOf(group).label), el('span', '', countCopies(group) + ' шт. · ' + money(subtotal(group))));
    list.append(row);
    for (const photo of group.photos) {
      const info = el('div', 'review-photo');
      const options = [...fields.map((field) => byId(field.list, photo[field.key]).label),
        ...(photo.extraIds || []).map((key) => byId('extras', key).label)].join(' · ');
      info.append(el('span', 'review-name', photo.asset.file.name), el('span', '', options + ' · ' + photo.copies + ' шт. × ' + money(unitPrice(group, photo))));
      list.append(info);
    }
  }
  const center = byId('centers', centerId);
  const total = groups.reduce((sum, group) => sum + subtotal(group), 0);
  const totalRow = el('div', 'review-row review-total');
  totalRow.append(el('strong', '', 'Итого'), el('strong', '', money(total)));
  dialog.content.append(list, el('p', '', 'Самовывоз: ' + center.label), totalRow);
  const message = el('p', 'review-note', endpoint
    ? 'Данные получателя и способ оплаты вы укажете при оформлении в магазине.'
    : 'Это демонстрационный заказ. Скачайте архив с оригиналами и спецификацией печати. Оплата не требуется.');
  message.setAttribute('role', 'status');
  dialog.content.append(message);
  const number = 'DEMO-' + id().slice(0, 8).toUpperCase();
  const action = button(endpoint ? 'Перейти к оформлению' : 'Скачать ZIP заказа', 'button primary', async () => {
    dialog.dialog.dataset.working = 'true';
    dialog.dialog.addEventListener('cancel', preventCancel);
    for (const control of dialog.dialog.querySelectorAll('button')) control.disabled = true;
    setBusy(true);
    try {
      if (endpoint) await goToCheckout((status) => { message.textContent = status; });
      else if (!await synchronizeDemo()) {
        message.textContent = 'Готовим архив…';
        await downloadOrder(number);
        message.textContent = 'Архив готов. Скачивание началось.';
      }
    } catch (error) {
      message.textContent = error.message;
      if (['PRICE_CHANGED', 'CATALOG_CHANGED', 'SESSION_EXPIRED', 'ASSET_EXPIRED'].includes(error.code)) {
        try {
          if (error.code === 'ASSET_EXPIRED') {
            const expired = Array.isArray(error.missingAssetIds) ? new Set(error.missingAssetIds) : null;
            for (const { asset } of allPhotos()) {
              if (!expired || expired.has(asset.assetId)) delete asset.assetId;
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
      Object.assign(photo, updated);
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
  openDialog?.close();
  const changes = await refreshCatalog(data);
  feedback(['Настройки демо обновились. Проверьте параметры, пункт выдачи и сумму заказа.', ...changes].join(' '));
  return true;
}

function bindControls() {
  $('file-input').accept = 'image/jpeg,image/png,image/webp';
  $('file-input').multiple = true;
  $('file-input').addEventListener('change', (event) => {
    const files = Array.from(event.target.files);
    event.target.value = '';
    loadFiles(files);
  });
  root.addEventListener('click', (event) => {
    const control = event.target.closest('#upload-button, [data-action="upload"], #sample-button, [data-action="sample"]');
    if (!control || busy) return;
    if (control.matches('#sample-button, [data-action="sample"]')) loadSamples();
    else $('file-input').click();
  });
  root.addEventListener('click', (event) => {
    if (busy && !event.target.closest('dialog')) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  $('add-format').addEventListener('click', addFormat);
  $('format-select').addEventListener('change', (event) => {
    const format = byId('formats', event.target.value);
    active.formatId = format.id;
    active.defaults = settings(format, active.defaults);
    for (const photo of active.photos) Object.assign(photo, settings(format, photo));
    render();
  });
  $('center-select').addEventListener('change', (event) => { centerId = event.target.value; });
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
  $('checkout-button').addEventListener('click', review);
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
    if (!busy && !openDialog) loadFiles(Array.from(event.dataTransfer.files));
  });
}
async function initialize() {
  if (!root) return;
  setBusy(true);
  $('checkout-button').disabled = true;
  if (endpoint) {
    for (const item of root.querySelectorAll('.demo-only, #sample-button, [data-action="sample"]')) item.hidden = true;
    for (const item of root.querySelectorAll('[data-privacy]')) item.textContent = 'Оригиналы передаются в защищённое хранилище магазина при оформлении заказа.';
  }
  try {
    const data = await readCatalog();
    catalog = data.catalog;
    catalogVersion = data.catalogVersion;
    sessid = data.sessid;
    active = makeGroup(catalog.formats[0]);
    groups = [active];
    centerId = catalog.centers[0].id;
    setOptions($('center-select'), catalog.centers, centerId);
    bindControls();
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
