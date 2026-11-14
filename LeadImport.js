// Doorway Field v2.0 — LeadImport (Owner/Manager): SalesRabbit 19-column CSV parser (+ schema / Tool #1 aliases, Campaign column),
// Campaign selector, sample CSV, All | Valid | Invalid preview, Submit, Imports history with Delete Batch, Clear All Turf (owner),
// and the shared 19-column (+ Campaign) export. Reps resolve to roster ids by name/email; unknown emails are kept as-is.
(function () {
  'use strict';
  const DF = window.DF;
  const $ = s => DF.$(s);
  // The 19 SalesRabbit headers, exact text and order (sample CSV + 1:1 mapping)
  const SR_HEADERS = ['Assigned to (email)', 'Assigned to (name)', 'Status', 'Business Name', 'First Name', 'Last Name', 'Phone', 'Email', 'Address',
    'Apt/Suite', 'City', 'State/Region', 'Postal Code', 'Country', 'Latitude', 'Longitude', 'Notes', 'Appointment', 'Date Created'];
  const SR_FIELD = ['assigned_rep_email', '_rep_name', 'status_code', '_business', 'first_name', 'last_name', 'phone', 'email', 'address',
    'apt', 'city', 'state', 'zip', '_country', 'lat', 'lng', 'rep_note', 'appt_at', '_created'];
  // Header key = lower-case, letters/digits only ("Apt/Suite" -> "aptsuite"). Schema + Tool #1 aliases after the SalesRabbit names.
  const key = h => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
  const ALIASES = {
    org_id: ['orgid', 'org'], turf_id: ['turfid', 'turf', 'turfunitid', 'turfname'], lat: ['gpslat', 'lat', 'y'], lng: ['lng', 'lon', 'long', 'x', 'gpslng', 'gpslon'],
    address: ['street', 'streetaddress', 'address1', 'addr', 'fulladdress'], apt: ['apt', 'unit', 'apartment', 'suite', 'address2', 'aptunit'],
    city: ['town'], state: ['state', 'st'], zip: ['zip', 'zipcode', 'postal', 'zip5'], first_name: ['firstname', 'first', 'givenname'],
    last_name: ['lastname', 'last', 'surname', 'familyname'], phone: ['phonenumber', 'mobile', 'cell', 'telephone'], email: ['emailaddress'],
    status_code: ['statuscode', 'leadtype', 'disposition'], turf_intel_note: ['turfintelnote', 'intel', 'turfnote', 'scorecardreason'],
    rep_note: ['repnote', 'note'], appt_at: ['apptat'], campaign: ['campaign', 'carrier'], created_at: ['createdat'], assigned_rep_email: ['assignedrepemail', 'rep', 'repemail', 'assignedrep', 'assignedto'], updated_at: ['updatedat']
  };
  const SAMPLE = [
    ['', 'Agent 1', 'New', '', 'Avery', 'Ashford', '207-555-0101', '', '14 MAIN ST', '', 'SANFORD', 'ME', '04073', 'US', '43.439290', '-70.774260', 'Corner lot, dog in yard', '', '2026-11-14 09:00'],
    ['', 'Agent 1', 'NH1', '', 'Blake', 'Bellamy', '207-555-0102', '', '22 SCHOOL ST', 'APT 2', 'SANFORD', 'ME', '04073', 'US', '43.437650', '-70.777930', '', '', '2026-11-14 09:00'],
    ['', 'Manager 1', 'APPT', '', 'Casey', 'Corwin', '207-555-0103', '', '38 MAIN ST', '', 'SPRINGVALE', 'ME', '04083', 'US', '43.466100', '-70.794880', 'Wants 1 Gig, call after 5', '2026-11-20 18:30', '2026-11-14 09:00'],
    ['', 'Manager 1', 'GB', 'Riverside Diner', 'Dana', 'Dalloway', '207-555-0104', '', '56 RIVERSIDE AVE', '', 'SANFORD', 'ME', '04073', 'US', '43.430960', '-70.764470', 'Owner back Tuesday', '', '2026-11-14 09:00'],
    ['', 'Agent 1', 'Not Interested', '', 'Emerson', 'Everly', '', '', '9 MAPLE ST', '', 'SANFORD', 'ME', '04073', 'US', '43.444060', '-70.779920', '', '', '2026-11-14 09:00']
  ];
  let pending = null, filter = 'all';

  // ---- CSV (RFC 4180: quotes, CRLF, BOM) ----
  function parseCsv(text) {
    const rows = []; let row = [], cell = '', q = false;
    text = String(text).replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(v => String(v).trim() !== ''));
  }
  const csvCell = v => /[",\r\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  const sampleCsv = () => [SR_HEADERS].concat(SAMPLE).map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  function mapHeaders(header) {
    const keys = header.map(key), map = {};
    SR_HEADERS.forEach((h, i) => { const at = keys.indexOf(key(h)); if (at >= 0) map[SR_FIELD[i]] = at; });   // SalesRabbit 1:1 first
    Object.keys(ALIASES).forEach(f => { if (map[f] !== undefined) return; const at = keys.findIndex(k => ALIASES[f].includes(k)); if (at >= 0) map[f] = at; });
    const used = new Set(Object.values(map));
    return { map, unmapped: header.filter((h, i) => !used.has(i)), salesrabbit: SR_HEADERS.every(h => keys.includes(key(h))) };
  }
  // Dates: ISO "2026-11-20 18:30[:00]" or US "11/20/2026 6:30 PM" (parsed by hand: iPhone Safari rejects "YYYY-MM-DD HH:MM")
  function parseDate(v) {
    v = String(v || '').trim(); if (!v) return '';
    let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/), y, mo, d, h = 0, mi = 0;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; h = +(m[4] || 0); mi = +(m[5] || 0); }
    else if ((m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?)?$/))) {
      mo = +m[1]; d = +m[2]; y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; h = +(m[4] || 0); mi = +(m[5] || 0);
      if (m[6]) { const pm = /p/i.test(m[6]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
    } else return null;
    const dt = new Date(y, mo - 1, d, h, mi);
    return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d && h < 24 && mi < 60 ? dt.toISOString() : null;
  }
  function statusFrom(v) {          // code, short label or label ("Not Interested") -> code; Tool #1 lead_type handled by OfflineSync
    const t = String(v || '').trim(); if (!t) return 'NEW';
    const hit = DF.sync.STATUS.find(s => [s.code, s.short, s.label].some(x => x.toLowerCase() === t.toLowerCase()));
    return hit ? hit.code : DF.sync.statusCode(t);
  }
  const turfStamp = name => 'IMP-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(name || 'CSV').replace(/\.[^.]+$/, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);

  // ---- build + validate every row (nothing is written until Submit) ----
  function analyze(text, filename) {
    const grid = parseCsv(text), head = grid[0] || [], hm = mapHeaders(head), turf = turfStamp(filename), seen = {};
    const rows = grid.slice(1).map((cells, i) => {
      const raw = {}; Object.keys(hm.map).forEach(f => { raw[f] = String(cells[hm.map[f]] || '').trim(); });
      return check(raw, i + 2, turf, seen);
    });
    return { filename, rows, map: hm.map, unmapped: hm.unmapped, salesrabbit: hm.salesrabbit, missing: ['address', 'lat', 'lng'].filter(f => hm.map[f] === undefined) };
  }
  function check(raw, line, turf, seen) {
    const hasXY = raw.lat !== undefined && raw.lng !== undefined && raw.lat !== '' && raw.lng !== '';
    if (!raw.address && hasXY) raw = Object.assign({}, raw, { address: 'Pin ' + raw.lat + ', ' + raw.lng });   // coordinates-only row: label the pin
    const errs = [], lt = /^(dnc|excluded_dnc)$/i.test(raw.status_code || '');
    const notes = [raw.rep_note, raw._business ? 'Business: ' + raw._business : ''].filter(Boolean).join(' · ');
    const appt = parseDate(raw.appt_at), created = parseDate(raw._created);
    const id = DF.sync.leadId(raw.address, raw.apt, String(raw.zip || '').replace(/\D/g, '').slice(0, 5).padStart(raw.zip ? 5 : 0, '0')), cur = DF.sync.get(id);
    const rr = DF.roster.get(raw.assigned_rep_email) || DF.roster.get(raw._rep_name);
    const lead = DF.sync.normalize(Object.assign({}, raw, { org_id: raw.org_id || DF.cfg.ORG_ID, turf_id: raw.turf_id || (cur ? cur.turf_id : turf), status_code: statusFrom(raw.status_code),
      assigned_rep_email: rr ? rr.id : raw.assigned_rep_email || '', rep_note: notes, appt_at: appt || '', created_at: created || '', updated_at: '' }));
    if (!raw.address && !hasXY) errs.push('missing Address and Latitude/Longitude');
    else if (!hasXY) errs.push('needs Latitude/Longitude to place the pin (no free geocoder)');
    else if (!isFinite(lead.lat) || !isFinite(lead.lng) || Math.abs(lead.lat) > 90 || Math.abs(lead.lng) > 180 || (lead.lat === 0 && lead.lng === 0)) errs.push('invalid coordinates');
    // v1.1.1: Assigned to (email) is never a reason to reject; blank = Unassigned, unknown/external emails are kept as-is
    if (lt) errs.push('DNC is never imported');
    else if (!DF.sync.BY_CODE[lead.status_code]) errs.push('unknown status ' + raw.status_code);
    if (lead.zip && !/^\d{5}$/.test(lead.zip)) errs.push('bad Postal Code');
    if (raw._country && !/^(us|usa|united states( of america)?)$/i.test(raw._country)) errs.push('Country must be US');
    if (appt === null) errs.push('bad Appointment date');
    if (created === null) errs.push('bad Date Created');
    if (!errs.length && seen[lead.lead_id]) errs.push('duplicate of line ' + seen[lead.lead_id]);
    if (!errs.length) seen[lead.lead_id] = line;
    return { line, lead, raw, errors: errs, ok: !errs.length, exists: !!DF.sync.get(lead.lead_id), rep_name: raw._rep_name || '', created: created || '' };
  }

  // ---- preview grid ----
  function renderPreview() {
    const box = $('#import-preview'); if (!pending) { box.hidden = true; return; }
    box.hidden = false;
    const all = pending.rows, ok = all.filter(r => r.ok), bad = all.filter(r => !r.ok);
    const show = filter === 'valid' ? ok : filter === 'invalid' ? bad : all;
    $('#pv-file').textContent = pending.filename + (pending.salesrabbit ? ' · SalesRabbit 19-column format' : ' · mapped: ' + Object.keys(pending.map).filter(f => f[0] !== '_').join(', '));
    $('#pv-tab-all').textContent = 'All (' + all.length + ')'; $('#pv-tab-valid').textContent = 'Valid (' + ok.length + ')'; $('#pv-tab-invalid').textContent = 'Invalid (' + bad.length + ')';
    DF.$$('.pv-tab').forEach(t => t.classList.toggle('active', t.dataset.filter === filter));
    $('#pv-submit').disabled = !ok.length; $('#pv-submit').textContent = 'Submit ' + ok.length + ' valid';
    $('#pv-missing').textContent = pending.missing.length ? 'Missing columns: ' + pending.missing.join(', ') : '';
    $('#pv-body').innerHTML = show.slice(0, 500).map(r => '<tr class="' + (r.ok ? 'ok' : 'bad') + '" data-line="' + r.line + '"><td>' + r.line + '</td><td>' + (r.ok ? (r.exists ? 'update' : 'new') : '✕') +
      '</td><td class="issues">' + DF.esc(r.errors.join('; ')) + '</td><td>' + DF.esc(r.raw.address || '') + (r.raw.apt ? ' ' + DF.esc(r.raw.apt) : '') + '</td><td>' + DF.esc([r.raw.city, r.raw.state, r.raw.zip].filter(Boolean).join(' ')) +
      '</td><td>' + DF.esc(r.raw.lat || '') + ', ' + DF.esc(r.raw.lng || '') + '</td><td>' + DF.esc(r.lead.assigned_rep_email ? r.lead.assigned_rep_email + (r.rep_name ? ' (' + r.rep_name + ')' : '') : 'Unassigned' + (r.rep_name ? ' (' + r.rep_name + ')' : '')) + '</td><td>' + DF.esc(r.lead.status_code) +
      '</td></tr>').join('') + (show.length > 500 ? '<tr><td colspan="8">First 500 of ' + show.length + ' rows shown</td></tr>' : '');
    return { all: all.length, valid: ok.length, invalid: bad.length, shown: Math.min(show.length, 500) };
  }
  function assignBlanks(email) {     // fill missing "Assigned to (email)" from the picker, then re-validate
    if (!pending || !email) return;
    const seen = {}, turf = turfStamp(pending.filename);
    pending.rows = pending.rows.map(r => check(Object.assign({}, r.raw, r.raw.assigned_rep_email ? {} : { assigned_rep_email: email }), r.line, turf, seen));
    renderPreview();
  }
  async function preview(text, filename) {
    if (!DF.isManager()) { DF.toast('Owner / Manager only'); return null; }
    pending = analyze(text, filename); filter = 'all';
    $('#pv-assign').innerHTML = '<option value="">Assign Unassigned rows to…</option>' + reps().map(r => '<option value="' + DF.esc(r.key) + '">' + DF.esc(r.name) + '</option>').join('');
    return renderPreview();
  }
  async function submit() {
    if (!pending || !DF.isManager()) return null;
    const camp = $('#imp-campaign').value, ok = pending.rows.filter(r => r.ok);
    const rep = await DF.sync.importRows(ok.map(r => Object.assign({}, r.lead, { updated_at: '', campaign: camp || r.raw.campaign || '' })), { source: 'csv' });
    const rec = { id: 'imp-' + Date.now().toString(36), status: rep.rejected.length ? 'Failed rows' : pending.rows.length > ok.length ? 'Completed with errors' : 'Completed', created: new Date().toISOString(),
      file: pending.filename, campaign: camp || 'From file', by: DF.auth.id, valid: ok.length, submitted: pending.rows.length, processed: rep.added + rep.updated, added: rep.added, updated: rep.updated, ids: rep.ids };
    await DF.sync.setMeta('imports', [rec].concat(history()).slice(0, 200));
    $('#import-report').textContent = rec.file + ': ' + rep.added + ' added · ' + rep.updated + ' updated · ' + (rec.submitted - rec.valid) + ' invalid not submitted';
    pending = null; renderPreview(); renderHistory();
    DF.toast(rec.processed + ' pins on the map');
    return rec;
  }
  // Rep picker = roster + reps named in the CSV being previewed + reps already on the map (nothing hardcoded in source)
  function reps() {
    const out = DF.roster.all().map(r => ({ key: r.id, name: r.name + ' (' + r.role + ')' }));
    const add = k => { k = String(k || '').trim().toLowerCase(); if (k && !out.some(x => x.key === k)) out.push({ key: k, name: k }); };
    (pending ? pending.rows : []).forEach(r => add(r.lead.assigned_rep_email));
    DF.sync.all().forEach(r => add(r.assigned_rep_email));
    return out;
  }
  const history = () => DF.sync.meta('imports') || [];
  function renderHistory() {
    const h = history();
    $('#imports-body').innerHTML = h.map((r, i) => '<tr><td><span class="imp-status imp-' + (r.status === 'Completed' ? 'ok' : 'warn') + '">' + DF.esc(r.status) + '</span></td><td>' + DF.fmtTime(r.created) +
      '</td><td>' + DF.esc(r.file) + '<small>' + DF.esc(r.campaign || '') + '</small></td><td>' + DF.esc(DF.roster.name(r.by)) + '</td><td>' + r.valid + '</td><td>' + r.submitted + '</td><td>' + r.processed +
      '</td><td>' + ((r.ids || []).length && r.status !== 'Deleted' ? '<button type="button" class="btn danger del-batch" data-i="' + i + '">Delete Batch</button>' : '') + '</td></tr>').join('') ||
      '<tr><td colspan="8" class="empty">No imports yet</td></tr>';
    DF.$$('#imports-body .del-batch').forEach(b => b.addEventListener('click', () => deleteBatch(+b.dataset.i)));
    return h;
  }
  async function deleteBatch(i) {      // soft-deletes only the pins that batch ADDED (updated doors stay); kept in history
    const h = history(), rec = h[i]; if (!rec || !DF.isManager()) return 0;
    const n = DF.sync.removeMany(rec.ids || [], 'batch ' + rec.id).length;
    rec.status = 'Deleted'; rec.deleted = n; await DF.sync.setMeta('imports', h);
    renderHistory(); DF.map.refresh(); DF.toast(n + ' pins from ' + rec.file + ' deleted'); return n;
  }
  let armedClear = false;
  function clearTurf() {               // owner only, two taps: soft-delete every pin in the active campaign (All Campaigns = everything)
    if (!DF.isOwner()) return 0;
    const list = DF.sync.all().filter(DF.inCampaign).map(r => r.lead_id);
    if (!armedClear) { armedClear = true; $('#clear-turf').textContent = 'Tap again: delete ' + list.length + ' pins'; setTimeout(() => { armedClear = false; $('#clear-turf').textContent = 'Clear All Turf'; }, 3000); return 0; }
    armedClear = false; $('#clear-turf').textContent = 'Clear All Turf';
    const n = DF.sync.removeMany(list, 'clear all turf').length; DF.map.refresh(); DF.toast(n + ' pins cleared (kept in history)'); return n;
  }
  // ---- export: the 19 SalesRabbit columns + Campaign (first 19 identical, so SalesRabbit maps by header) ----
  const pad = n => String(n).padStart(2, '0');
  const stamp = iso => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  function exportRows(leads) {
    return leads.map(r => {
      const rr = DF.roster.get(r.assigned_rep_email), note = String(r.rep_note || ''), biz = (note.match(/Business: ([^·]+)/) || [])[1] || '';
      return [/@/.test(r.assigned_rep_email) ? r.assigned_rep_email : rr && rr.email || '', rr ? rr.name : '', (DF.sync.BY_CODE[r.status_code] || { short: r.status_code }).short, biz.trim(),
        r.first_name, r.last_name, r.phone, r.email, r.address, r.apt, r.city, r.state, r.zip, 'US', r.lat, r.lng, note.replace(/\s*·?\s*Business: [^·]+/, '').trim(), stamp(r.appt_at), stamp(r.created_at), r.campaign];
    });
  }
  function exportCsv(leads, label) {
    const head = SR_HEADERS.concat(['Campaign']), csv = [head].concat(exportRows(leads)).map(r => r.map(v => csvCell(v == null ? '' : v)).join(',')).join('\r\n') + '\r\n';
    const filename = 'Doorway_' + String(label || 'Export').replace(/[^A-Za-z0-9]+/g, '-') + '_' + new Date().toISOString().slice(0, 10) + '.csv';
    download(csv, filename); DF.toast(leads.length + ' leads exported'); return { filename, header: head, rows: leads.length, csv };
  }
  function download(text, name) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  const downloadSample = () => download(sampleCsv(), 'Doorway_Lead_Import_Sample.csv');
  function renderCampaignSelect() {
    const cur = $('#imp-campaign').value, def = DF.campaign === '*' ? DF.campaigns()[0] : DF.campaign;
    $('#imp-campaign').innerHTML = DF.campaigns().map(c => '<option value="' + DF.esc(c) + '">' + DF.esc(c) + '</option>').join('') + '<option value="">From file (Campaign column)</option>';
    $('#imp-campaign').value = cur !== '' && DF.campaigns().includes(cur) ? cur : def;
  }
  function readFile(file) { if (!file) return; const fr = new FileReader(); fr.onload = () => preview(fr.result, file.name); fr.readAsText(file); }

  function init() {
    const zone = $('#drop-zone'), input = $('#csv-input');
    ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('hover'); }));
    ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('hover'); }));
    zone.addEventListener('drop', e => readFile(e.dataTransfer.files[0]));
    zone.addEventListener('click', () => input.click());
    input.addEventListener('change', () => { readFile(input.files[0]); input.value = ''; });
    $('#sample-csv').addEventListener('click', e => { e.preventDefault(); downloadSample(); });
    DF.$$('.pv-tab').forEach(t => t.addEventListener('click', () => { filter = t.dataset.filter; renderPreview(); }));
    $('#pv-assign').addEventListener('change', e => assignBlanks(e.target.value));
    $('#pv-submit').addEventListener('click', submit);
    $('#pv-cancel').addEventListener('click', () => { pending = null; renderPreview(); });
    $('#clear-turf').addEventListener('click', clearTurf);
    DF.bus.on('tab:changed', t => { if (t === 'admin') { renderHistory(); renderCampaignSelect(); } });
    DF.bus.on('campaigns:changed', renderCampaignSelect);
  }

  DF.imports = { init, reps, deleteBatch, clearTurf, exportCsv, exportRows, renderCampaignSelect, SR_HEADERS, parseCsv, mapHeaders, analyze, parseDate, preview, submit, assignBlanks, history, sampleCsv, renderPreview,
    setFilter: f => { filter = f; return renderPreview(); }, pending: () => pending };
})();
