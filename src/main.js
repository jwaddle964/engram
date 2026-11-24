/* App startup. */
(function (root) {
  'use strict';
  const UI = root.UI, DB = root.DB, Col = root.Col;
  if (root.hljs) {
    root.__highlight = (code, lang) => {
      const l = (lang || '').toLowerCase();
      if (!l || !root.hljs.getLanguage(l)) return null;
      return root.hljs.highlight(code, { language: l, ignoreIllegals: true }).value;
    };
  }
  async function start() {
    const app = document.getElementById('app');
    try {
      const ok = await DB.open();
      if (!ok) root.__storageWarning = 'This browser has no IndexedDB storage, so cards will be lost when you close the page.';
    } catch (e) {
      console.error(e);
      root.__storageWarning = 'Could not open storage (' + (e && e.message ? e.message : e) + '). Private browsing mode can cause this. Cards will not be saved.';
    }
    Col.ensureDefaults();
    UI.applyTheme();
    if (root.matchMedia) {
      const mq = root.matchMedia('(prefers-color-scheme: dark)');
      const onTheme = () => { UI.applyTheme(); if (DB.col.meta && DB.col.meta.theme === 'auto') UI.render(); };
      if (mq.addEventListener) mq.addEventListener('change', onTheme); else if (mq.addListener) mq.addListener(onTheme);
    }
    DB.onChange((ev) => { if (ev.type === 'error') UI.toast('Saving failed: ' + (ev.error && ev.error.message ? ev.error.message : 'storage error')); });
    // ask the browser not to evict our data (granted automatically for installed apps on most browsers)
    if (navigator.storage && navigator.storage.persist) navigator.storage.persisted().then((p) => { if (!p) navigator.storage.persist().catch(() => {}); }).catch(() => {});
    // day rollover while the app stays open: re-render the deck list
    let lastDay = Col.timing().today;
    setInterval(() => { const d = Col.timing().today; if (d !== lastDay) { lastDay = d; Col.maybeUnbury(); if (!document.body.classList.contains('studying')) UI.render(); } }, 60000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { const d = Col.timing().today; if (d !== lastDay) { lastDay = d; Col.maybeUnbury(); UI.render(); } } });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') UI.closeTopSheet(); });
    if (app) app.innerHTML = '';
    UI.render();
    if ('serviceWorker' in navigator && root.isSecureContext && /^https?:/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          if (!w) return;
          w.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) { root.__updateReady = true; UI.toast('Update downloaded', { label: 'Reload', fn: () => location.reload() }); }
          });
        });
      }).catch((e) => console.warn('SW registration failed', e));
    }
  }
  root.addEventListener('error', (e) => { console.error(e.error || e.message); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(typeof globalThis !== 'undefined' ? globalThis : this);
