const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const integer = (value, label, min = 1, max = 10000) => {
  if (!/^\d+$/.test(String(value)) || Number(value) < min || Number(value) > max) throw new Error(label + ': укажите целое число от ' + min + ' до ' + max + '.');
  return Number(value);
};
export function rublesToKopecks(value) {
  const text = String(value).trim().replace(',', '.');
  if (!text) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('Цена: укажите рубли и не более двух знаков после запятой.');
  const [rubles, fraction = ''] = text.split('.');
  const kopecks = Number(rubles) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(kopecks) || kopecks < 2 || kopecks > 10000000) throw new Error('Цена должна быть от 0,02 ₽ до 100 000 ₽.');
  return kopecks;
}
export function validateDocumentAdminConfig(config) {
  if (!config.heading.trim() || config.heading.length > 180) throw new Error('Укажите заголовок длиной до 180 символов.');
  if (config.helpItems.length !== 3 || config.helpItems.some(text => !text.trim() || text.length > 500)) throw new Error('Заполните три пункта инструкции, каждый до 500 символов.');
  if (!config.formats.length || config.formats.length > 40) throw new Error('Добавьте от 1 до 40 форматов.');
  if (config.sheetWidthMm > config.sheetHeightMm) throw new Error('Укажите вертикальный печатный лист.');
  const ids = new Set();
  for (const format of config.formats) {
    if (!/^doc-[a-z0-9][a-z0-9-]{0,27}$/.test(format.id) || format.id.length > 32 || ids.has(format.id)) throw new Error('Код формата должен быть уникальным и начинаться с doc-.');
    ids.add(format.id);
    if (!format.label.trim() || format.label.length > 100) throw new Error('Укажите название каждого формата длиной до 100 символов.');
    const width = format.columns * format.widthMm + (format.columns - 1) * config.gapMm + 2 * config.marginMm;
    const height = format.rows * format.heightMm + (format.rows - 1) * config.gapMm + 2 * config.marginMm;
    if (format.count > format.columns * format.rows || width > config.sheetWidthMm || height > config.sheetHeightMm) throw new Error(format.label + ': комплект не помещается на лист. Проверьте размеры, поля, интервалы, ряды и колонки.');
    if (!(format.guides.top < format.guides.eyes && format.guides.eyes < format.guides.chin)) throw new Error(format.label + ': линия глаз должна находиться между макушкой и подбородком.');
  }
  return config;
}

