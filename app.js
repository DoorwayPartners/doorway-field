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
  // ---- invite links (Admin › Roster › Copy Invite Link) = ?token=<128-bit random>. No role, name or id in the URL. The phone hashes the token
  // (SHA-256) and resolves it against the authorized roster: this device's roster first, then the private Sync endpoint (action redeem_invite).
  // The role always comes from that roster, never from the URL, and a link can never sign anyone in as Owner.
  const b64url = a => btoa(String.fromCharCode.apply(null, Array.from(a))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  DF.newToken = () => b64url(crypto.getRandomValues(new Uint8Array(16)));
  DF.sha256 = async s => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map(x => ('0' + x.toString(16)).slice(-2)).join('');
  async function redeem(h) {
    const url = DF.sync.syncUrl(); if (!url) return null;
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'redeem_invite', token_hash: h, org_id: DF.cfg.ORG_ID }) });
      const j = await res.json(), p = j && j.ok && j.rep;
      if (!p || !/^[a-z0-9-]{1,40}$/.test(p.id)) return null;
      const rep = { id: p.id, name: String(p.name || p.id).slice(0, 40), role: p.role === 'Manager' ? 'Manager' : 'Agent', team: String(p.team || '').slice(0, 40),
        campaigns: Array.isArray(p.campaigns) && p.campaigns.length ? p.campaigns.map(String) : [DF.cfg.DEFAULT_CAMPAIGN], color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#00a3a3' };
      if (/^[0-9a-f]{16}$/.test(p.pin || '')) rep.pin = p.pin;
      await DF.roster.save(DF.roster.all().filter(x => x.id !== rep.id).concat([rep]));
      return rep;
    } catch (e) { return null; }
  }
  async function takeInvite() {
    const q = new URLSearchParams(location.search), token = q.get('token');
    if (!token && !q.get('invite')) return null;
    history.replaceState(null, '', location.pathname + location.hash);          // the link is used once; nothing left in the address bar
    DF.inviteMsg = 'Invite not verified (expired, used, or offline). Ask your manager for a new link, or pick your name.';
    if (!token) { DF.inviteMsg = 'Old-style invite links no longer work. Ask your manager for a new link.'; return null; }
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token) || !(window.crypto && crypto.subtle)) return null;
    const h = await DF.sha256(token), now = Date.now();
    const local = DF.roster.all().find(x => x.role !== 'Owner' && x.invite && x.invite.h === h && x.invite.exp > now);
    const r = local || await redeem(h);
    if (r) DF.inviteMsg = '';
    return r || null;
  }
  function signIn(inv) {
    return new Promise(resolve => {
      const saved = DF.store.get('user', null);
      if (!inv && !DF.inviteMsg && saved && saved.id && setUser(saved.id)) return resolve();
      const sel = DF.$('#signin-name');
      sel.innerHTML = ['Owner', 'Manager', 'Agent'].map(role => '<optgroup label="' + role + 's">' + DF.roster.all().filter(r => r.role === role)
        .map(r => '<option value="' + DF.esc(r.id) + '">' + DF.esc(r.name) + '</option>').join('') + '</optgroup>').join('');
      if (inv) { sel.value = inv.id; DF.$('#signin-title').textContent = 'Welcome, ' + inv.name.split(' ')[0]; }
      DF.$('#signin-err').textContent = DF.inviteMsg || '';
      const showPin = () => { const r = DF.roster.get(sel.value), setNew = !!(inv && r && r.id === inv.id && !r.pin);
        DF.$('#signin-pin-row').hidden = !(r && (r.pin || setNew)); DF.$('#signin-pin-label').textContent = setNew ? 'Set a PIN (optional, 4-8 digits)' : 'PIN'; };
      sel.onchange = showPin; showPin();
      DF.openModal('modal-signin');
      DF.$('#signin-form').onsubmit = e => {
        e.preventDefault();
        const r = DF.roster.get(sel.value);
        const pin = DF.$('#signin-pin').value.trim();
        if (r.pin && DF.hash(r.id + ':' + pin) !== r.pin) { DF.$('#signin-err').textContent = 'Wrong PIN'; return; }
        if (!r.pin && inv && r.id === inv.id && pin) {
          if (!/^\d{4,8}$/.test(pin)) { DF.$('#signin-err').textContent = 'PIN = 4-8 digits (or leave it blank)'; return; }
          DF.roster.save(DF.roster.all().map(x => x.id === r.id ? Object.assign({}, x, { pin: DF.hash(r.id + ':' + pin) }) : x));
        }
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
    await signIn(await takeInvite());
    ['card', 'filters', 'list', 'stats', 'lasso', 'imports', 'admin', 'pins', 'turf', 'pwa'].forEach(m => DF[m] && DF[m].init && DF[m].init());
    DF.map.init('map');
    DF.tools.init();
    DF.sync.startAuto();
    DF.showTab('map');
    if ('serviceWorker' in navigator && DF.cfg.SW !== false) {
      navigator.serviceWorker.register('sw.js').then(reg => DF.pwa && DF.pwa.watch(reg)).catch(() => {});
      navigator.serviceWorker.addEventListener('message', e => { if (e.data === 'df-flush') DF.sync.flush(); });
    }
    DF.ready = true;
    DF.bus.emit('app:ready');
  }
  document.addEventListener('DOMContentLoaded', () => boot().catch(e => console.error('[DF] boot', e)));
})();
