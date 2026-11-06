import { demoCatalog, frameStyles, instantFrames } from './catalog.js';

export const DEMO_CATALOG_KEY = 'copycenter-demo-catalog-v1';
export const assignment = {papers: 'paperIds', fits: 'fitIds', frames: 'frameIds', extras: 'extraIds'};
export const sectionLabels = {papers:'Бумага', fits:'Кадрирование', frames:'Рамки', extras:'Дополнительные услуги'};

const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function number(value, min, max, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return false;
  return integer ? Number.isInteger(value) : Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
}

export function validateDemoCatalog(catalog) {
  if (!plainObject(catalog)) throw new Error('Проверьте данные каталога.');
  for (const key of ['formats', ...Object.keys(assignment), 'centers']) {
    const rows = catalog[key];
    if (!Array.isArray(rows) || rows.length > 100 || (key !== 'extras' && !rows.length)) {
      throw new Error('В каждом обязательном разделе должна быть хотя бы одна запись. Максимум — 100 записей.');
    }
    const used = new Set();
    for (const row of rows) {
      if (!plainObject(row) || typeof row.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/i.test(row.id) ||
          Object.hasOwn(Object.prototype, row.id) || used.has(row.id.toLowerCase())) {
        throw new Error('Код должен быть уникальным: до 32 латинских букв, цифр и дефисов.');
      }
      if (typeof row.label !== 'string' || !row.label.trim() || row.label.length > 100 || /[\u0000-\u001f]/.test(row.label)) {
        throw new Error('Укажите название длиной от 1 до 100 символов.');
      }
      used.add(row.id.toLowerCase());
      if (Object.hasOwn(assignment, key) && !number(row.surcharge, 0, 100000)) {
        throw new Error('Доплата за отпечаток должна быть от 0 до 100 000 ₽ с точностью до копеек.');
      }
      if (key === 'fits' || key === 'frames') {
        const choices = key === 'fits' ? ['cover','contain'] : Object.keys(frameStyles);
        if (!choices.includes(row.preview || row.id)) throw new Error('Выберите вариант отображения опции.');
      }
    }
  }
  for (const format of catalog.formats) {
    if (!number(format.width, 0.1, 500) || !number(format.height, 0.1, 500)) {
      throw new Error('Ширина и высота отпечатка должны быть от 0,1 до 500 см.');
    }
    if (!Array.isArray(format.tiers) || !format.tiers.length || format.tiers.length > 100) {
      throw new Error('Задайте от одного до 100 ценовых порогов.');
    }
    const thresholds = new Set();
    for (const tier of format.tiers) {
      if (!plainObject(tier) || !number(tier.min, 1, 100000, true) ||
          !number(tier.price, 0.01, 100000) || thresholds.has(tier.min)) {
        throw new Error('У каждого порога должен быть свой целый тираж и цена больше нуля.');
      }
      thresholds.add(tier.min);
    }
    if (!thresholds.has(1)) throw new Error('Задайте цену от одного отпечатка.');
    if (format.quoteLimit != null && !number(format.quoteLimit, Math.max(...thresholds), 100000, true)) {
      throw new Error('Максимальный тираж должен включать последний ценовой порог.');
    }
    for (const [section, field] of Object.entries(assignment)) {
      const ids = format[field];
      if (!Array.isArray(ids) || (section !== 'extras' && !ids.length) || new Set(ids).size !== ids.length ||
          ids.some(id => !catalog[section].some(option => option.id === id))) {
        throw new Error('Проверьте доступные опции формата «' + format.label + '».');
      }
      const rates = format.surcharges?.[section] ?? {};
      if (!plainObject(rates) || Object.entries(rates).some(([id, price]) => !ids.includes(id) || !number(price,0,100000))) {
        throw new Error('Проверьте доплаты за опции формата «' + format.label + '».');
      }
    }
  }
  return catalog;
}

export function readDemoCatalog() {
  try {
    const saved = window.localStorage.getItem(DEMO_CATALOG_KEY);
    if (saved) {
      const catalog = JSON.parse(saved);
      if (plainObject(catalog) && !Object.hasOwn(catalog, 'extras')) catalog.extras = [];
      for (const format of catalog.formats) {
        if (!Object.hasOwn(format, 'extraIds')) format.extraIds = [];
      }
      // Add newly released presets to existing demo catalogs without changing an
      // administrator's custom frames, labels or rates. Saved removals stay removed.
      if (!catalog.frameEdition) {
        for (const frame of instantFrames) {
          const conflict = catalog.frames.some(old => old.id.toLowerCase() === frame.id);
          if (conflict || catalog.frames.length >= 100) continue;
          catalog.frames.push({...frame});
          for (const format of catalog.formats) {
            if (format.width === 10 && format.height === 10) format.frameIds.push(frame.id);
          }
        }
        catalog.frameEdition = 1;
      }
      return validateDemoCatalog(catalog);
    }
  } catch { /* The storefront stays usable with the default catalog in private browsing. */ }
  return structuredClone(demoCatalog);
}

export function saveDemoCatalog(catalog) {
  validateDemoCatalog(catalog);
  window.localStorage.setItem(DEMO_CATALOG_KEY, JSON.stringify(catalog));
}