export function mountDocumentConfigEditor(container, source) {
  const config = structuredClone(source);
  const field = (key, label, value, {type = 'number', min = 1, max = 1000, readonly = false} = {}) => `<label>${escapeHTML(label)}<input data-key="${key}" type="${type}" ${type === 'number' ? `min="${min}" max="${max}" step="1"` : ''} ${readonly ? 'readonly' : ''} value="${escapeHTML(value)}"></label>`;
  container.innerHTML = `
    <fieldset><legend>Онлайн-заказ</legend>
      <label class="doc-config-check"><input data-config="enabled" type="checkbox" ${config.enabled ? 'checked' : ''}> Включить загрузчик фото на документы</label>
      <p>Включайте после настройки магазина и проверки тестового комплекта. Лабораторная фотопечать работает отдельно.</p>
      <label>Заголовок карточки на странице услуги<input data-config="heading" type="text" maxlength="180" value="${escapeHTML(config.heading)}" required></label>
      <div class="doc-config-help">${Array.from({length:3}, (_, i) => `<label>Пункт инструкции ${i + 1}<textarea data-help="${i}" maxlength="500" rows="2" required>${escapeHTML(config.helpItems?.[i])}</textarea></label>`).join('')}</div>
      <p>Только обычный текст. Изменения появятся при следующем открытии страницы.</p>
    </fieldset>
    <fieldset><legend>Печатный лист</legend><div class="doc-config-fields">
      ${field('sheetWidthMm', 'Ширина листа, мм', config.sheetWidthMm, {min:50,max:500})}
      ${field('sheetHeightMm', 'Высота листа, мм', config.sheetHeightMm, {min:50,max:500})}
      ${field('marginMm', 'Поля листа, мм', config.marginMm, {min:0,max:50})}
      ${field('gapMm', 'Интервал между снимками, мм', config.gapMm, {min:0,max:50})}
    </div><p>Укажите фактический размер бумаги. Комплект должен целиком помещаться в заданную сетку с полями и интервалами.</p></fieldset>
    <section aria-label="Форматы комплектов"><h2>Форматы и стоимость</h2>
      <p>Цена комплекта для клиента — 50% от базовой цены. Пустая цена оставляет формат только для предпросмотра.</p>
      <div data-formats></div><button type="button" data-add-format>Добавить формат</button>
    </section>`;
  const rows = container.querySelector('[data-formats]');
  function appendFormat(format) {
    const row = document.createElement('fieldset');
    row.className = 'doc-config-format';
    const guides = format.guides ?? {top:10,chin:80,eyes:40,width:60};
    row.innerHTML = `<legend>Комплект фотографий</legend><div class="doc-config-fields">
      ${field('label', 'Название', format.label, {type:'text'})}
      ${field('id', 'Постоянный код', format.id, {type:'text',readonly:true})}
      ${field('widthMm', 'Ширина снимка, мм', format.widthMm, {min:10,max:300})}
      ${field('heightMm', 'Высота снимка, мм', format.heightMm, {min:10,max:300})}
      ${field('count', 'Снимков в комплекте', format.count, {max:100})}
      ${field('columns', 'Колонки на листе', format.columns, {max:20})}
      ${field('rows', 'Ряды на листе', format.rows, {max:20})}
      ${field('basePriceRubles', 'Базовая цена комплекта, ₽', format.basePriceKopecks == null ? '' : (format.basePriceKopecks / 100).toFixed(2), {type:'text'})}
    </div><p data-format-summary></p><details><summary>Направляющие кадра</summary>
      <p>Проценты ширины и высоты кадра. Это подсказки для ручного совмещения; они не печатаются и не подтверждают соответствие требованиям ведомства.</p>
      <div class="doc-config-fields">${[
        ['top','Макушка от верхнего края, %'],['eyes','Линия глаз от верхнего края, %'],
        ['chin','Подбородок от верхнего края, %'],['width','Ширина овала, %']
      ].map(([key,label]) => field('guide-' + key,label,guides[key],{max:99})).join('')}</div>
    </details><button type="button" class="doc-config-remove" data-remove-format>Удалить формат</button>`;
    row.querySelector('[data-remove-format]').addEventListener('click', () => row.remove());
    rows.append(row);
    updateSummary(row);
  }
  function updateSummary(row) {
    const value = key => row.querySelector(`[data-key="${key}"]`).value;
    const output = row.querySelector('[data-format-summary]');
    try {
      const base = rublesToKopecks(value('basePriceRubles'));
      const price = base == null ? 'Только предпросмотр — в корзину добавить нельзя.' : 'Цена со скидкой 50%: ' + new Intl.NumberFormat('ru-RU', {style:'currency',currency:'RUB'}).format(Math.round(base / 2) / 100) + ' за комплект.';
      output.textContent = price;
    } catch (error) { output.textContent = error.message; }
  }
  for (const format of config.formats) appendFormat(format);
  container.addEventListener('input', event => { const row = event.target.closest('.doc-config-format'); if (row) updateSummary(row); });
  container.querySelector('[data-add-format]').addEventListener('click', () => {
    appendFormat({id:'doc-custom-' + Date.now().toString(36),label:'Новый формат',widthMm:35,heightMm:45,count:4,columns:2,rows:2,basePriceKopecks:null});
    rows.lastElementChild.querySelector('[data-key="label"]').focus();
  });
  return {
    read() {
      const globalValue = key => container.querySelector(`[data-key="${key}"]`).value;
      const result = {
        enabled:container.querySelector('[data-config="enabled"]').checked,
        heading:container.querySelector('[data-config="heading"]').value.trim(),
        helpItems:[...container.querySelectorAll('[data-help]')].map(input => input.value.trim()),
        sheetWidthMm:integer(globalValue('sheetWidthMm'),'Ширина листа',50,500),
        sheetHeightMm:integer(globalValue('sheetHeightMm'),'Высота листа',50,500),
        marginMm:integer(globalValue('marginMm'),'Поля листа',0,50),
        gapMm:integer(globalValue('gapMm'),'Интервал',0,50),
        formats:[...rows.children].map(row => {
          const value = key => row.querySelector(`[data-key="${key}"]`).value;
          return {
            id:value('id'),label:value('label').trim(),
            widthMm:integer(value('widthMm'),'Ширина снимка',10,300),heightMm:integer(value('heightMm'),'Высота снимка',10,300),
            count:integer(value('count'),'Снимков в комплекте',1,100),
            columns:integer(value('columns'),'Колонки',1,20),rows:integer(value('rows'),'Ряды',1,20),
            basePriceKopecks:rublesToKopecks(value('basePriceRubles')),
            guides:Object.fromEntries(['top','eyes','chin','width'].map(key => [key,integer(value('guide-' + key),'Направляющая',1,99)]))
          };
        })
      };
      return validateDocumentAdminConfig(result);
    }
  };
}
