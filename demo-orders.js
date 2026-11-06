import {vault, sweep, allowBytes} from './demo-vault.js';
import {printOrderText} from './print-order-text.js?v=2.1';

export const ORDER_CHANNEL = 'copycenter-demo-orders-updates';

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
  const sheet = new Blob(['\uFEFF', printOrderText(spec)], {type:'text/plain;charset=utf-8'});
  const metadata = {
    orderNumber, centerId:spec.centerId, centerLabel:String(spec.center || spec.centerId),
    total:spec.total, totalCopies:spec.totalCopies,
    createdAt:new Date().toISOString(), filename:filenamePart(spec.centerId) + '_' + filenamePart(orderNumber) + '.zip',
    byteSize:blob.size + sheet.size, hasSheet:true
  };
  const result = await vault('readwrite', async api => {
    await sweep(api);
    const existing = await api.get('orders',orderNumber);
    if (existing) metadata.createdAt = existing.createdAt;
    await allowBytes(api, metadata.byteSize - (existing?.byteSize || 0));
    await api.put('orders',metadata);
    await api.put('archives',{zip:blob, sheet},orderNumber);
    return metadata;
  });
  notifyChange();
  return result;
}

export async function listDemoOrders() {
  const rows = await vault('readwrite', async api => { await sweep(api); return api.all('orders'); });
  return rows.sort((a,b) => b.createdAt.localeCompare(a.createdAt) || b.orderNumber.localeCompare(a.orderNumber));
}

export async function readDemoOrder(orderNumber) {
  return vault('readwrite', async api => {
    await sweep(api);
    const order = await api.get('orders',String(orderNumber));
    const stored = await api.get('archives',String(orderNumber));
    // The earlier version stored a plain ZIP Blob with its specification inside.
    const blob = stored instanceof Blob ? stored : stored?.zip;
    if (!order || !(blob instanceof Blob)) throw Error('Срок хранения истёк или демозаказ удалён.');
    return {order,blob,sheet:stored?.sheet};
  });
}

export async function removeDemoOrder(orderNumber) {
  await vault('readwrite', async api => {
    await api.del('orders',String(orderNumber));
    await api.del('archives',String(orderNumber));
  });
  notifyChange();
}
