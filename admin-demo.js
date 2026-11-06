import { demoCatalog } from './catalog.js';
import { assignment, sectionLabels, DEMO_CATALOG_KEY, readDemoCatalog, saveDemoCatalog } from './admin-catalog.js';

const $ = selector => document.querySelector(selector);
const dialog = $('#admin-dialog');
const fields = $('#edit-fields');
const rub = value => new Intl.NumberFormat('ru-RU', {maximumFractionDigits:2}).format(value) + ' ₽';
const clone = value => structuredClone(value);
const titles = {formats:'Форматы печати', options:'Опции печати', centers:'Пункты выдачи'};
const addLabels = {formats:'Добавить формат',options:'Добавить опцию',centers:'Добавить пункт'};
const descriptions = {
  formats:'Размер отпечатка, доступные опции и цена за тираж.',
  options:'Общие доплаты за отпечаток. Для отдельных форматов можно задать свою цену.',
  centers:'Эти пункты доступны при оформлении демонстрационного заказа.'
};
let catalog = readDemoCatalog();
let page = 'formats';
let optionSection = 'papers';
let session = null;

function node(tag, text, className) {
  const result = document.createElement(tag);
  if (text != null) result.textContent = text;
  if (className) result.className = className;
  return result;
}
function button(text, className, handler) {
  const control = node('button', text, className);
  control.type = 'button';
  control.addEventListener('click', handler);
  return control;
}
function activeKey() { return page === 'options' ? optionSection : page; }

function render() {
  const nav = $('#admin-nav');
  nav.replaceChildren();
  for (const [key, label] of Object.entries(titles)) {
    const control = button(label, '', () => { page = key; $('#admin-status').textContent = ''; render(); });
    if (page === key) control.setAttribute('aria-current', 'page');
    const count = key === 'options' ? Object.keys(assignment).reduce((sum, section) => sum + catalog[section].length, 0) : catalog[key].length;
    control.append(node('span', String(count), 'nav-count'));
    nav.append(control);
  }
  $('#list-title').textContent = titles[page];
  $('#list-desc').textContent = descriptions[page];
  $('#add-entry').textContent = '+ ' + addLabels[page];
  const categories = $('#category-picker');
  categories.replaceChildren();
  if (page === 'options') {
    for (const [key, label] of Object.entries(sectionLabels)) {
      const filter = button(label, 'cat-button', () => { optionSection = key; render(); });
      filter.setAttribute('aria-pressed', String(key === optionSection));
      categories.append(filter);
    }
  }
  const entries = $('#entries');
  entries.replaceChildren();
  const header = node('div', null, 'adm-rowhead');
  [page === 'formats' ? 'Формат' : 'Название', page === 'formats' ? 'Цена за отпечаток' : (page === 'options' ? 'Общая доплата' : 'Код филиала'), 'Действия'].forEach(label => header.append(node('span',label)));
  entries.append(header);
  for (const item of catalog[activeKey()]) {
    const row = node('div', null, 'adm-row');
    const title = node('div');
    title.append(node('strong', item.label));
    if (page !== 'centers') title.append(node('span', item.id, 'adm-code'));
    const price = node('div');
    if (page === 'formats') {
      const prices = item.tiers.map(tier => tier.price);
      price.append(node('strong', Math.min(...prices) === Math.max(...prices) ? rub(prices[0]) : rub(Math.min(...prices)) + ' – ' + rub(Math.max(...prices))));
      price.append(node('span', 'Ценовых порогов: ' + item.tiers.length, 'adm-code'));
    } else {
      price.append(node('strong', page === 'options' ? rub(item.surcharge) : item.id));
    }
    const actions = node('div', null, 'adm-actions');
    const edit = button('Изменить', 'adm-link', () => openEditor('edit', item));
    edit.setAttribute('aria-label', 'Изменить ' + item.label);
    const remove = button('×', 'adm-icon', () => openEditor('delete', item));
    remove.setAttribute('aria-label', 'Удалить ' + item.label);
    actions.append(edit, remove);
    row.append(title, price, actions);
    entries.append(row);
  }
  if (!catalog[activeKey()].length) entries.append(node('p','В этом разделе пока нет опций.','empty-entries'));
}

