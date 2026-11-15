// Doorway Field v2.5.2 — Auth: sign-in sheet (semantic username + password form for Chrome / Google Password Manager autofill), invite links
// (?token= → redeem_invite), Rep ID + PIN server login, 30-day rolling session stored in localStorage AND IndexedDB, re-auth on 401 / auth.
(function () {
  'use strict';
  const DF = window.DF;
  DF.signOut = () => { DF.store.set('user', null); DF.clearSession(); setTimeout(() => location.reload(), 50); };
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
      if (!p || !/^[a-z0-9-]{1,40}$/.test(p.id || p.repId || '')) return null;
      const rep = { id: p.id || p.repId, name: String(p.name || p.id).slice(0, 40), role: p.role === 'Manager' ? 'Manager' : 'Agent', team: String(p.team || '').slice(0, 40),
        campaigns: Array.isArray(p.campaigns || p.campaignAccess) && (p.campaigns || p.campaignAccess).length ? (p.campaigns || p.campaignAccess).map(String) : [DF.cfg.DEFAULT_CAMPAIGN], color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#00a3a3' };
      if (/^[0-9a-f]{16}$/.test(p.pin || p.pinHash || '')) rep.pin = p.pin || p.pinHash;
      await DF.roster.save(DF.roster.all().filter(x => x.id !== rep.id).concat([rep]));
      DF.setSession(j);
      return rep;
    } catch (e) { return null; }
  }
  async function takeInvite() {
    const q = new URLSearchParams(location.search), token = q.get('token');
    if (!token && !q.get('invite')) return null;
    history.replaceState(null, '', location.pathname + location.hash);          // the link is used once; nothing left in the address bar
    DF.inviteMsg = 'Invite not verified (expired, used, or offline). Ask your manager for a new link, or sign in with your Rep ID + PIN.';
    if (!token) { DF.inviteMsg = 'Old-style invite links no longer work. Ask your manager for a new link.'; return null; }
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token) || !(window.crypto && crypto.subtle)) return null;
    const h = await DF.sha256(token), now = Date.now();
    const local = DF.roster.all().find(x => x.role !== 'Owner' && x.invite && x.invite.h === h && x.invite.exp > now);
    const r = local || await redeem(h);
    if (r) DF.inviteMsg = '';
    return r || null;
  }
  // ---- server PIN login (Rep ID + PIN → session). The PIN never leaves the phone: only DF.hash(repId:pin) is sent. ----
  // ---- 30-day rolling session, kept twice (localStorage df.session + IndexedDB meta 'session'): closing the PWA, locking the phone or bouncing to
  // ops / carrier order pages never signs a rep out. Every successful sync renews it (server session_exp) → DF.renewSession. ----
  const DAYS30 = 30 * 864e5, valid = s => !!(s && s.token && (!s.exp || s.exp > Date.now()));
  const session = () => { const s = DF.store.get('session', null); return valid(s) ? s.token : ''; };
  const keep = s => { DF.store.set('session', s); return DF.sync.setMeta('session', s); };
  DF.setSession = j => { if (j && j.session) keep({ token: j.session, exp: Number(j.session_exp) || Date.now() + DAYS30 }); };
  DF.renewSession = exp => { const s = DF.store.get('session', null) || DF.sync.meta('session'); if (valid(s) && Number(exp) > (s.exp || 0)) keep({ token: s.token, exp: Number(exp) }); };
  DF.clearSession = () => { DF.store.set('session', null); DF.sync.setMeta('session', null); };
  function restoreSession() { if (!session() && valid(DF.sync.meta('session'))) DF.store.set('session', DF.sync.meta('session')); }   // localStorage wiped, IndexedDB kept
  DF.session = session;
  // Google Password Manager / Chrome: store the Rep ID + PIN after a good sign-in, offer it back next time (1 tap). Best effort; never blocks.
  const remember = (id, pin, name) => { try { if (window.PasswordCredential && pin) navigator.credentials.store(new PasswordCredential({ id, password: pin, name: name || id })).catch(() => {}); } catch (e) { /* unsupported */ } };
  function offerSaved(fill) {
    try { if (window.PasswordCredential && navigator.credentials) navigator.credentials.get({ password: true, mediation: 'optional' }).then(c => { if (c && c.id && c.password) fill(c.id, c.password); }).catch(() => {}); } catch (e) { /* unsupported */ }
  }
  async function serverLogin(id, pin) {
    const url = DF.sync.syncUrl(); if (!url) return { ok: false, error: 'offline' };
    try {
      const ph = DF.hash(id + ':' + pin), res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'pin_login', rep_id: id, pin_hash: ph, org_id: DF.cfg.ORG_ID }) });
      const j = await res.json(), p = j && j.ok && j.rep; if (!p) return { ok: false, error: (j && j.error) || 'bad_pin' };
      const rep = { id: p.id || p.repId, name: String(p.name || id).slice(0, 40), role: ['Owner', 'Manager'].includes(p.role) ? p.role : 'Agent', team: p.team || '', pin: ph,
        campaigns: Array.isArray(p.campaigns || p.campaignAccess) ? (p.campaigns || p.campaignAccess) : [], color: /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : '#00a3a3' };
      await DF.roster.save(DF.roster.all().filter(x => x.id !== rep.id).concat([Object.assign({}, DF.roster.get(rep.id) || {}, rep)]));
      DF.setSession(j);
      if (rep.role === 'Owner') DF.sync.append({ type: 'roster', roster: DF.roster.all() });   // Owner's first server login uploads the device roster once
      return { ok: true, rep };
    } catch (e) { return { ok: false, error: 'offline' }; }
  }
  // ---- sign-in (v2.4.1 auth lock): a new phone needs an invite token OR Rep ID + PIN. Only reps whose PIN is on this phone (and the invited rep) are
  // listed; nobody can pick a placeholder name without a PIN. A rep with no PIN yet (fresh invite) must set one. ----
  function signIn(inv, opts) {
    opts = opts || {};
    return new Promise(resolve => {
      restoreSession();
      const saved = DF.store.get('user', null), online = !!DF.sync.syncUrl() && navigator.onLine !== false;
      // v2.5: a cached name alone is not enough when online: no valid session → the sheet opens with a clear banner (offline: keep working)
      if (!inv && !DF.inviteMsg && !opts.force && saved && saved.id && (session() || !online) && DF.setUser(saved.id)) return resolve();
      const sel = DF.$('#signin-name'), uname = DF.$('#signin-id'), pinEl = DF.$('#signin-pin'), err = m => { DF.$('#signin-err').textContent = m; };
      DF.$('#signin-banner').hidden = !(opts.banner || (!inv && saved && saved.id));
      const generic = r => /^(Manager|Agent) \d+$/.test(r.name) && !r.pin;                 // public placeholder seats are never offered
      const listed = DF.roster.all().filter(r => (inv && r.id === inv.id) || (saved && r.id === saved.id) || r.pin || (online && !generic(r)));   // tap your name + PIN
      sel.innerHTML = listed.sort((a, b) => a.name.localeCompare(b.name)).map(r => '<option value="' + DF.esc(r.id) + '">' + DF.esc(r.name) + '</option>').join('') + (online ? '<option value="__id">Other rep: enter Rep ID</option>' : '');
      if (inv) { sel.value = inv.id; DF.$('#signin-title').textContent = 'Welcome, ' + inv.name.split(' ')[0]; } else if (saved && DF.roster.get(saved.id)) sel.value = saved.id;
      err(DF.inviteMsg || (!listed.length && !online ? 'This phone is not set up yet: open your invite link.' : ''));
      // semantic username + password pair (autocomplete username / current-password): the name list just fills the Rep ID
      const showPin = () => { const other = sel.value === '__id', r = other ? null : DF.roster.get(sel.value), setPin = !!(r && !r.pin && inv && r.id === inv.id);
        if (r) uname.value = r.id; else if (other && DF.roster.get(uname.value)) uname.value = '';
        DF.$('#signin-pin-row').hidden = !(other || r); DF.$('#signin-pin-label').textContent = setPin ? 'Set your PIN (4-8 digits)' : 'PIN / Password';
        pinEl.autocomplete = setPin ? 'new-password' : 'current-password'; };
      sel.onchange = showPin; showPin();
      uname.oninput = () => { const id = uname.value.trim().toLowerCase(); sel.value = DF.roster.get(id) && Array.from(sel.options).some(o => o.value === id) ? id : (online ? '__id' : sel.value); DF.$('#signin-pin-row').hidden = false; };
      if (!inv) offerSaved((id, pw) => { uname.value = id; uname.oninput(); pinEl.value = pw; });
      DF.openModal('modal-signin');
      const done = async (id, after) => { DF.closeModal('modal-signin'); DF.setUser(id); remember(id, pinEl.value.trim(), (DF.roster.get(id) || {}).name); DF.setCampaign(DF.defaultCampaign(DF.roster.get(id)));
        if (after) await Promise.race([Promise.resolve(after()), new Promise(r => setTimeout(r, 4000))]);   // session first, so the first auto-sync after sign-in is authorized
        resolve(); };
      DF.$('#signin-form').onsubmit = async e => {
        e.preventDefault();
        const pin = pinEl.value.trim(), typed = uname.value.trim().toLowerCase();
        if (sel.value === '__id' || (typed && typed !== sel.value)) {
          const id = typed;
          if (id.includes('@')) return err('Sign in with your Rep ID (ask your manager)');
          if (!/^[a-z0-9-]{1,40}$/.test(id) || !/^\d{4,8}$/.test(pin)) return err('Enter your Rep ID and 4-8 digit PIN');
          const res = await serverLogin(id, pin);
          if (!res.ok) return err(res.error === 'locked' ? 'Too many tries: wait 15 minutes' : res.error === 'offline' ? 'No connection: try again' : 'Wrong Rep ID or PIN');
          return done(res.rep.id);
        }
        const r = DF.roster.get(sel.value); if (!r) return err('Pick your name');
        if (r.pin) {
          if (DF.hash(r.id + ':' + pin) !== r.pin) return err('Wrong PIN');
          return done(r.id, () => { if (online && !session()) serverLogin(r.id, pin); });   // get a sync session in the background
        }
        if (!(inv && r.id === inv.id)) {                                        // name from the roster, PIN not on this phone: the Sync API checks it
          if (!/^\d{4,8}$/.test(pin)) return err('Enter your 4-8 digit PIN');
          const res = await serverLogin(r.id, pin);
          if (!res.ok) return err(res.error === 'locked' ? 'Too many tries: wait 15 minutes' : res.error === 'offline' ? 'No connection: try again' : 'Wrong PIN');
          return done(res.rep.id);
        }
        if (!/^\d{4,8}$/.test(pin)) return err('Set a 4-8 digit PIN');                       // invited rep without a PIN: one is required now
        const ph = DF.hash(r.id + ':' + pin);
        await DF.roster.save(DF.roster.all().map(x => x.id === r.id ? Object.assign({}, x, { pin: ph }) : x));
        done(r.id, () => { if (online) DF.sync.append({ type: 'pin_set', pin_hash: ph }); });
      };
    });
  }
  // server said 401 / auth: open the sign-in sheet right away (banner), then sync. Data on the phone is kept.
  DF.reauth = () => { if (DF.$('#modal-signin').classList.contains('open')) return; DF.clearSession(); signIn(null, { force: true, banner: true }).then(() => DF.sync.flush()); };
  DF.bus.on('sync:auth', DF.reauth);
  DF.signIn = signIn; DF.takeInvite = takeInvite;
})();
