// Doorway Field v1.0 — OfflineSync: Doorway_Lead_Schema (org_id + 19 fields), IndexedDB, offline mutation queue,
// background flush and conflict-safe timestamp merge. Every tap is written locally first; the network is never awaited.
(function () {
  'use strict';
  const DF = window.DF;
  const FIELDS = ['org_id', 'turf_id', 'lead_id', 'lat', 'lng', 'address', 'apt', 'city', 'state', 'zip', 'first_name', 'last_name',
    'phone', 'email', 'status_code', 'turf_intel_note', 'rep_note', 'appt_at', 'assigned_rep_email', 'updated_at'];
  // One status table (mirrors Doorway_Core.LEAD_STATUS). menu = on the Lead Menu strip; knock = counts as a knock in Stats.
  // Owner sign-off 2026-11-14: the 10 active Doorway codes only. CCI/CST stay import-only (Tool #1 lead_type mapping), never on the bar.
  const STATUS = [
    { code: 'NEW', label: 'Prospects (New)', short: 'New', color: '#2f80ed', icon: '★', menu: 1, knock: 0 },
    { code: 'NH1', label: 'Not Home 1', short: 'NH1', color: '#f2c94c', icon: '1', menu: 1, knock: 1 },
    { code: 'NH2', label: 'Not Home 2', short: 'NH2', color: '#f2994a', icon: '2', menu: 1, knock: 1 },
    { code: 'NH3', label: 'Not Home 3', short: 'NH3', color: '#e2703a', icon: '3', menu: 1, knock: 1 },
    { code: 'GB', label: 'Go Back', short: 'GB', color: '#9b51e0', icon: '↺', menu: 1, knock: 1 },
    { code: 'P_GB', label: 'Pitched – Go Back', short: 'P GB', color: '#bb6bd9', icon: 'P', menu: 1, knock: 1 },
    { code: 'SOLD', label: 'Sold', short: 'SOLD', color: '#27ae60', icon: '$', menu: 1, knock: 1 },
    { code: 'NI', label: 'Not Interested', short: 'NI', color: '#eb5757', icon: '✕', menu: 1, knock: 1 },
    { code: 'APPT', label: 'Appointment', short: 'APPT', color: '#00a3a3', icon: '◷', menu: 1, knock: 1 },
    { code: 'PVL', label: 'Possible Vacant Lot', short: 'PVL', color: '#a68a64', icon: '▢', menu: 1, knock: 0 },
    { code: 'CCI', label: 'CCI', short: 'CCI', color: '#56ccf2', icon: 'C', menu: 0, knock: 0 },
    { code: 'CST', label: 'Customer', short: 'Cst', color: '#1b5e20', icon: '✓', menu: 0, knock: 0 }
  ];
  const BY_CODE = Object.fromEntries(STATUS.map(s => [s.code, s]));
  const ALIAS = { 'P GB': 'P_GB', PGB: 'P_GB', PROSPECT: 'NEW', NEW: 'NEW', CCI_PROSPECT: 'CCI', CUSTOMER: 'CST', CST: 'CST' };

  const leads = new Map();      // lead_id -> row (synchronous reads for the < 30 ms flip)
  let events = [];              // Field_Events mirror on this device (Activity + Stats)
  const queue = new Map();      // event_id -> event not yet accepted by the API
  let meta = {};
  let db = null;
  let flushTimer = null, flushing = false;

  // ---- schema ----
  function hash16(s) {          // byte-for-byte copy of DoorwayCore.hash_ (FNV-1a 32-bit x2 -> 16 hex) so server + device keys match
    let h1 = 0x811c9dc5, h2 = 0x01000193, i, c;
    for (i = 0; i < s.length; i++) { c = s.charCodeAt(i); h1 ^= c; h1 = Math.imul(h1, 16777619) >>> 0; h2 ^= c + i; h2 = Math.imul(h2, 2246822519) >>> 0; }
    return ('0000000' + h1.toString(16)).slice(-8) + ('0000000' + h2.toString(16)).slice(-8);
  }
  const normAddr = s => String(s || '').toUpperCase().replace(/[.,#]/g, ' ').replace(/\s+/g, ' ').trim();
  const leadId = (address, apt, zip) => 'DL-' + hash16([normAddr(address), normAddr(apt), String(zip || '').trim()].join('|'));
  const statusCode = v => { const u = String(v || '').trim().toUpperCase(); return ALIAS[u] || (BY_CODE[u] ? u : u.replace(/\s+/g, '_')); };
  function normalize(r) {
    const o = {};
    FIELDS.forEach(f => { o[f] = r[f] == null ? '' : String(r[f]).trim(); });
    o.org_id = o.org_id || DF.cfg.ORG_ID;
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
    if (r._deleted) o._deleted = true;
    return o;
  }
  function validate(o) {
    const errs = [];
    if (!isFinite(o.lat) || Math.abs(o.lat) > 90 || !isFinite(o.lng) || Math.abs(o.lng) > 180 || (o.lat === 0 && o.lng === 0)) errs.push('missing/invalid lat,lng');
    if (!o.address) errs.push('missing address');
    if (!BY_CODE[o.status_code]) errs.push('unknown status ' + o.status_code);
    if (o.zip && !/^\d{5}$/.test(o.zip)) errs.push('bad zip');
    if (o.email && !/^[^@\s]+@[^@\s]+$/.test(o.email)) errs.push('bad email');
    return errs;
  }
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2));

  // ---- IndexedDB ----
  function idb(store, mode, fn) {
    if (!db) return Promise.resolve();
    return new Promise((res, rej) => {
      const tx = db.transaction(store, mode); const out = fn(tx.objectStore(store));
      tx.oncomplete = () => res(out && out.result); tx.onerror = () => rej(tx.error);
    });
  }
  const getAll = store => idb(store, 'readonly', s => s.getAll());
  const putMany = (store, rows) => rows.length ? idb(store, 'readwrite', s => { rows.forEach(r => s.put(r)); }) : Promise.resolve();
  function open() {
    return new Promise(resolve => {
      if (!window.indexedDB) return resolve();
      const req = indexedDB.open('doorway_field', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('leads', { keyPath: 'lead_id' });
        d.createObjectStore('queue', { keyPath: 'event_id' });
        d.createObjectStore('events', { keyPath: 'event_id' });
        d.createObjectStore('meta', { keyPath: 'k' });
      };
      req.onsuccess = async () => {
        db = req.result;
        (await getAll('leads')).forEach(r => leads.set(r.lead_id, r));
        events = (await getAll('events')).sort((a, b) => a.device_ts < b.device_ts ? -1 : 1);
        (await getAll('queue')).forEach(e => queue.set(e.event_id, e));
        (await getAll('meta')).forEach(m => { meta[m.k] = m.v; });
        resolve();
      };
      req.onerror = () => resolve();
    });
  }
  const setMeta = (k, v) => { meta[k] = v; return putMany('meta', [{ k, v }]); };

  // ---- import (fixture, CSV, API) — dedupe on address + apt + zip ----
  async function importRows(rows, opts) {
    opts = opts || {};
    const report = { added: 0, updated: 0, rejected: [] }, changed = [];
    rows.forEach((raw, i) => {
      if (/^(DNC|EXCLUDED_DNC)$/i.test(String(raw.lead_type || raw.status_code || ''))) { report.rejected.push({ row: i + 1, reason: 'DNC is never imported' }); return; }
      const o = normalize(raw), errs = validate(o);
      if (errs.length) { report.rejected.push({ row: i + 1, reason: errs.join('; ') }); return; }
      const cur = leads.get(o.lead_id);
      if (cur) { FIELDS.forEach(f => { if (o[f] !== '' && f !== 'status_code' && f !== 'updated_at') cur[f] = o[f]; }); changed.push(cur); report.updated++; }
      else { leads.set(o.lead_id, o); changed.push(o); report.added++; }
    });
    await putMany('leads', changed);
    if (!opts.silent) DF.bus.emit('pins:changed', { all: true });
    return report;
  }

  // ---- mutations: memory first (sync), then IndexedDB + queue (async). Returns the event. ----
  function mutate(id, patch, type, extra) {
    const row = leads.get(id); if (!row) return null;
    const from = row.status_code, now = new Date().toISOString();
    Object.assign(row, patch, { updated_at: now });
    const ev = Object.assign({ event_id: uuid(), org_id: row.org_id, lead_id: id, type: type || 'edit', from: patch.status_code ? from : '',
      to: patch.status_code || '', patch, rep: DF.auth.email, device_ts: now }, extra || {});
    events.push(ev); queue.set(ev.event_id, ev);
    Promise.resolve().then(() => Promise.all([putMany('leads', [row]), putMany('events', [ev]), putMany('queue', [ev])])).catch(e => console.error('[DF] idb', e));
    DF.bus.emit('dispo:queued', ev);
    scheduleFlush(1500);
    return ev;
  }
  function undo(ev) {           // a new compensating event (history stays append-only)
    if (!ev) return;
    const patch = {}; Object.keys(ev.patch).forEach(k => { patch[k] = k === 'status_code' ? ev.from : ''; });
    mutate(ev.lead_id, patch, 'undo', { undo_of: ev.event_id });
  }

  // ---- merge: server row wins only if newer AND this device has no pending events for that lead ----
  function merge(serverRows) {
    const pending = new Set(Array.from(queue.values()).map(e => e.lead_id)), changed = [];
    (serverRows || []).forEach(raw => {
      const s = normalize(raw), cur = leads.get(s.lead_id);
      if (!cur || (!pending.has(s.lead_id) && s.updated_at > cur.updated_at)) { leads.set(s.lead_id, s); changed.push(s); }
    });
    if (changed.length) { putMany('leads', changed); DF.bus.emit('pins:changed', { ids: changed.map(r => r.lead_id) }); }
    return changed.length;
  }

  // ---- flush: text/plain POST (no CORS preflight for Apps Script), idempotent on event_id ----
  async function flush() {
    if (flushing || !DF.cfg.API_URL || navigator.onLine === false) return { skipped: true };
    flushing = true; DF.bus.emit('sync:state', 'syncing');
    const batch = Array.from(queue.values()).slice(0, 200);
    try {
      const res = await fetch(DF.cfg.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'sync', org_id: DF.cfg.ORG_ID, id_token: DF.auth.idToken, email: DF.auth.email, since: meta.since || '', events: batch }) });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || 'sync refused');
      const acc = j.accepted || batch.map(e => e.event_id);
      acc.forEach(id => queue.delete(id));
      if (acc.length) await idb('queue', 'readwrite', s => { acc.forEach(id => s.delete(id)); });
      merge(j.leads);
      if (j.server_ts) await setMeta('since', j.server_ts);
      if (j.role) DF.bus.emit('auth:role', j.role);
      DF.bus.emit('sync:state', queue.size ? 'pending' : 'synced');
      return { sent: batch.length, accepted: acc.length };
    } catch (e) {
      DF.bus.emit('sync:state', 'offline');
      return { error: String(e.message || e) };
    } finally { flushing = false; if (queue.size && navigator.onLine !== false) scheduleFlush(15000); }
  }
  function scheduleFlush(ms) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, ms); }
  function startAuto() {
    window.addEventListener('online', () => flush());
    window.addEventListener('offline', () => DF.bus.emit('sync:state', 'offline'));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flush(); });
    window.addEventListener('focus', () => flush());
    setInterval(flush, DF.cfg.FLUSH_EVERY_MS);
    flush();
  }

  DF.sync = {
    FIELDS, STATUS, BY_CODE, open, importRows, mutate, undo, merge, flush, startAuto, normalize, validate, leadId, statusCode, setMeta,
    get: id => leads.get(id),
    all: () => Array.from(leads.values()).filter(r => !r._deleted),
    count: () => leads.size,
    events: id => id ? events.filter(e => e.lead_id === id) : events,
    queueSize: () => queue.size,
    meta: k => meta[k],
    knock: code => !!(BY_CODE[code] && BY_CODE[code].knock)
  };
})();
