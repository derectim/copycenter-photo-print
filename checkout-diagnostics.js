const BUILD = '2.3.5';
const allowedActions = new Set([
  'config', 'session', 'upload', 'rendition', 'prepare', 'basket', 'draftSave',
  'draftLoad', 'draftList', 'draftDelete', 'draftFile', 'libraryList', 'libraryFile',
  'libraryUpload', 'libraryCapture', 'libraryMove', 'libraryDelete', 'albumSave',
  'albumDelete', 'phoneInbox', 'phoneUpload', 'phoneAck', 'pairCreate', 'pairInfo',
  'pairRevoke', 'basketProjects', 'basketRemove', 'file', 'renderPrint', 'saveQueue', 'checkout',
  'initialize', 'pointerCheckout', 'clickCheckout', 'checkoutHandler', 'review', 'modalOpen', 'checkoutSnapshot'
]);
const allowedOutcomes = new Set(['pending', 'ok', 'error', 'network-error']);
const allowedReasons = new Set(['ready', 'busy', 'invalid-selection', 'dialog-open', 'workspace-missing', 'disabled']);
const noop = () => {};

// Opt-in, tab-local timing only. Never retain URLs, file names, cookies, tokens,
// payloads, account/order identifiers, image content or raw error messages.
export function createCheckoutDiagnostics({enabled = false, now = () => performance.now(),
  write = event => console.info('[photo timing]', JSON.stringify(event))} = {}) {
  const events = [];
  const origin = enabled ? now() : 0;
  let sequence = 0, dropped = 0;
  const rounded = value => Math.round(Math.max(0, value) * 10) / 10;
  function numeric(details) {
    const safe = {};
    for (const name of ['fileBytes', 'bodyBytes', 'responseBytes']) {
      if (Number.isSafeInteger(details[name]) && details[name] >= 0) safe[name] = details[name];
    }
    if (Number.isInteger(details.httpStatus) && details.httpStatus >= 100 && details.httpStatus <= 599) {
      safe.httpStatus = details.httpStatus;
    }
    for (const name of ['phpBootstrapMs', 'phpHandlerMs']) {
      if (Number.isFinite(details[name]) && details[name] >= 0) safe[name] = rounded(details[name]);
    }
    for (const name of ['endpoint', 'busy', 'canCheckout', 'openDialog', 'workspace', 'buttonDisabled',
      'dialogSupported', 'arrayAtSupported', 'objectHasOwnSupported', 'structuredCloneSupported']) {
      if (typeof details[name] === 'boolean') safe[name] = details[name];
    }
    if (allowedReasons.has(details.reason)) safe.reason = details.reason;
    return safe;
  }
  function emit(event) {
    try { write({...event, build:BUILD}); } catch { /* Diagnostics cannot interrupt checkout. */ }
  }
  function start(action, details = {}) {
    if (!enabled || !allowedActions.has(action)) return noop;
    const started = now();
    const event = {sequence:++sequence, action, startMs:rounded(started-origin), outcome:'pending', ...numeric(details)};
    events.push(event);
    if (events.length > 100) { events.shift(); dropped++; }
    emit(event);
    let finished = false;
    return (outcome = 'ok', result = {}) => {
      if (finished) return;
      finished = true;
      Object.assign(event, numeric(result), {outcome:allowedOutcomes.has(outcome) && outcome !== 'pending' ? outcome : 'error',
        durationMs:rounded(now()-started)});
      emit(event);
    };
  }
  function snapshot() {
    const elapsed = enabled ? now()-origin : 0;
    return {build:BUILD, enabled, dropped, events:events.map(event => event.outcome === 'pending'
      ? {...event, elapsedMs:rounded(elapsed-event.startMs)} : {...event})};
  }
  return {enabled, start, record:(action, details) => start(action, details)(), snapshot,
    export:() => JSON.stringify(snapshot(), null, 2)};
}

const enabled = typeof location !== 'undefined' && new URL(location.href).searchParams.get('photo_debug') === '1';
export const checkoutDiagnostics = createCheckoutDiagnostics({enabled});

export function diagnosticServerTiming(header) {
  const metrics = {};
  for (const item of String(header || '').split(',')) {
    const match = item.trim().match(/^(php_bootstrap|php_handler)\s*;\s*dur\s*=\s*(\d+(?:\.\d+)?)\s*$/);
    if (!match) continue;
    const value = Number(match[2]);
    if (Number.isFinite(value)) metrics[match[1] === 'php_bootstrap' ? 'phpBootstrapMs' : 'phpHandlerMs'] = value;
  }
  return metrics;
}

export async function copyCheckoutDiagnostics(control, container, inspect) {
  if (inspect) checkoutDiagnostics.record('checkoutSnapshot', inspect());
  const report = checkoutDiagnostics.export();
  try {
    await navigator.clipboard.writeText(report);
    control.textContent = 'Диагностика скопирована';
  } catch {
    let output = container.querySelector('.checkout-diagnostic-output');
    if (!output) {
      output = document.createElement('textarea');
      output.className = 'checkout-diagnostic-output';
      output.readOnly = true;
      output.setAttribute('aria-label', 'Диагностика времени добавления в корзину');
      output.style.cssText = 'display:block;width:100%;min-height:180px;font-size:14px';
      container.append(output);
    }
    output.value = report; output.focus(); output.select();
  }
}

export function mountCheckoutDiagnostics(root, inspect) {
  if (!checkoutDiagnostics.enabled) return;
  const panel = document.createElement('aside');
  panel.className = 'checkout-debug';
  panel.setAttribute('aria-label', 'Диагностика загрузчика');
  panel.style.cssText = 'margin:12px 0;padding:12px;border:1px solid #b9bdc4;border-radius:8px;background:#f4f5f7;color:#252923;font-size:14px;line-height:1.5;overflow-wrap:anywhere';
  const title = document.createElement('strong'); title.textContent = 'Диагностика · загружена версия ' + BUILD;
  const current = document.createElement('p'), state = document.createElement('p');
  for (const text of [title, current, state]) text.style.fontSize = '14px';
  const copy = document.createElement('button');
  copy.type = 'button'; copy.className = 'button secondary'; copy.dataset.diagnostic = 'true';
  copy.textContent = 'Скопировать диагностику'; copy.style.fontSize = '14px';
  copy.addEventListener('click', () => copyCheckoutDiagnostics(copy, panel, inspect));
  panel.append(title, current, state, copy);
  const heading = root.querySelector('.section-top');
  if (heading) heading.after(panel); else root.prepend(panel);
  function refresh() {
    const report = checkoutDiagnostics.snapshot();
    const waiting = report.events.filter(event => event.outcome === 'pending');
    const pending = waiting[waiting.length - 1];
    const last = pending || report.events[report.events.length - 1];
    current.textContent = last ? 'Этап: ' + last.action + ' · ' + (pending ? 'ожидание ' + (pending.elapsedMs / 1000).toFixed(1) + ' с'
      : last.outcome + ' · ' + last.durationMs + ' мс') : 'Начало загрузки…';
    const flags = inspect();
    state.textContent = 'Режим: ' + (flags.endpoint ? 'магазин' : 'демо') + ' · кнопка: ' + flags.reason;
  }
  let timer;
  function start() { clearInterval(timer); refresh(); timer = setInterval(refresh, 500); }
  start();
  window.addEventListener('pagehide', () => clearInterval(timer));
  window.addEventListener('pageshow', start);
}
