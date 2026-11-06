// This database belongs to this browser and origin. It is never contacted by the Bitrix component.
const DATABASE = 'copycenter-demo-orders-v1';
export const ORDER_CHANNEL = 'copycenter-demo-orders-updates';

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('Браузер не разрешил локальное хранение заказов.'));
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore('orders', {keyPath:'orderNumber'});
      database.createObjectStore('archives');
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

// Keep metadata and potentially large ZIPs in separate stores. Write and delete each pair atomically.
async function transaction(stores, mode, makeRequests) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = database.transaction(stores, mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error || new Error('Операция с демозаказом прервана.'));
      tx.onerror = () => reject(tx.error || new Error('Не удалось сохранить данные демозаказа.'));
      try {
        makeRequests(tx, value => { result = value; });
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
  } finally {
    database.close();
  }
}

function notifyChange() {
  // Focus/visibility refresh also updates an admin tab in browsers without BroadcastChannel.
  if (typeof BroadcastChannel === 'function') {
    try {
      const channel = new BroadcastChannel(ORDER_CHANNEL);
      channel.postMessage('updated');
      channel.close();
    } catch { /* The data has already been committed. */ }
  }
}

function filenamePart(text) {
  return String(text).replace(/[^a-zа-яё0-9._-]+/gi, '-').replace(/^[.-]+|[.-]+$/g, '').slice(0,80) || 'demo';
}

export async function saveDemoOrder(spec, blob) {
  if (!(blob instanceof Blob) || blob.size === 0 || !spec?.orderNumber || !spec.centerId ||
      !Number.isInteger(spec.totalCopies) || spec.totalCopies <= 0 || !Number.isFinite(spec.total) || spec.total < 0) {
    throw new Error('Не удалось проверить архив демозаказа.');
  }
  const orderNumber = String(spec.orderNumber);
  const metadata = {
    orderNumber, centerId:spec.centerId, centerLabel:String(spec.center || spec.centerId),
    total:spec.total, totalCopies:spec.totalCopies,
    createdAt:new Date().toISOString(), filename:filenamePart(spec.centerId) + '_' + filenamePart(orderNumber) + '.zip',
    byteSize:blob.size
  };
  const result = await transaction(['orders','archives'], 'readwrite', (tx, done) => {
    const orders = tx.objectStore('orders');
    const found = orders.get(orderNumber);
    found.onsuccess = () => {
      if (found.result) metadata.createdAt = found.result.createdAt;
      orders.put(metadata);
      tx.objectStore('archives').put(blob, orderNumber);
      done(metadata);
    };
  });
  notifyChange();
  return result;
}

export async function listDemoOrders() {
  const rows = await transaction(['orders'], 'readonly', (tx, done) => {
    const request = tx.objectStore('orders').getAll();
    request.onsuccess = () => done(request.result);
  });
  return rows.sort((a,b) => b.createdAt.localeCompare(a.createdAt) || b.orderNumber.localeCompare(a.orderNumber));
}

export async function readDemoOrder(orderNumber) {
  const data = {};
  await transaction(['orders','archives'], 'readonly', (tx) => {
    const metadata = tx.objectStore('orders').get(String(orderNumber));
    const archive = tx.objectStore('archives').get(String(orderNumber));
    metadata.onsuccess = () => { data.order = metadata.result; };
    archive.onsuccess = () => { data.blob = archive.result; };
  });
  if (!data.order || !(data.blob instanceof Blob)) throw new Error('Демозаказ уже удалён.');
  return data;
}

export async function removeDemoOrder(orderNumber) {
  await transaction(['orders','archives'], 'readwrite', tx => {
    tx.objectStore('orders').delete(String(orderNumber));
    tx.objectStore('archives').delete(String(orderNumber));
  });
  notifyChange();
}

