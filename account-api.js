import {checkoutDiagnostics, diagnosticServerTiming} from './checkout-diagnostics.js?v=2.3.5';

const readActions = new Set(['config', 'session', 'libraryList', 'draftList', 'draftLoad', 'phoneInbox', 'basketProjects']);
const uploadActions = new Set(['upload', 'rendition', 'libraryUpload', 'phoneUpload']);
const authCodes = new Set(['AUTH_REQUIRED', 'ACCOUNT_CHANGED']);

export function createAccountAPI(endpoint) {
  let owner, token, refreshing, authFailure;
  const api = { call, file, refresh, demo: !endpoint, onAuthRequired: null };

  function accountChanged() {
    const error = Error('Открыт другой аккаунт. Для продолжения войдите в аккаунт, в котором начали этот заказ.');
    error.code = 'ACCOUNT_CHANGED';
    return error;
  }
  function setSession(data) {
    const user = data.auth?.authorized ? Number(data.auth.userId) : 0;
    if (owner !== undefined && owner !== user) throw accountChanged();
    if (!Number.isSafeInteger(user) || user < 0 || typeof data.sessid !== 'string' || !data.sessid) {
      throw Error('Магазин не подтвердил текущую сессию.');
    }
    owner = user;
    token = data.sessid;
    return data;
  }
  function requireLogin(error) {
    if (authCodes.has(error.code)) {
      authFailure = error;
      api.onAuthRequired?.(error);
    }
    throw error;
  }
  async function send(url, init, binary = false, action = 'file') {
    if (url.origin !== location.origin) throw Error('Адрес модуля должен находиться на домене магазина.');
    const sizes = {};
    if (checkoutDiagnostics.enabled) {
      if (init.body instanceof FormData) sizes.fileBytes = init.body.get('file')?.size;
      else if (typeof init.body === 'string') sizes.bodyBytes = new TextEncoder().encode(init.body).length;
    }
    const finish = checkoutDiagnostics.start(action, sizes);
    const headers = checkoutDiagnostics.enabled ? {...init.headers, 'X-Photoprint-Debug':'1'} : init.headers;
    let response;
    try {
      response = await fetch(url, { ...init, headers, mode: 'same-origin', credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
    } catch {
      finish('network-error');
      throw Error('Не удалось связаться с магазином. Проверьте соединение и повторите попытку.');
    }
    const resultTiming = {httpStatus:response.status, ...(checkoutDiagnostics.enabled
      ? diagnosticServerTiming(response.headers.get('Server-Timing')) : {})};
    if (response.ok && binary) {
      try {
        const blob = await response.blob();
        finish('ok', {...resultTiming, responseBytes:blob.size});
        return blob;
      } catch (error) {
        finish('network-error', resultTiming);
        throw error;
      }
    }
    const data = await response.json().catch(() => ({ error: 'Магазин вернул неожиданный ответ. Повторите попытку позже.' }));
    if (!response.ok || data.error) {
      finish('error', resultTiming);
      const error = Error(data.error || 'Магазин вернул неожиданный ответ. Повторите попытку позже.');
      Object.assign(error, { status: response.status, code: data.code, missingAssetIds: data.missingAssetIds, missingPrintIds: data.missingPrintIds });
      throw error;
    }
    finish('ok', resultTiming);
    return data;
  }
  function request(action, args, csrf) {
    const url = new URL(endpoint, location.href);
    url.searchParams.set('action', action);
    const init = { headers: { 'X-Requested-With': 'XMLHttpRequest' } };
    if (action !== 'config') init.headers['X-Photoprint-User'] = String(owner || 0);
    if (readActions.has(action)) {
      for (const [key, value] of Object.entries(args)) if (value != null) url.searchParams.set(key, value);
    } else if (uploadActions.has(action)) {
      init.method = 'POST';
      init.body = args instanceof FormData ? args : new FormData();
      if (!(args instanceof FormData)) {
        for (const [key, value] of Object.entries(args)) if (value != null) init.body.set(key, value);
      }
      init.body.set('sessid', csrf);
    } else {
      init.method = 'POST';
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify({ ...args, sessid: csrf });
    }
    return send(url, init, false, action);
  }
  function refresh() {
    // Several saves/uploads can see the same rejected token at once.
    refreshing ??= request('session', {}, null).then(setSession).then(() => { authFailure = null; })
      .catch(requireLogin).finally(() => { refreshing = null; });
    return refreshing;
  }
  async function call(action, args = {}) {
    if (!endpoint) return (await import('./demo-account.js')).demoCall(action, args);
    if (authFailure) throw authFailure;
    if (action === 'config') {
      try { return setSession(await request(action, args)); }
      catch (error) { return requireLogin(error); }
    }
    const sentToken = token;
    try {
      return await request(action, args, sentToken);
    } catch (error) {
      // Only the pre-dispatch rejection guarantees that no write has taken place.
      if (readActions.has(action) || error.status !== 403 || error.code !== 'SESSION_EXPIRED') return requireLogin(error);
    }
    if (token === sentToken) await refresh();
    if (authFailure) throw authFailure;
    try { return await request(action, args, token); }
    catch (error) { return requireLogin(error); }
  }
  async function file(info) {
    if (!endpoint) return (await import('./demo-account.js')).demoFile(info);
    if (authFailure) throw authFailure;
    const url = new URL(info.url, location.href);
    try {
      const blob = await send(url, { headers: { 'X-Photoprint-User': String(owner || 0) } }, true);
      return new File([blob], info.name, { type: blob.type });
    } catch (error) { return requireLogin(error); }
  }
  return api;
}
