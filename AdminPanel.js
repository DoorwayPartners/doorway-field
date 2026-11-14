// Doorway Field v2.0 — AdminPanel (Owner; Managers see Import, Imports and the Outbox): Campaign Manager, Roster (names, roles,
// teams, campaigns, ring colours, optional PINs: zero emails), Status Pin Inventory, Offline Event Sync Outbox (pending pill + Sync URL).
// Saved on this device until the Doorway Field API ships; the API re-checks every owner/manager action.
(function () {
  'use strict';
  const DF = window.DF;
  const $ = s => DF.$(s);
  const slug = s => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const COLOR = /^#[0-9a-f]{6}$/i;

  // ---- campaigns ----
  function renderCampaigns() {
    $('#camp-list').innerHTML = DF.campaigns().map(c => '<span class="chip-c">' + DF.esc(c) + '</span>').join('');
  }
  async function addCampaign(name) {
    name = String(name || '').trim().slice(0, 40); if (!name || !DF.isOwner() || DF.campaigns().includes(name)) return false;
    await DF.sync.setMeta('campaigns', DF.campaigns().concat([name]));
    DF.sync.append({ type: 'campaigns', campaigns: DF.campaigns() });
    renderCampaigns(); DF.renderCampaigns(); DF.bus.emit('campaigns:changed'); DF.toast('Campaign added: ' + name);
    return true;
  }

  // ---- roster ----
  function renderRoster() {
    $('#roster-body').innerHTML = DF.roster.all().map(r => '<tr data-id="' + DF.esc(r.id) + '"><td><i class="dot rc-' + DF.esc(r.id) + '"></i>' + DF.esc(r.name) + '</td><td>' + DF.esc(r.role) + '</td><td>' + DF.esc(r.team || '') +
      '</td><td>' + DF.esc((r.campaigns || []).includes('*') ? 'All' : (r.campaigns || []).join(', ')) + '</td><td>' + (r.pin ? 'PIN' : '—') + '</td><td><button type="button" class="btn r-edit">Edit</button>' + (r.role !== 'Owner' ? ' <button type="button" class="btn r-inv">Copy Invite Link</button>' : '') + '</td></tr>').join('');
    DF.$$('#roster-body .r-edit').forEach(b => b.addEventListener('click', () => editRep(b.closest('tr').dataset.id)));
    DF.$$('#roster-body .r-inv').forEach(b => b.addEventListener('click', () => copyInvite(b.closest('tr').dataset.id)));
    $('#rf-camps').innerHTML = ['*'].concat(DF.campaigns()).map(c => '<label class="chk"><input type="checkbox" value="' + DF.esc(c) + '"> ' + DF.esc(c === '*' ? 'All campaigns' : c) + '</label>').join('');
    DF.ringCss();
  }
  function editRep(id) {
    const r = DF.roster.get(id) || { id: '', name: '', role: 'Agent', team: '', campaigns: [], color: '#00a3a3' };
    $('#rf-id').value = r.id; $('#rf-name').value = r.name; $('#rf-role').value = r.role; $('#rf-team').value = r.team || ''; $('#rf-color').value = COLOR.test(r.color) ? r.color : '#00a3a3';
    $('#rf-pin').value = ''; DF.$$('#rf-camps input').forEach(i => { i.checked = (r.campaigns || []).includes(i.value); });
    $('#roster-form').hidden = false;
  }
  async function saveRep(e) {
    if (e) e.preventDefault();
    if (!DF.isOwner()) return null;
    const name = $('#rf-name').value.trim(); if (!name) return null;
    const list = DF.roster.all().map(x => Object.assign({}, x)), old = list.find(x => x.id === $('#rf-id').value);
    const r = old || { id: slug(name) };
    if (!old && list.some(x => x.id === r.id)) r.id += '-' + list.length;
    Object.assign(r, { name, role: $('#rf-role').value, team: $('#rf-team').value.trim(), color: COLOR.test($('#rf-color').value) ? $('#rf-color').value : '#888888',
      campaigns: DF.$$('#rf-camps input').filter(i => i.checked).map(i => i.value) });
    const pin = $('#rf-pin').value.trim();
    if (pin === '-') delete r.pin; else if (/^\d{4,8}$/.test(pin)) r.pin = DF.hash(r.id + ':' + pin);   // convenience lock, not real security
    if (!old) list.push(r);
    if (!list.some(x => x.role === 'Owner')) { DF.toast('Keep at least one Owner'); return null; }
    await DF.roster.save(list);
    DF.sync.append({ type: 'roster', roster: list });                       // to the private Sync endpoint, never into source
    $('#roster-form').hidden = true; renderRoster(); DF.toast('Roster saved: ' + name);
    if (r.id === DF.auth.id) DF.setUser(r.id);
    return r;
  }

  // ---- 1-tap invite link: ?invite=<repId>&role=<role>&name=<name>[&camp=<campaigns>] → the rep's phone sets itself up (never an Owner) ----
  function inviteUrl(r) {
    const u = new URL(location.href.split('#')[0].split('?')[0]);
    u.searchParams.set('invite', r.id); u.searchParams.set('role', r.role); u.searchParams.set('name', r.name);
    const c = (r.campaigns || []).filter(x => x !== '*'); if (c.length) u.searchParams.set('camp', c.join(','));
    return u.toString();
  }
  async function copyInvite(id) {
    const r = DF.roster.get(id); if (!r || !DF.isOwner() || r.role === 'Owner') return null;
    const url = inviteUrl(r); $('#invite-out').value = url; $('#invite-row').hidden = false;
    try { await navigator.clipboard.writeText(url); DF.toast('Invite link copied for ' + r.name); }
    catch (e) { $('#invite-out').select(); DF.toast('Invite link ready: copy it from the box'); }
    return url;
  }

  // ---- Status Pin Inventory ----
  const FLAGS = [['menu', 'Menu'], ['knock', 'Knock'], ['contact', 'Contact'], ['lock', 'Soft-lock']];
  function renderInventory() {
    $('#inv-body').innerHTML = DF.sync.STATUS.map(s => '<tr data-code="' + s.code + '"><td><button type="button" class="pin-pv" aria-label="Edit ' + DF.esc(s.label) + ' pin"><img alt="" src="' + DF.pins.pinUrl(s, '#ffffff') +
      '"></button> <span class="status-chip chip-' + s.code + '">' + DF.esc(s.short) + '</span></td>' +
      '<td><input class="i-label" value="' + DF.esc(s.label) + '" maxlength="30"></td><td><input class="i-icon" value="' + DF.esc(s.icon) + '" maxlength="2"></td><td><input class="i-color" type="color" value="' + (COLOR.test(s.color) ? s.color : '#888888') + '"></td>' +
      FLAGS.map(f => '<td><input type="checkbox" class="i-' + f[0] + '"' + (s[f[0]] ? ' checked' : '') + (f[0] === 'lock' && s.code === 'SOLD' ? ' disabled title="SOLD is never locked"' : '') + '></td>').join('') + '</tr>').join('');
  }
  async function saveInventory() {
    if (!DF.isManager()) return null;
    const over = {};
    DF.$$('#inv-body tr').forEach(tr => {
      const code = tr.dataset.code, d = DF.sync.DEFAULTS.find(x => x.code === code), v = { label: DF.$('.i-label', tr).value.trim() || d.label, icon: DF.$('.i-icon', tr).value.trim() || d.icon,
        color: COLOR.test(DF.$('.i-color', tr).value) ? DF.$('.i-color', tr).value : d.color };
      FLAGS.forEach(f => { v[f[0]] = DF.$('.i-' + f[0], tr).checked ? 1 : 0; });
      if (code === 'SOLD') v.lock = 0;                                    // owner rule: SOLD stays editable / resettable
      const diff = {}; Object.keys(v).forEach(k => { if (v[k] !== d[k]) diff[k] = v[k]; });
      if (Object.keys(diff).length) over[code] = diff;
    });
    await DF.sync.setMeta('statuses', over);
    renderInventory(); DF.ringCss(); DF.pins.paint(); DF.toast('Status Pin Inventory saved');
    return over;
  }

  // ---- Offline Event Sync Outbox ----
  function renderOutbox() {
    const q = DF.sync.outbox();
    $('#outbox-pill').textContent = q.length + ' pending';
    $('#outbox-pill').className = 'pill-count' + (q.length ? ' warn' : '');
    if (!$('#sync-url').dataset.dirty) $('#sync-url').value = DF.sync.meta('sync_url') || DF.cfg.API_URL || '';   // never overwrite what the owner is typing
    $('#sync-url').disabled = !DF.isOwner();
    $('#outbox-body').innerHTML = q.slice(-15).reverse().map(e => '<tr><td>' + DF.esc(e.type) + (e.to ? ' → ' + DF.esc(e.to) : '') + '</td><td>' + DF.esc(e.campaign || '') + '</td><td>' + DF.esc(DF.roster.name(e.rep)) +
      '</td><td>' + DF.fmtTime(e.device_ts) + '</td></tr>').join('') || '<tr><td colspan="4" class="empty">Outbox empty</td></tr>';
    return q.length;
  }
  async function saveSyncUrl() {
    if (!DF.isOwner()) return;
    const v = $('#sync-url').value.trim();
    if (v && !/^https:\/\//.test(v)) { DF.toast('Sync URL must start with https://'); return; }
    delete $('#sync-url').dataset.dirty;
    await DF.sync.setMeta('sync_url', v); DF.toast(v ? 'Sync URL saved' : 'Sync URL cleared (local-only)'); DF.sync.flush();
  }

  function render() { renderCampaigns(); renderRoster(); renderInventory(); renderOutbox(); }
  function init() {
    $('#camp-add').addEventListener('click', () => { addCampaign($('#camp-name').value); $('#camp-name').value = ''; });
    $('#roster-add').addEventListener('click', () => editRep(''));
    $('#roster-form').addEventListener('submit', saveRep);
    $('#rf-cancel').addEventListener('click', () => { $('#roster-form').hidden = true; });
    $('#inv-save').addEventListener('click', saveInventory);
    $('#inv-reset').addEventListener('click', async () => { if (!DF.isManager()) return; await DF.sync.setMeta('statuses', {}); renderInventory(); DF.ringCss(); });
    $('#sync-url-save').addEventListener('click', saveSyncUrl);
    $('#sync-url').addEventListener('input', () => { $('#sync-url').dataset.dirty = '1'; });
    $('#sync-now').addEventListener('click', () => DF.sync.flush().then(renderOutbox));
    DF.bus.on('tab:changed', t => { if (t === 'admin') render(); });
    DF.bus.on('dispo:queued', () => { if (DF.currentTab === 'admin') renderOutbox(); });
    DF.bus.on('sync:state', () => { if (DF.currentTab === 'admin') renderOutbox(); });
  }

  DF.admin = { init, render, addCampaign, editRep, saveRep, inviteUrl, copyInvite, renderInventory, saveInventory, renderOutbox, saveSyncUrl, slug };
})();
