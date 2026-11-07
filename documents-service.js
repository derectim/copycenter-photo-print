import {demoAuth, demoSignIn} from './demo-account.js';
import {readDocumentDemoConfig, documentDemoStorageKey} from './document-photo-demo-config.js?v=2.4.0';
import {renderDocumentEntry} from './document-entry.js?v=2.4.0';

const card = document.querySelector('[data-document-entry]');
const link = card.querySelector('[data-document-link]');
const dialog = document.getElementById('service-signin');
const error = document.getElementById('signin-error');
const editorURL = link.href;
function refresh() { renderDocumentEntry(card, readDocumentDemoConfig()); }
function authorized() { try { return demoAuth().authorized; } catch { return false; } }
link.addEventListener('click', event => {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || authorized()) return;
  event.preventDefault();
  error.hidden = true;
  dialog.showModal();
});
for (const type of ['dragover','drop']) card.addEventListener(type, event => {
  if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
});
document.getElementById('cancel-signin').addEventListener('click', () => dialog.close());
document.getElementById('confirm-signin').addEventListener('click', () => {
  try { demoSignIn(); location.assign(editorURL); }
  catch { error.textContent = 'Браузер не разрешил сохранить демопрофиль. Разрешите локальное хранение данных и повторите вход.'; error.hidden = false; }
});
dialog.addEventListener('close', () => link.focus());
window.addEventListener('pageshow', refresh);
window.addEventListener('storage', event => { if (event.key === documentDemoStorageKey) refresh(); });
refresh();
