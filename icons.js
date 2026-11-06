(() => {
  const paths = {
    pin: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.6"/>',
    external: '<path d="M7 17 17 7M7 7h10v10"/>',
    tag: '<path d="M3 4h8l10 10-7 7L3 10z"/><circle cx="7.5" cy="7.8" r="1"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.3 9a2.8 2.8 0 0 1 5.5.4c0 2.2-3 2.4-3 4.2M12 16.9h.01"/>',
    images: '<rect x="6" y="4" width="15" height="14" rx="2"/><path d="M3 8v11a2 2 0 0 0 2 2h13M7 15l4-4 4 3 2-2 3 3"/><circle cx="16" cy="8" r="1.3"/>',
    image: '<rect x="2.8" y="3.5" width="18.4" height="17" rx="2.3"/><circle cx="15.8" cy="8.6" r="1.7"/><path d="m3.5 17 5.6-6 5 5 2.7-2.6 4 3.8"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    upload: '<path d="M12 15V3m-5 5 5-5 5 5M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/>',
    shield: '<path d="M12 2.5 20 6v6c0 5-4.6 8-8 10-3.4-2-8-5-8-10V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    sliders: '<path d="M3 6h8m4 0h6M3 12h3m4 0h11M3 18h11m4 0h3"/><circle cx="13" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
    arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
    edit: '<path d="m14.5 5.5 4 4M4 20l4.7-1L21 6.7 17.3 3 5 15.3z"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15m-8 4v7m4-7v7"/>',
    x: '<path d="m6 6 12 12M18 6 6 18"/>'
  };
  window.printIcon = name => '<svg class="pp-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">' + (paths[name] || '') + '</svg>';
  function renderIcons() {
    document.querySelectorAll('.photo-demo [data-icon], #print-app [data-icon]').forEach(el => {
      el.innerHTML = window.printIcon(el.dataset.icon);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderIcons);
  else renderIcons();
})();
