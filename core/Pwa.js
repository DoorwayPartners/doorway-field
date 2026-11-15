// Doorway Field v2.5 — Pwa: dismissible "Install Doorway Field App" banner (Android / Chrome beforeinstallprompt, iOS Safari Share → Add to Home Screen
// guide), hidden in installed standalone mode; version.json release check → "Update vX Ready — Tap to Refresh" top banner (no data wipe).
(function () {
  'use strict';
  const DF = window.DF;
  const $ = s => DF.$(s);
  let deferred = null, reloading = false, reg = null;
  const ua = () => navigator.userAgent || '';
  const standalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const ios = () => /iPhone|iPad|iPod/.test(ua()) && /Safari/.test(ua()) && !/CriOS|FxiOS|EdgiOS/.test(ua());
  const mobile = () => /Android|iPhone|iPad|iPod|Mobile/i.test(ua());
  const dismissed = () => Date.now() - (Number(DF.store.get('installDismissed', 0)) || 0) < 7 * 864e5;   // dismissed = quiet for 7 days

  // Chrome may fire this before sign-in finishes: keep the event, show the banner once the app is ready
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; if (DF.ready) show('prompt'); });
  window.addEventListener('appinstalled', () => { deferred = null; hide(false); });

  function show(kind) {
    const b = $('#install-banner'); if (!b) return false;
    if (standalone() || dismissed() || !mobile()) { b.hidden = true; return false; }
    $('#install-text').textContent = kind === 'ios' ? 'Install Doorway Field: tap Share ⎙, then “Add to Home Screen”' : 'Install the Doorway Field app';
    $('#install-go').hidden = kind === 'ios';
    b.dataset.kind = kind; b.hidden = false;
    return true;
  }
  function hide(remember) { const b = $('#install-banner'); if (b) b.hidden = true; if (remember) DF.store.set('installDismissed', Date.now()); }
  async function install() {
    if (!deferred) return null;
    deferred.prompt();
    const c = await Promise.resolve(deferred.userChoice).catch(() => ({ outcome: 'dismissed' }));
    deferred = null; hide(!c || c.outcome !== 'accepted');
    return c && c.outcome;
  }
  function check() { if (deferred) return show('prompt'); if (ios()) return show('ios'); hide(false); return false; }

  // ---- zero-clear-data updater: version.json (never cached) vs the running VERSION → top banner; tap = drop stale static caches + reload.
  // IndexedDB (leads, outbox), localStorage (session, saved Sync URL) and the map-tile cache are untouched.
  function updateReady(v) { $('#update-text').textContent = 'Update v' + (v || 'new') + ' Ready — Tap to Refresh'; $('#update-banner').hidden = false; }
  async function checkVersion() {
    try {
      const j = await (await fetch('version.json?ts=' + Date.now(), { cache: 'no-store' })).json();
      if (j && j.version && j.version !== DF.cfg.VERSION) { if (reg) reg.update().catch(() => {}); updateReady(j.version); return j.version; }
    } catch (e) { /* offline: try again on the next foreground */ }
    return null;
  }
  async function applyUpdate() {
    reloading = true;
    try {
      if (reg && reg.waiting) reg.waiting.postMessage('skipWaiting');
      const keys = window.caches ? await caches.keys() : [];
      await Promise.all(keys.filter(k => /^df-shell/.test(k)).map(k => caches.delete(k)));
    } catch (e) { /* reload anyway */ }
    location.reload();
  }
  // v2.5.2 1-tap "Refresh App / Clear Cache" (sign-in sheet + Filters drawer): unregister stale service workers, drop only df-shell* static caches,
  // cache-busted reload (?v=). IndexedDB leads + outbox, localStorage (session, API_URL) and map tiles are kept: no more wiping Android app data.
  async function resetCache() {
    reloading = true;
    try {
      const regs = navigator.serviceWorker && navigator.serviceWorker.getRegistrations ? await navigator.serviceWorker.getRegistrations() : [];
      await Promise.all(regs.map(r => r.unregister()));
      const keys = window.caches ? await caches.keys() : [];
      await Promise.all(keys.filter(k => /^df-shell/.test(k)).map(k => caches.delete(k)));
    } catch (e) { /* reload anyway */ }
    location.replace(location.pathname + '?v=' + Date.now() + location.hash);
  }
  // sw.js installs with skipWaiting + clients.claim, so a new deploy takes control on its own: offer the refresh when that happens.
  function watch(r) {
    reg = r;
    if (!reg || !navigator.serviceWorker) return;
    const had = !!navigator.serviceWorker.controller;                    // first install is not an "update"
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !reloading) checkVersion().then(v => { if (!v) updateReady(''); }); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    setInterval(() => reg.update().catch(() => {}), 30 * 60000);
  }

  function init() {
    $('#install-go').addEventListener('click', install);
    $('#install-x').addEventListener('click', () => hide(true));
    if (window.matchMedia) { const mq = window.matchMedia('(display-mode: standalone)'); if (mq.addEventListener) mq.addEventListener('change', check); }
    $('#update-banner').addEventListener('click', applyUpdate);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkVersion(); });
    check(); checkVersion();
  }

  DF.pwa = { init, check, install, updateReady, checkVersion, applyUpdate, resetCache, watch, standalone, hide };
  // bound at load (before sign-in): the button must work even when the sign-in sheet is the only thing on screen
  DF.$$('.btn-reset').forEach(b => b.addEventListener('click', resetCache));
  if (/[?&]v=\d+/.test(location.search)) history.replaceState(null, '', location.pathname + location.search.replace(/[?&]v=\d+/, '').replace(/^&/, '?') + location.hash);
})();
