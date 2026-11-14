// Doorway Field v2.3 — Pwa: dismissible "Install Doorway Field App" banner (Android / Chrome beforeinstallprompt, iOS Safari Share → Add to Home Screen
// guide), hidden in installed standalone mode; service-worker update watcher → "Field Update Ready — Tap to Refresh" toast.
(function () {
  'use strict';
  const DF = window.DF;
  const $ = s => DF.$(s);
  let deferred = null, reloading = false;
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

  function updateReady() { DF.toast('Field Update Ready — Tap to Refresh', 'Refresh', () => { reloading = true; location.reload(); }, 600000); }
  // sw.js installs with skipWaiting + clients.claim, so a new deploy takes control on its own: offer the refresh when that happens.
  function watch(reg) {
    if (!reg || !navigator.serviceWorker) return;
    const had = !!navigator.serviceWorker.controller;                    // first install is not an "update"
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !reloading) updateReady(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    setInterval(() => reg.update().catch(() => {}), 30 * 60000);
  }

  function init() {
    $('#install-go').addEventListener('click', install);
    $('#install-x').addEventListener('click', () => hide(true));
    if (window.matchMedia) { const mq = window.matchMedia('(display-mode: standalone)'); if (mq.addEventListener) mq.addEventListener('change', check); }
    check();
  }

  DF.pwa = { init, check, install, updateReady, watch, standalone, hide };
})();
