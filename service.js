import {demoAuth, demoSignIn} from './demo-account.js';

const card = document.querySelector('.cc-photo-entry');
const editorURL = card.href;
const dialog = document.getElementById('service-signin');
const errorText = document.getElementById('signin-error');

function authorized() {
  try { return demoAuth().authorized; }
  catch { return false; }
}

function updateLink() {
  const signedIn = authorized();
  card.href = signedIn ? editorURL : '#service-signin';
  if (signedIn && dialog.open) dialog.close();
}

function promptForLogin() {
  if (authorized()) {
    location.assign(editorURL);
    return;
  }
  errorText.hidden = true;
  if (!dialog.open) dialog.showModal();
}

card.addEventListener('click', event => {
  updateLink();
  if (card.hash === '#service-signin' && !(event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)) {
    event.preventDefault();
    promptForLogin();
  }
});
// Choosing and dropping photos is available in the editor. A file dropped onto
// this navigation card must not cause the browser to open the original file.
for (const type of ['dragover', 'drop']) {
  card.addEventListener(type, event => {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'none';
    }
  });
}
document.getElementById('cancel-signin').addEventListener('click', () => dialog.close());
document.getElementById('confirm-signin').addEventListener('click', () => {
  try {
    demoSignIn();
    dialog.close();
    location.assign(editorURL);
  } catch {
    errorText.textContent = 'Браузер не разрешил сохранить демопрофиль. Разрешите локальное хранение данных и повторите вход.';
    errorText.hidden = false;
  }
});
dialog.addEventListener('close', () => {
  if (location.hash === '#service-signin') history.replaceState(history.state, '', location.pathname + location.search);
  card.focus();
});
function restoreEntry() {
  updateLink();
  if (location.hash === '#service-signin') promptForLogin();
}
window.addEventListener('pageshow', restoreEntry);
window.addEventListener('hashchange', restoreEntry);
window.addEventListener('storage', updateLink);
restoreEntry();

const sitePhoto = document.querySelector('.service-photo img');
function useLocalPreview() { sitePhoto.src = './assets/sample-lake.jpg'; }
sitePhoto.addEventListener('error', useLocalPreview, {once:true});
if (sitePhoto.complete && !sitePhoto.naturalWidth) useLocalPreview();
