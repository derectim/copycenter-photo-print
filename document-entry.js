// Settings are public text only; account state and photos never enter this card.
export function renderDocumentEntry(card, config) {
  const enabled = config?.enabled === true && typeof config.heading === 'string'
    && Array.isArray(config.helpItems) && config.helpItems.length === 3
    && config.helpItems.every(item => typeof item === 'string');
  card.hidden = !enabled;
  if (!enabled) return;
  card.querySelector('[data-document-heading]').textContent = config.heading;
  const list = card.querySelector('[data-document-help]');
  list.replaceChildren(...config.helpItems.map(text => {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  }));
  card.querySelector('[data-document-link]').hidden = false;
  card.querySelector('[data-document-status]').hidden = true;
}

async function refreshDocumentEntry(card) {
  try {
    const endpoint = new URL(card.dataset.endpoint, location.origin);
    if (endpoint.origin !== location.origin) throw new Error('Invalid endpoint');
    endpoint.searchParams.set('action', 'config');
    endpoint.searchParams.set('service', 'documents');
    const response = await fetch(endpoint, {cache:'no-store', credentials:'same-origin', headers:{Accept:'application/json'}});
    const result = await response.json();
    if (!response.ok || result.ok === false) throw new Error('Config unavailable');
    renderDocumentEntry(card, result.data?.documentPhoto ?? result.documentPhoto);
  } catch {
    // A cached server-rendered card must not offer checkout while its service is unavailable.
    card.querySelector('[data-document-link]').hidden = true;
    const status = card.querySelector('[data-document-status]');
    status.textContent = 'Онлайн-заказ временно недоступен. Попробуйте обновить страницу позже.';
    status.hidden = false;
  }
}

const cards = [...document.querySelectorAll('[data-document-entry][data-endpoint]')];
for (const card of cards) refreshDocumentEntry(card);
window.addEventListener('pageshow', event => {
  if (event.persisted) for (const card of cards) refreshDocumentEntry(card);
});