function initialItem(key) {
  if (key === 'formats') return {
    id:'', label:'', width:10, height:15, tiers:[{min:1,price:30}],
    paperIds:catalog.papers.map(item=>item.id), fitIds:catalog.fits.map(item=>item.id),
    frameIds:catalog.frames.map(item=>item.id), extraIds:[], surcharges:{}
  };
  if (key === 'centers') return {id:'',label:''};
  return {id:'',label:'',surcharge:0, ...(key === 'frames' ? {preview:'none'} : (key === 'fits' ? {preview:'cover'} : {}))};
}

function field(target, item, key, title, type = 'text', options = {}) {
  const wrapper = node('label', title, 'edit-field');
  const input = node('input');
  input.type = type;
  input.required = !options.optional;
  input.value = item[key] ?? '';
  if (options.min != null) input.min = options.min;
  if (options.max != null) input.max = options.max;
  if (type === 'number') input.step = options.integer ? '1' : '0.01';
  if (key === 'id') { input.pattern = '[A-Za-z0-9][A-Za-z0-9\\-]{0,31}'; input.maxLength = 32; }
  if (key === 'label') input.maxLength = 100;
  input.addEventListener('input', () => {
    if (type === 'number') {
      if (input.value === '' && options.optional) delete item[key];
      else item[key] = input.value === '' ? null : Number(input.value);
    } else item[key] = input.value;
  });
  wrapper.append(input);
  target.append(wrapper);
}

function optionFields(format, key) {
  const set = node('fieldset');
  set.append(node('legend', sectionLabels[key]));
  for (const option of catalog[key]) {
    const row = node('div', null, 'option-row');
    const label = node('label');
    const check = node('input');
    check.type = 'checkbox';
    const ids = format[assignment[key]];
    check.checked = ids.includes(option.id);
    label.append(check, option.label);
    const amount = node('input');
    amount.type = 'number'; amount.min = 0; amount.max = 100000; amount.step = '0.01';
    amount.disabled = !check.checked;
    amount.placeholder = rub(option.surcharge);
    amount.setAttribute('aria-label', 'Доплата за ' + option.label);
    amount.value = format.surcharges?.[key]?.[option.id] ?? '';
    amount.addEventListener('input', () => {
      format.surcharges ??= {};
      format.surcharges[key] ??= {};
      if (amount.value === '') delete format.surcharges[key][option.id];
      else format.surcharges[key][option.id] = Number(amount.value);
    });
    check.addEventListener('change', () => {
      if (check.checked) ids.push(option.id);
      else {
        ids.splice(ids.indexOf(option.id), 1);
        if (format.surcharges?.[key]) delete format.surcharges[key][option.id];
        amount.value = '';
      }
      amount.disabled = !check.checked;
    });
    row.append(label,amount);
    set.append(row);
  }
  if (!catalog[key].length) set.append(node('p','Добавьте услугу в разделе «Опции печати».','hint'));
  return set;
}

function populateForm() {
  fields.replaceChildren();
  const item = session.item;
  if (session.action === 'delete') {
    fields.append(node('p','Удалить «' + item.label + '» из демонстрационного каталога?'));
    return;
  }
  if (session.action === 'reset') {
    fields.append(node('p','Сохранённые в этом браузере форматы, опции и цены будут заменены исходными демоданными.'));
    return;
  }
  const general = node('div', null, 'edit-grid');
  field(general, item, 'label', 'Название');
  field(general, item, 'id', 'Код');
  fields.append(general);
  if (session.key === 'formats') {
    const dims = node('div', null, 'edit-grid');
    field(dims,item,'width','Ширина, см','number',{min:0.1,max:500});
    field(dims,item,'height','Высота, см','number',{min:0.1,max:500});
    field(dims,item,'quoteLimit','Максимальный тираж онлайн','number',{min:1,max:100000,optional:true,integer:true});
    fields.append(dims, node('h3','Цена за тираж'));
    const tiers = node('div');
    function showTiers() {
      tiers.replaceChildren();
      item.tiers.forEach((tier,index) => {
        const row = node('div',null,'tier-row');
        field(row,tier,'min','От, шт.','number',{min:1,max:100000,integer:true});
        field(row,tier,'price','Цена за отпечаток, ₽','number',{min:0.01,max:100000});
        const remove = button('×','adm-icon',()=>{item.tiers.splice(index,1);showTiers();});
        remove.setAttribute('aria-label','Удалить порог ' + (index+1));
        row.append(remove); tiers.append(row);
      });
      tiers.append(button('+ Добавить порог','adm-btn secondary',()=>{
        const last = Math.max(0,...item.tiers.map(tier=>tier.min || 0));
        item.tiers.push({min:last+1,price:item.tiers.at(-1)?.price ?? 30}); showTiers();
      }));
    }
    showTiers();
    fields.append(tiers,node('h3','Опции и доплаты'),node('p','Включите доступные варианты. Поле справа задаёт доплату за отпечаток именно для этого формата. Пустое поле использует общую цену опции.','hint'));
    Object.keys(assignment).forEach(key => fields.append(optionFields(item,key)));
  } else if (session.key !== 'centers') {
    field(fields,item,'surcharge','Общая доплата за отпечаток, ₽','number',{min:0,max:100000});
    if (session.key === 'fits' || session.key === 'frames') {
      const wrapper = node('label','Вид предпросмотра','edit-field');
      const select = node('select');
      const variants = session.key === 'fits' ? {cover:'Заполнить отпечаток',contain:'Показать весь кадр'} : {none:'Без рамки',white:'Белая рамка'};
      Object.entries(variants).forEach(([id,label])=>select.add(new Option(label,id)));
      item.preview ??= Object.hasOwn(variants,item.id) ? item.id : select.value;
      select.value = item.preview;
      select.addEventListener('change',()=>{item.preview=select.value;});
      wrapper.append(select); fields.append(wrapper);
    }
  }
}

