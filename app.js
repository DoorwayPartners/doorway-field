// Doorway Field v1.0 — app core: namespace, event bus, sign-in, tab nav, toast, boot. 0 AI calls.
(function () {
  'use strict';
  const handlers = {};
  const DF = window.DF = {
    cfg: window.DF_CONFIG,
    bus: {
      on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
      emit(ev, data) { (handlers[ev] || []).forEach(fn => { try { fn(data); } catch (e) { console.error('[DF] ' + ev, e); } }); }
    },
    $: (sel, root) => (root || document).querySelector(sel),
    $$: (sel, root) => Array.from((root || document).querySelectorAll(sel)),
    store: {
      get(k, d) { try { const v = localStorage.getItem('df.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
      set(k, v) { try { localStorage.setItem('df.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
    },
    auth: { email: '', name: '', idToken: '', role: 'rep' },
    lastFlipMs: null,
    lastCardMs: null
  };

  // ---- text helpers (escape everything user/CSV-provided) ----
  DF.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  DF.fmtTime = iso => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
  DF.firstName = email => {
    const rep = (DF.cfg.REPS || []).find(r => r.email === email);
    if (rep && rep.name) return rep.name.split(' ')[0];
    const local = String(email || 'rep').split('@')[0].split(/[._-]/)[0];
    return local.charAt(0).toUpperCase() + local.slice(1);
  };

  // ---- toast with optional action (used for 5 s undo) ----
  let toastTimer = null;
  DF.toast = function (msg, actionLabel, action, ms) {
    const t = DF.$('#toast');
    DF.$('#toast-msg').textContent = msg;
    const btn = DF.$('#toast-action');
    btn.hidden = !actionLabel;
    btn.textContent = actionLabel || '';
    btn.onclick = () => { t.classList.remove('show'); if (action) action(); };
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2500);
  };

  // ---- sign-in: Google Identity Services when configured, else dev email. The API verifies the ID token. ----
  function decodeJwt(tok) {
    try { return JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) { return {}; }
  }
  function setUser(email, name, idToken) {
    DF.auth.email = String(email || '').trim().toLowerCase();
    DF.auth.name = name || DF.firstName(DF.auth.email);
    DF.auth.idToken = idToken || '';
    DF.auth.role = DF.admin && DF.admin.isOwner(DF.auth.email) ? 'owner' : 'rep';
    DF.store.set('user', { email: DF.auth.email, name: DF.auth.name });
    DF.$('#me-name').textContent = DF.auth.name;
    DF.$('#tab-admin').hidden = DF.auth.role !== 'owner';
    DF.bus.emit('auth:changed', DF.auth);
  }
  DF.setUser = setUser;
  function signIn() {
    return new Promise(resolve => {
      const saved = DF.store.get('user', null);
      if (saved && saved.email && !DF.cfg.GOOGLE_CLIENT_ID) { setUser(saved.email, saved.name); return resolve(); }
      if (DF.cfg.GOOGLE_CLIENT_ID && window.google && google.accounts && google.accounts.id) {
        google.accounts.id.initialize({
          client_id: DF.cfg.GOOGLE_CLIENT_ID,
          callback: r => { const p = decodeJwt(r.credential); setUser(p.email, p.given_name, r.credential); resolve(); }
        });
        google.accounts.id.prompt();
        return;
      }
      const modal = DF.$('#modal-signin');
      modal.classList.add('open');
      DF.$('#signin-form').onsubmit = e => {
        e.preventDefault();
        const email = DF.$('#signin-email').value;
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
        modal.classList.remove('open');
        setUser(email);
        resolve();
      };
    });
  }

  // ---- 4-tab nav (Map | List | Stats | Admin) ----
  DF.showTab = function (name) {
    if (name === 'admin' && DF.auth.role !== 'owner') name = 'map';
    DF.$$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    DF.$$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    DF.currentTab = name;
    DF.bus.emit('tab:changed', name);
  };

  // ---- modal helpers ----
  DF.openModal = id => DF.$('#' + id).classList.add('open');
  DF.closeModal = id => DF.$('#' + id).classList.remove('open');

  async function boot() {
    DF.$$('.tab').forEach(t => t.addEventListener('click', () => DF.showTab(t.dataset.tab)));
    DF.$$('[data-close]').forEach(b => b.addEventListener('click', () => DF.closeModal(b.dataset.close)));
    DF.$('#app-version').textContent = 'v' + DF.cfg.VERSION;
    await DF.sync.open();
    if (!DF.sync.count() && DF.cfg.FIXTURE_URL) {
      try {
        const fx = await (await fetch(DF.cfg.FIXTURE_URL)).json();
        await DF.sync.importRows(fx.pins || fx, { source: 'fixture', silent: true });
      } catch (e) { console.error('[DF] fixture', e); }
    }
    await signIn();
    DF.card.init();
    DF.admin.init();
    DF.imports.init();
    DF.map.init('map');
    DF.sync.startAuto();
    DF.showTab('map');
    if ('serviceWorker' in navigator && DF.cfg.SW !== false) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
      navigator.serviceWorker.addEventListener('message', e => { if (e.data === 'df-flush') DF.sync.flush(); });
    }
    DF.ready = true;
    DF.bus.emit('app:ready');
  }
  document.addEventListener('DOMContentLoaded', () => boot().catch(e => console.error('[DF] boot', e)));
})();
