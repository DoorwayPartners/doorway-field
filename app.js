// Doorway Field v2.0 — app core: namespace, bus, roster sign-in (name + optional PIN), roles, campaign switcher, tabs, toast, boot.
// Roles are client-side until the Doorway Field API ships (the API re-checks every owner/manager action). 0 AI calls.
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
    auth: { id: '', name: '', role: 'Agent', team: '', campaigns: [], color: '#ffffff' },
    campaign: '*', lastFlipMs: null, lastCardMs: null
  };
  DF.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  DF.fmtTime = iso => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
  DF.hash = s => { let h1 = 0x811c9dc5, h2 = 0x01000193, i, c; s = String(s); for (i = 0; i < s.length; i++) { c = s.charCodeAt(i); h1 ^= c; h1 = Math.imul(h1, 16777619) >>> 0; h2 ^= c + i; h2 = Math.imul(h2, 2246822519) >>> 0; } return ('0000000' + h1.toString(16)).slice(-8) + ('0000000' + h2.toString(16)).slice(-8); };

  // ---- roster (seeded from config, edited in Admin, kept on the device until the API ships) ----
  DF.roster = {
    all: () => DF.sync.meta('roster') || DF.cfg.ROSTER,
    get: key => { key = String(key || '').toLowerCase(); return DF.roster.all().find(r => r.id === key || (r.email && r.email.toLowerCase() === key) || r.name.toLowerCase() === key) || null; },
    name: key => { if (!key) return 'Unassigned'; const r = DF.roster.get(key); return r ? r.name : String(key); },
    color: key => { const r = DF.roster.get(key); return r ? r.color : '#ffffff'; },
    save: list => DF.sync.setMeta('roster', list).then(() => DF.bus.emit('roster:changed'))
  };
  DF.firstName = key => { const p = DF.roster.name(key).split(/[\s@]/); return /^\d+$/.test(p[1] || '') ? p[0] + ' ' + p[1] : p[0]; };   // 'Agent 1' stays whole
  DF.isOwner = () => DF.auth.role === 'Owner';
  DF.isManager = () => DF.auth.role === 'Owner' || DF.auth.role === 'Manager';
  DF.campaigns = () => (DF.sync.meta('campaigns') || DF.cfg.CAMPAIGNS).filter(Boolean);
  DF.myCampaigns = () => DF.isManager() || (DF.auth.campaigns || []).includes('*') ? DF.campaigns() : DF.campaigns().filter(c => DF.auth.campaigns.includes(c));
  DF.inCampaign = lead => DF.campaign === '*' ? DF.myCampaigns().includes(lead.campaign) : lead.campaign === DF.campaign;

  // ---- toast with optional action (5 s undo) ----
  let toastTimer = null;
  DF.toast = function (msg, actionLabel, action, ms) {
    const t = DF.$('#toast'), btn = DF.$('#toast-action');
    DF.$('#toast-msg').textContent = msg;
    btn.hidden = !actionLabel; btn.textContent = actionLabel || '';
    btn.onclick = () => { t.classList.remove('show'); if (action) action(); };
    t.classList.add('show'); clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2500);
  };
  DF.openModal = id => DF.$('#' + id).classList.add('open');
  DF.closeModal = id => DF.$('#' + id).classList.remove('open');

  // ---- campaign switcher: compact pill in the top bar ----
  function renderCampaigns() {
    const opts = (DF.isManager() ? [['*', 'All Campaigns']] : []).concat(DF.myCampaigns().map(c => [c, c]));
    if (!opts.some(o => o[0] === DF.campaign)) DF.campaign = opts.length ? opts[0][0] : DF.cfg.DEFAULT_CAMPAIGN;
    DF.$('#campaign-pill').textContent = (DF.campaign === '*' ? 'All Campaigns' : DF.campaign) + ' ▾';
    DF.$('#campaign-menu').innerHTML = opts.map(o => '<button type="button" data-c="' + DF.esc(o[0]) + '" class="' + (o[0] === DF.campaign ? 'on' : '') + '">' + DF.esc(o[1]) + '</button>').join('');
    DF.$$('#campaign-menu button').forEach(b => b.addEventListener('click', () => DF.setCampaign(b.dataset.c)));
  }
  DF.setCampaign = c => {
    DF.campaign = c; DF.store.set('campaign.' + DF.auth.id, c);
    DF.$('#campaign-menu').classList.remove('open'); renderCampaigns();
    DF.bus.emit('campaign:changed', c); DF.bus.emit('pins:changed', { all: true });
  };
  DF.renderCampaigns = renderCampaigns;

  // ---- sign-in: pick your name from the roster (+ PIN if one is set). Honour system until the API verifies identity. ----
  function setUser(id) {
    const r = DF.roster.get(id); if (!r) return false;
    Object.assign(DF.auth, { id: r.id, name: r.name, role: r.role, team: r.team || '', campaigns: r.campaigns || [], color: r.color || '#ffffff' });
    DF.store.set('user', { id: r.id });
    DF.campaign = DF.store.get('campaign.' + r.id, DF.isManager() ? '*' : (DF.myCampaigns()[0] || DF.cfg.DEFAULT_CAMPAIGN));
    DF.$('#me-name').textContent = r.name.split(' ')[0] + ' · ' + r.role;
    DF.$('#tab-admin').hidden = !DF.isManager();
    document.body.classList.toggle('role-manager', DF.isManager());
    document.body.classList.toggle('role-owner', DF.isOwner());
    renderCampaigns();
    DF.bus.emit('auth:changed', DF.auth);
    return true;
  }
  DF.setUser = setUser;
  DF.signOut = () => { DF.store.set('user', null); location.reload(); };
  function signIn() {
    return new Promise(resolve => {
      const saved = DF.store.get('user', null);
      if (saved && saved.id && setUser(saved.id)) return resolve();
      const sel = DF.$('#signin-name');
      sel.innerHTML = ['Owner', 'Manager', 'Agent'].map(role => '<optgroup label="' + role + 's">' + DF.roster.all().filter(r => r.role === role)
        .map(r => '<option value="' + DF.esc(r.id) + '">' + DF.esc(r.name) + '</option>').join('') + '</optgroup>').join('');
      const showPin = () => { const r = DF.roster.get(sel.value); DF.$('#signin-pin-row').hidden = !(r && r.pin); };
      sel.onchange = showPin; showPin();
      DF.openModal('modal-signin');
      DF.$('#signin-form').onsubmit = e => {
        e.preventDefault();
        const r = DF.roster.get(sel.value);
        if (r.pin && DF.hash(r.id + ':' + DF.$('#signin-pin').value) !== r.pin) { DF.$('#signin-err').textContent = 'Wrong PIN'; return; }
        DF.closeModal('modal-signin'); setUser(r.id); resolve();
      };
    });
  }

  // ---- 4-tab nav ----
  DF.showTab = function (name) {
    if (name === 'admin' && !DF.isManager()) name = 'map';
    DF.$$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    DF.$$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    DF.currentTab = name;
    DF.bus.emit('tab:changed', name);
  };

  async function boot() {
    DF.$$('.tab').forEach(t => t.addEventListener('click', () => DF.showTab(t.dataset.tab)));
    DF.$$('[data-close]').forEach(b => b.addEventListener('click', () => DF.closeModal(b.dataset.close)));
    DF.$('#campaign-pill').addEventListener('click', () => DF.$('#campaign-menu').classList.toggle('open'));
    DF.$('#me-name').addEventListener('click', () => { if (DF.$('#me-name').classList.toggle('armed')) DF.toast('Tap your name again to switch user', 'Switch', DF.signOut, 4000); });
    DF.$('#app-version').textContent = 'v' + DF.cfg.VERSION;
    await DF.sync.open();
    if (!DF.sync.count() && DF.cfg.FIXTURE_URL) {
      try { const fx = await (await fetch(DF.cfg.FIXTURE_URL)).json(); await DF.sync.importRows(fx.pins || fx, { source: 'fixture', silent: true }); }
      catch (e) { console.error('[DF] fixture', e); }
    }
    await signIn();
    ['card', 'filters', 'list', 'stats', 'lasso', 'imports', 'admin', 'pins', 'turf'].forEach(m => DF[m] && DF[m].init && DF[m].init());
    DF.map.init('map');
    DF.tools.init();
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
