// Doorway Field v1.1 — LeadImport (owner only): SalesRabbit 19-column CSV parser (+ Doorway_Lead_Schema / Tool #1 aliases),
// downloadable sample CSV, pre-submit validation preview (All | Valid | Invalid), Submit, and a persistent Imports history.
// UI gate only; the Doorway Field API re-checks the owner allow-list on every admin call (Foundation §7).
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
    rep_note: ['repnote', 'note'], appt_at: ['apptat'], assigned_rep_email: ['assignedrepemail', 'rep', 'repemail', 'assignedrep', 'assignedto'], updated_at: ['updatedat']
  };
  const SAMPLE = [
    ['alex.rivera@example.com', 'Alex Rivera', 'New', '', 'Avery', 'Ashford', '207-555-0101', 'avery.ashford@example.com', '14 MAIN ST', '', 'SANFORD', 'ME', '04073', 'US', '43.439290', '-70.774260', 'Corner lot, dog in yard', '', '2026-11-14 09:00'],
    ['alex.rivera@example.com', 'Alex Rivera', 'NH1', '', 'Blake', 'Bellamy', '207-555-0102', '', '22 SCHOOL ST', 'APT 2', 'SANFORD', 'ME', '04073', 'US', '43.437650', '-70.777930', '', '', '2026-11-14 09:00'],
    ['jordan.lee@example.com', 'Jordan Lee', 'APPT', '', 'Casey', 'Corwin', '207-555-0103', 'casey.corwin@example.com', '38 MAIN ST', '', 'SPRINGVALE', 'ME', '04083', 'US', '43.466100', '-70.794880', 'Wants 1 Gig, call after 5', '2026-11-20 18:30', '2026-11-14 09:00'],
    ['jordan.lee@example.com', 'Jordan Lee', 'GB', 'Riverside Diner', 'Dana', 'Dalloway', '207-555-0104', '', '56 RIVERSIDE AVE', '', 'SANFORD', 'ME', '04073', 'US', '43.430960', '-70.764470', 'Owner back Tuesday', '', '2026-11-14 09:00'],
    ['alex.rivera@example.com', 'Alex Rivera', 'Not Interested', '', 'Emerson', 'Everly', '', '', '9 MAPLE ST', '', 'SANFORD', 'ME', '04073', 'US', '43.444060', '-70.779920', '', '', '2026-11-14 09:00']
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
    const lead = DF.sync.normalize(Object.assign({}, raw, { org_id: raw.org_id || DF.cfg.ORG_ID, turf_id: raw.turf_id || (cur ? cur.turf_id : turf), status_code: statusFrom(raw.status_code),
      rep_note: notes, appt_at: appt || '', updated_at: '' }));
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
    if (!DF.admin.isOwner(DF.auth.email)) { DF.toast('Owner only'); return null; }
    pending = analyze(text, filename); filter = 'all';
    $('#pv-assign').innerHTML = '<option value="">Assign Unassigned rows to…</option>' + reps().map(r => '<option value="' + DF.esc(r.email) + '">' + DF.esc(r.name || r.email) + '</option>').join('');
    return renderPreview();
  }
  async function submit() {
    if (!pending || !DF.admin.isOwner(DF.auth.email)) return null;
    const ok = pending.rows.filter(r => r.ok), rep = await DF.sync.importRows(ok.map(r => Object.assign({}, r.lead, { updated_at: '' })), { source: 'csv' });
    const rec = { status: rep.rejected.length ? 'Failed rows' : pending.rows.length > ok.length ? 'Completed with errors' : 'Completed', created: new Date().toISOString(),
      file: pending.filename, by: DF.auth.email, valid: ok.length, submitted: pending.rows.length, processed: rep.added + rep.updated, added: rep.added, updated: rep.updated };
    await DF.sync.setMeta('imports', [rec].concat(history()).slice(0, 200));
    $('#import-report').textContent = rec.file + ': ' + rep.added + ' added · ' + rep.updated + ' updated · ' + (rec.submitted - rec.valid) + ' invalid not submitted';
    pending = null; renderPreview(); renderHistory(); DF.admin.renderProgress();
    DF.toast(rec.processed + ' pins on the map');
    return rec;
  }
  // Rep picker = owner + config REPS + reps named in the CSV being previewed + reps already on the map (nothing hardcoded in source)
  function reps() {
    const out = [], add = (email, name) => { email = String(email || '').trim().toLowerCase(); if (!email) return; const r = out.find(x => x.email === email); if (r) { r.name = r.name || name; } else out.push({ email, name: name || '' }); };
    (DF.cfg.OWNER_EMAILS || []).forEach(e => add(e, 'Owner'));
    (DF.cfg.REPS || []).forEach(r => add(r.email, r.name));
    (pending ? pending.rows : []).forEach(r => add(r.lead.assigned_rep_email, r.rep_name));
    DF.sync.all().forEach(r => add(r.assigned_rep_email));
    return out;
  }
  const history = () => DF.sync.meta('imports') || [];
  function renderHistory() {
    const h = history();
    $('#imports-body').innerHTML = h.map(r => '<tr><td><span class="imp-status imp-' + (r.status === 'Completed' ? 'ok' : 'warn') + '">' + DF.esc(r.status) + '</span></td><td>' + DF.fmtTime(r.created) +
      '</td><td>' + DF.esc(r.file) + '</td><td>' + DF.esc(DF.firstName(r.by)) + '</td><td>' + r.valid + '</td><td>' + r.submitted + '</td><td>' + r.processed + '</td></tr>').join('') ||
      '<tr><td colspan="7" class="empty">No imports yet</td></tr>';
    return h;
  }
  function downloadSample() {
    const url = URL.createObjectURL(new Blob([sampleCsv()], { type: 'text/csv;charset=utf-8' })), a = document.createElement('a');
    a.href = url; a.download = 'Doorway_Lead_Import_Sample.csv'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
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
    DF.bus.on('tab:changed', t => { if (t === 'admin') renderHistory(); });
  }

  DF.imports = { init, reps, SR_HEADERS, parseCsv, mapHeaders, analyze, parseDate, preview, submit, assignBlanks, history, sampleCsv, renderPreview,
    setFilter: f => { filter = f; return renderPreview(); }, pending: () => pending };
})();
