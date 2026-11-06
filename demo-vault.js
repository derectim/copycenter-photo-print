// Browser-only counterpart of the protected Bitrix storage, shared by demo
// orders, drafts and albums. A single transaction serializes quota decisions.
const databaseName = 'copycenter-demo-orders-v1';
const schema = {
  orders: 'orderNumber', archives: null, media: 'id', blobs: null,
  drafts: 'draftId', albums: 'id', pairs: 'token'
};
export const DEMO_CAPACITY = 20_000_000_000;
export const THREE_DAYS = 3 * 86400000;
export function monthAfter(time) {
  const d = new Date(time);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d.getTime();
}
const result = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function openVault() {
  if (!globalThis.indexedDB) throw Error('Браузер не разрешил локальное хранение файлов.');
  const open = indexedDB.open(databaseName, 2);
  open.onupgradeneeded = () => {
    for (const [name, keyPath] of Object.entries(schema)) {
      if (!open.result.objectStoreNames.contains(name)) open.result.createObjectStore(name, keyPath ? {keyPath} : undefined);
    }
  };
  const db = await result(open);
  db.onversionchange = () => db.close();
  return db;
}
export async function vault(mode, work) {
  const db = await openVault();
  try {
    const tx = db.transaction(Object.keys(schema), mode);
    const done = new Promise((resolve,reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || Error('Сохранение прервано.'));
    });
    const api = {
      all: name => result(tx.objectStore(name).getAll()),
      get: (name,key) => result(tx.objectStore(name).get(key)),
      put: (name,value,key) => result(tx.objectStore(name).put(value,key)),
      del: (name,key) => result(tx.objectStore(name).delete(key))
    };
    try {
      const out = await work(api);
      await done;
      return out;
    } catch (e) {
      try { tx.abort(); } catch { /* Transaction already ended. */ }
      await done.catch(() => {});
      throw e;
    }
  } finally { db.close(); }
}

export async function usage(api) {
  const [media, orders] = await Promise.all([api.all('media'),api.all('orders')]);
  return media.reduce((sum,row) => sum+row.bytes,0) + orders.reduce((sum,row) => sum+(row.byteSize || 0),0);
}
export async function allowBytes(api, delta) {
  if (delta > 0 && await usage(api) + delta > DEMO_CAPACITY) {
    throw Error('Общее хранилище демо заполнено. Освободите место в заказах или библиотеке.');
  }
}
export async function removeMedia(api, id) {
  await Promise.all([api.del('media',id),api.del('blobs',id)]);
}
export async function sweep(api, now = Date.now()) {
  const [drafts,media,orders,pairs] = await Promise.all(['drafts','media','orders','pairs'].map(api.all));
  const live = new Set();
  for (const draft of drafts) {
    if (draft.updatedAt + THREE_DAYS <= now) await api.del('drafts',draft.draftId);
    else live.add(draft.draftId);
  }
  for (const item of media) {
    if (item.draftId ? !live.has(item.draftId) : item.expiresAt <= now) await removeMedia(api,item.id);
  }
  for (const row of orders) if (monthAfter(row.createdAt) <= now) {
    await api.del('archives',row.orderNumber); await api.del('orders',row.orderNumber);
  }
  for (const pair of pairs) if (!live.has(pair.draftId) || pair.expiresAt <= now) await api.del('pairs',pair.token);
}
