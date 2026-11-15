// Doorway Field v2.0 — OfflineSync: Doorway_Lead_Schema v2 (org_id + campaign + 19 fields + created_at), editable status inventory,
// IndexedDB, append-only event log (status / assign / note / gps_fix …), offline outbox, background flush, conflict-safe merge.
(function () {
  'use strict';
  const DF = window.DF;
  const FIELDS = ['org_id', 'campaign', 'turf_id', 'lead_id', 'lat', 'lng', 'address', 'apt', 'city', 'state', 'zip', 'first_name', 'last_name',
    'phone', 'email', 'status_code', 'turf_intel_note', 'rep_note', 'appt_at', 'assigned_rep_email', 'created_at', 'updated_at'];
  // Defaults; Admin › Status Pin Inventory overrides label / colour / icon / menu / knock / contact / lock (meta 'statuses').
  // assigned_rep_email holds the rep key: a roster id (no emails in source) or an email that came in on a CSV.
  const DEFAULTS = [
    ['NEW', 'Prospects (New)', 'New', '#58C322', '⌖', 1, 0, 0], ['NH1', 'Not Home 1', 'NH1', '#7cc4f5', '?', 1, 1, 0], ['NH2', 'Not Home 2', 'NH2', '#3a8fe0', '?', 1, 1, 0],
    ['NH3', 'Not Home 3', 'NH3', '#1c4f9c', '?', 1, 1, 0], ['GB', 'Go Back', 'GB', '#ff5fa2', '↺', 1, 1, 1], ['P_GB', 'Pitched – Go Back', 'P GB', '#f2b705', '🔒', 1, 1, 1],
    ['SOLD', 'Sold', 'SOLD', '#1e8e3e', '$', 1, 1, 1], ['NI', 'Not Interested', 'NI', '#e53935', '✕', 1, 1, 1], ['APPT', 'Appointment', 'APPT', '#00a3a3', '◷', 1, 1, 1],
    ['PVL', 'Possible Vacant Lot', 'PVL', '#a68a64', '▢', 1, 0, 0], ['CCI', 'CCI', 'CCI', '#2d9cdb', 'C', 0, 0, 0], ['CST', 'Existing Customer', 'Cust', '#2350d8', '✓', 0, 0, 0]
  ].map(a => ({ code: a[0], label: a[1], short: a[2], color: a[3], icon: a[4], menu: a[5], knock: a[6], contact: a[7], lock: 0, ring: a[0] === 'CST' ? 1 : 0 }));
  const STATUS = DEFAULTS.map(s => Object.assign({}, s)), BY_CODE = {};
  const ALIAS = { 'P GB': 'P_GB', PGB: 'P_GB', PROSPECT: 'NEW', CCI_PROSPECT: 'CCI', CUSTOMER: 'CST', EXISTING_CUSTOMER: 'CST', 'EXISTING CUSTOMER': 'CST' };
  function applyStatuses(over) {
    over = over || {}; STATUS.length = 0; Object.keys(BY_CODE).forEach(k => delete BY_CODE[k]);
    DEFAULTS.forEach(d => STATUS.push(Object.assign({}, d, over[d.code] || {}, { code: d.code })));
    // v2.2: dispositions are locked to the official set. Custom codes saved by v2.1 are ignored so exports + reporting stay uniform.
    STATUS.forEach(s => { BY_CODE[s.code] = s; });
    DF.bus.emit('statuses:changed');
  }
  applyStatuses();

  const leads = new Map(), queue = new Map();
  let events = [], meta = {}, db = null, flushTimer = null, flushing = false;

  // ---- schema ----
  const normAddr = s => String(s || '').toUpperCase().replace(/[.,#]/g, ' ').replace(/\s+/g, ' ').trim();
  const leadId = (address, apt, zip) => 'DL-' + DF.hash([normAddr(address), normAddr(apt), String(zip || '').trim()].join('|'));   // = DoorwayCore.hash_
  const statusCode = v => { const u = String(v || '').trim().toUpperCase(); return ALIAS[u] || (BY_CODE[u] ? u : u.replace(/\s+/g, '_')); };
  function normalize(r) {
    const o = {};
    FIELDS.forEach(f => { o[f] = r[f] == null ? '' : String(r[f]).trim(); });
    o.org_id = o.org_id || DF.cfg.ORG_ID;
    o.campaign = o.campaign || DF.cfg.DEFAULT_CAMPAIGN;
    o.lat = r.lat === '' || r.lat == null ? NaN : Math.round(Number(r.lat) * 1e6) / 1e6;
    o.lng = r.lng === '' || r.lng == null ? NaN : Math.round(Number(r.lng) * 1e6) / 1e6;
    o.state = o.state.toUpperCase().slice(0, 2);
    o.zip = o.zip ? o.zip.replace(/\D/g, '').slice(0, 5).padStart(5, '0') : '';
    o.email = o.email.toLowerCase();
    o.assigned_rep_email = o.assigned_rep_email.toLowerCase();
    o.status_code = statusCode(o.status_code || 'NEW');
    o.turf_intel_note = o.turf_intel_note.slice(0, 500);
    o.rep_note = o.rep_note.slice(0, 500);
    o.lead_id = o.lead_id || leadId(o.address, o.apt, o.zip);
    o.updated_at = o.updated_at || new Date().toISOString();
    o.created_at = o.created_at || o.updated_at;
    if (r._deleted) o._deleted = true;
    return o;
  }
  function validate(o) {
    const errs = [];
    if (!isFinite(o.lat) || Math.abs(o.lat) > 90 || !isFinite(o.lng) || Math.abs(o.lng) > 180 || (o.lat === 0 && o.lng === 0)) errs.push('missing/invalid lat,lng');
    if (!o.address) errs.push('missing address');
    if (!BY_CODE[o.status_code]) errs.push('unknown status ' + o.status_code);
    if (o.zip && !/^\d{5}$/.test(o.zip)) errs.push('bad zip');
    return errs;
  }
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2));

  // ---- IndexedDB ----
  function idb(store, mode, fn) {
    if (!db) return Promise.resolve();
    return new Promise((res, rej) => { const tx = db.transaction(store, mode), out = fn(tx.objectStore(store)); tx.oncomplete = () => res(out && out.result); tx.onerror = () => rej(tx.error); });
  }
  const getAll = store => idb(store, 'readonly', s => s.getAll());
  const putMany = (store, rows) => rows.length ? idb(store, 'readwrite', s => { rows.forEach(r => s.put(r)); }) : Promise.resolve();
  function open() {
    return new Promise(resolve => {
      if (!window.indexedDB) return resolve();
      const req = indexedDB.open('doorway_field', 1);
      req.onupgradeneeded = () => ['leads:lead_id', 'queue:event_id', 'events:event_id', 'meta:k'].forEach(x => { const [n, k] = x.split(':'); req.result.createObjectStore(n, { keyPath: k }); });
      req.onsuccess = async () => {
        db = req.result;
        (await getAll('meta')).forEach(m => { meta[m.k] = m.v; });
        applyStatuses(meta.statuses);
        const migrated = [];
        (await getAll('leads')).forEach(r => { if (!r.campaign || !r.created_at) { r = normalize(r); migrated.push(r); } leads.set(r.lead_id, r); });   // v1 -> v2 rows
        await putMany('leads', migrated);
        events = (await getAll('events')).sort((a, b) => a.device_ts < b.device_ts ? -1 : 1);
        (await getAll('queue')).forEach(e => queue.set(e.event_id, e));
        resolve();
      };
      req.onerror = () => resolve();
    });
  }
  const setMeta = (k, v) => { meta[k] = v; if (k === 'statuses') applyStatuses(v); return putMany('meta', [{ k, v }]); };

  // ---- import (fixture, CSV, API): dedupe on address + apt + zip; one door = one lead (campaign is an attribute) ----
  async function importRows(rows, opts) {
    opts = opts || {};
    const report = { added: 0, updated: 0, rejected: [], ids: [] }, changed = [];
    rows.forEach((raw, i) => {
      if (/^(DNC|EXCLUDED_DNC)$/i.test(String(raw.lead_type || raw.status_code || ''))) { report.rejected.push({ row: i + 1, reason: 'DNC is never imported' }); return; }
      const o = normalize(Object.assign({}, raw, opts.campaign ? { campaign: opts.campaign } : {})), errs = validate(o);
      if (errs.length) { report.rejected.push({ row: i + 1, reason: errs.join('; ') }); return; }
      const cur = leads.get(o.lead_id);
      if (cur && !cur._deleted) { FIELDS.forEach(f => { if (o[f] !== '' && !['status_code', 'updated_at', 'created_at'].includes(f)) cur[f] = o[f]; }); changed.push(cur); report.updated++; }
      else { leads.set(o.lead_id, o); changed.push(o); report.added++; report.ids.push(o.lead_id); }
    });
    await putMany('leads', changed);
    if (!opts.silent) DF.bus.emit('pins:changed', { all: true });
    return report;
  }

  // ---- mutations: memory first (sync) -> IndexedDB + outbox (async). Every event carries campaign + rep + device time. ----
  function append(ev) {
    ev = Object.assign({ event_id: uuid(), org_id: DF.cfg.ORG_ID, rep: DF.auth.id, device_ts: new Date().toISOString() }, ev);
    events.push(ev); queue.set(ev.event_id, ev);
    Promise.resolve().then(() => Promise.all([putMany('events', [ev]), putMany('queue', [ev])])).catch(e => console.error('[DF] idb', e));
    if (queue.size >= 25) scheduleFlush(1500);                             // v2.4.2: batched (120 s / screen-off / manual Sync), not per tap
    return ev;
  }
  function mutate(id, patch, type, extra) {
    const row = leads.get(id); if (!row) return null;
    const from = row.status_code, before = row.assigned_rep_email;
    Object.assign(row, patch, { updated_at: new Date().toISOString() });
    const ev = append(Object.assign({ lead_id: id, campaign: row.campaign, type: type || 'edit', from: patch.status_code !== undefined ? from : '',
      to: patch.status_code || '', patch, prev_rep: patch.assigned_rep_email !== undefined ? before : undefined }, extra || {}));
    putMany('leads', [row]).catch(e => console.error('[DF] idb', e));
    DF.bus.emit('dispo:queued', ev);
    return ev;
  }
  function undo(ev) {
    if (!ev) return;
    const patch = {}; Object.keys(ev.patch).forEach(k => { patch[k] = k === 'status_code' ? ev.from : k === 'assigned_rep_email' ? ev.prev_rep || '' : ''; });
    mutate(ev.lead_id, patch, 'undo', { undo_of: ev.event_id });
  }
  const removeMany = (ids, why) => ids.filter(id => leads.get(id) && !leads.get(id)._deleted).map(id => mutate(id, { _deleted: true }, 'delete', { why: why || '' }));

  function drop(ids) {                                                     // local-only removal (no delete event), skipped while this phone has pending edits
    const pending = new Set(Array.from(queue.values()).map(e => e.lead_id)), out = ids.filter(id => leads.has(id) && !pending.has(id));
    out.forEach(id => leads.delete(id));
    if (out.length) { idb('leads', 'readwrite', s => { out.forEach(id => s.delete(id)); }); DF.bus.emit('pins:changed', { all: true }); }
    return out.length;
  }
  // ---- merge: server row wins only if newer AND this device has no pending events for that lead ----
  function merge(serverRows) {
    const pending = new Set(Array.from(queue.values()).map(e => e.lead_id)), changed = [];
    (serverRows || []).forEach(raw => { const s = normalize(raw), cur = leads.get(s.lead_id); if (!cur || (!pending.has(s.lead_id) && s.updated_at > cur.updated_at)) { leads.set(s.lead_id, s); changed.push(s); } });
    if (changed.length) { putMany('leads', changed); DF.bus.emit('pins:changed', { ids: changed.map(r => r.lead_id) }); }
    return changed.length;
  }

  // ---- flush: text/plain POST (no CORS preflight for Apps Script), idempotent on event_id ----
  const syncUrl = () => meta.sync_url || DF.cfg.API_URL;
  async function flush(opts) {
    if (flushing) return { skipped: true };
    if (!syncUrl() || navigator.onLine === false) { DF.bus.emit('sync:state', !syncUrl() ? 'local' : queue.size ? 'pending' : 'offline'); return { skipped: true }; }   // 'local' = no Sync URL at all, never just offline
    flushing = true; DF.bus.emit('sync:state', 'syncing');
    const batch = Array.from(queue.values()).slice(0, 200);
    try {
      const payload = JSON.stringify({ action: 'sync', org_id: DF.cfg.ORG_ID, rep: DF.auth.id, session: (DF.store.get('session', null) || {}).token || '', since: meta.since || '', day_start: new Date(new Date().setHours(0, 0, 0, 0)).toISOString(), events: batch });
      const res = await fetch(syncUrl(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: payload,
        keepalive: !!(opts && opts.hidden) && payload.length < 60000 });   // screen-off flush survives the app going to the background
      const j = await res.json();
      if (!j.ok && j.error === 'auth') DF.bus.emit('sync:auth');                          // no / expired session: the app asks for the PIN again
      if (!j.ok) throw new Error(j.error || 'sync refused');
      const acc = j.accepted || batch.map(e => e.event_id);
      acc.forEach(id => queue.delete(id));
      if (acc.length) await idb('queue', 'readwrite', s => { acc.forEach(id => s.delete(id)); });
      merge(j.leads);
      if (Array.isArray(j.gone) && j.gone.length) drop(j.gone);                         // v2.5.2: reassigned away from this Agent on the server
      if (j.session_exp && DF.renewSession) DF.renewSession(j.session_exp);              // rolling 30-day session
      if (Array.isArray(j.board)) { await setMeta('board', { day: new Date().toDateString(), at: j.server_ts || '', rows: j.board }); DF.bus.emit('board:changed'); }   // v2.6 Blitz Board aggregates
      if (Array.isArray(j.roster) && j.roster.length) {                                  // server roster has no PIN hashes: keep this phone's own
        const loc = {}; (meta.roster || []).forEach(r => { loc[r.id] = r; });
        await setMeta('roster', j.roster.map(r => Object.assign({}, r, loc[r.id] && loc[r.id].pin ? { pin: loc[r.id].pin } : {}, loc[r.id] && loc[r.id].invite ? { invite: loc[r.id].invite } : {}, loc[r.id] && loc[r.id].defaultCampaign ? { defaultCampaign: loc[r.id].defaultCampaign } : {}))); DF.bus.emit('roster:changed');
      }
      if (Array.isArray(j.campaigns) && j.campaigns.length) await setMeta('campaigns', j.campaigns);
      if (j.server_ts) await setMeta('since', j.server_ts);
      DF.bus.emit('sync:state', queue.size ? 'pending' : 'synced');
      return { sent: batch.length, accepted: acc.length };
    } catch (e) { DF.bus.emit('sync:state', 'offline'); return { error: String(e.message || e) }; }
    finally { flushing = false; if (queue.size && navigator.onLine !== false && syncUrl()) scheduleFlush(15000); }
  }
  function scheduleFlush(ms) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, ms); }
  function startAuto() {
    window.addEventListener('online', () => flush());
    window.addEventListener('offline', () => DF.bus.emit('sync:state', 'offline'));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { if (queue.size) flush({ hidden: true }); } else flush(); });
    window.addEventListener('focus', () => flush());
    window.addEventListener('pageshow', e => { if (e.persisted) flush(); });   // PWA resumed from the back-forward cache: pull + push at once
    setInterval(flush, DF.cfg.FLUSH_EVERY_MS);
    flush();
  }

  DF.sync = {
    FIELDS, STATUS, BY_CODE, DEFAULTS, open, importRows, mutate, append, undo, removeMany, merge, drop, flush, startAuto, normalize, validate, leadId, statusCode, setMeta, syncUrl,
    get: id => leads.get(id),
    all: () => Array.from(leads.values()).filter(r => !r._deleted),
    count: () => leads.size,
    events: id => id ? events.filter(e => e.lead_id === id) : events,
    outbox: () => Array.from(queue.values()),
    queueSize: () => queue.size,
    meta: k => meta[k],
    knock: code => !!(BY_CODE[code] && BY_CODE[code].knock),
    contact: code => !!(BY_CODE[code] && BY_CODE[code].contact)
  };
})();