function openEditor(action, existing) {
  const key = activeKey();
  session = {action,key,originalId:existing?.id,item:existing ? clone(existing) : initialItem(key),source:JSON.stringify(catalog)};
  const title = {new:addLabels[page], edit:'Изменить ' + (page==='formats'?'формат':page==='options'?'опцию':'пункт'), delete:'Удалить запись',reset:'Восстановить демоданные'};
  $('#dialog-title').textContent = title[action];
  $('#save-entry').textContent = action === 'delete' ? 'Удалить' : (action==='reset' ? 'Восстановить' : 'Сохранить');
  $('#edit-error').textContent = '';
  populateForm();
  dialog.showModal();
  fields.querySelector('input')?.focus();
}

function applyChange(next) {
  const {action,key,item,originalId} = session;
  if (action === 'reset') return clone(demoCatalog);
  const index = next[key].findIndex(row=>row.id===originalId);
  if (action === 'delete') next[key].splice(index,1);
  else {
    item.label = item.label.trim();
    if (key === 'formats') item.tiers.sort((a,b)=>a.min-b.min);
    if (action === 'new') next[key].push(item);
    else next[key][index] = item;
  }
  if (Object.hasOwn(assignment,key) && originalId && (action==='delete' || originalId!==item.id)) {
    const prop = assignment[key];
    for (const format of next.formats) {
      format[prop] = action==='delete' ? format[prop].filter(id=>id!==originalId) : format[prop].map(id=>id===originalId?item.id:id);
      const rates = format.surcharges?.[key];
      if (rates && Object.hasOwn(rates,originalId)) {
        if (action!=='delete') rates[item.id] = rates[originalId];
        delete rates[originalId];
      }
    }
  }
  return next;
}

$('#entry-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    if (JSON.stringify(readDemoCatalog()) !== session.source) throw new Error('Каталог изменился в другой вкладке. Закройте форму и откройте её снова.');
    const next = applyChange(clone(catalog));
    saveDemoCatalog(next);
    catalog = next;
    dialog.close();
    render();
    $('#admin-status').textContent = session.action === 'reset' ? 'Исходные демоданные восстановлены.' : 'Каталог сохранён. Изменения доступны в конструкторе.';
  } catch (error) {
    $('#edit-error').textContent = error instanceof DOMException ? 'Браузер не разрешил сохранить каталог. Проверьте настройки хранилища.' : error.message;
  }
});
$('#add-entry').addEventListener('click',()=>openEditor('new'));
$('#reset-catalog').addEventListener('click',()=>openEditor('reset'));
$('#cancel-edit').addEventListener('click',()=>dialog.close());
$('#close-edit').addEventListener('click',()=>dialog.close());
window.addEventListener('storage', event => {
  if (event.key !== DEMO_CATALOG_KEY && event.key !== null) return;
  catalog = readDemoCatalog();
  render();
  $('#admin-status').textContent = 'Показаны настройки, сохранённые в другой вкладке.';
});
render();

