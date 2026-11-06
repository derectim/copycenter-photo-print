import { readDemoCatalog, DEMO_CATALOG_KEY } from './admin-catalog.js';

const table = document.querySelector('#price-info table');
const rubles = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0, maximumFractionDigits: 2 });

function renderPrices() {
  const { formats } = readDemoCatalog();
  const bands = new Set([1]);
  for (const format of formats) {
    for (const tier of format.tiers) bands.add(tier.min);
    if (format.quoteLimit) bands.add(format.quoteLimit + 1);
  }
  const starts = [...bands].sort((a, b) => a - b);
  const headings = ['Формат', ...starts.map((start, i) => {
    const end = starts[i + 1] - 1;
    return Number.isFinite(end) ? (end === start ? start : start + '–' + end) + ' шт.' : 'от ' + start + ' шт.';
  })];
  const header = table.tHead;
  const body = table.tBodies[0];
  header.replaceChildren();
  body.replaceChildren();
  const headRow = header.insertRow();
  headings.forEach(label => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = label;
    headRow.append(th);
  });
  formats.forEach(format => {
    const row = body.insertRow();
    const label = document.createElement('th');
    label.scope = 'row';
    label.textContent = format.label;
    row.append(label);
    for (const min of starts) {
      const tier = format.tiers.filter(item => item.min <= min).sort((a,b) => b.min - a.min)[0];
      const byRequest = format.quoteLimit && min > format.quoteLimit;
      row.insertCell().textContent = byRequest || !tier ? 'По запросу' : rubles.format(tier.price);
    }
  });
}

renderPrices();
window.addEventListener('pageshow', renderPrices);
window.addEventListener('storage', event => { if (event.key === DEMO_CATALOG_KEY || event.key === null) renderPrices(); });
