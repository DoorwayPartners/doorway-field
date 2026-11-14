// Doorway Field v1.0 — TurfAdmin (owner only): CSV drag-and-drop import (auto-maps the schema or raw address/lat/lng files),
// polygon/lasso turf creator + rep assignment, live progress (Knocked / Total / Sold).
// The UI gate here is convenience only; the Doorway Field API re-checks the owner allow-list on every admin call (Foundation §7).
(function () {
  'use strict';
  const DF = window.DF;
  const $ = s => DF.$(s);
  // header aliases -> schema field (lower-case, spaces/dashes -> _)
  const ALIASES = {
    org_id: ['org_id', 'org'], turf_id: ['turf_id', 'turf', 'turf_unit_id', 'turf_name'], lead_id: ['lead_id_dl', 'doorway_lead_id'],
    lat: ['lat', 'latitude', 'y', 'gps_lat'], lng: ['lng', 'lon', 'long', 'longitude', 'x', 'gps_lng', 'gps_lon'],
    address: ['address', 'street', 'street_address', 'address1', 'address_1', 'addr', 'full_address'], apt: ['apt', 'unit', 'apartment', 'suite', 'address2', 'address_2', 'apt_unit'],
    city: ['city', 'town'], state: ['state', 'st'], zip: ['zip', 'zipcode', 'zip_code', 'postal', 'postal_code', 'zip5'],
    first_name: ['first_name', 'first', 'firstname', 'given_name'], last_name: ['last_name', 'last', 'lastname', 'surname', 'family_name'],
    phone: ['phone', 'phone_number', 'mobile', 'cell', 'telephone'], email: ['email', 'email_address', 'e_mail'],
    status_code: ['status_code', 'status', 'lead_type', 'disposition'], turf_intel_note: ['turf_intel_note', 'intel', 'turf_note', 'scorecard_reason'],
    rep_note: ['rep_note', 'note', 'notes'], appt_at: ['appt_at', 'appointment'], assigned_rep_email: ['assigned_rep_email', 'rep', 'rep_email', 'assigned_rep', 'assigned_to'],
    updated_at: ['updated_at']
  };

  function isOwner(email) {
    email = String(email || '').toLowerCase();
    const list = (DF.cfg.OWNER_EMAILS || []).map(e => String(e).toLowerCase());
    return !!email && email.endsWith('@' + DF.cfg.OWNER_DOMAIN) && list.includes(email);   // fail closed when the list is empty
  }

  // ---- CSV: RFC 4180 quotes, CRLF, BOM ----
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
  function mapHeaders(header) {
    const norm = header.map(h => String(h).trim().toLowerCase().replace(/[\s-]+/g, '_')), map = {};
    Object.keys(ALIASES).forEach(field => {
      const idx = norm.findIndex(h => ALIASES[field].includes(h));
      if (idx >= 0) map[field] = idx;
    });
    return { map, unmapped: header.filter((h, i) => !Object.values(map).includes(i)) };
  }
  function csvToRows(text) {
    const grid = parseCsv(text); if (!grid.length) return { rows: [], map: {}, unmapped: [] };
    const { map, unmapped } = mapHeaders(grid[0]);
    const rows = grid.slice(1).map(cells => {
      const o = {}; Object.keys(map).forEach(f => { o[f] = (cells[map[f]] || '').trim(); });
      if (map.status_code !== undefined && grid[0][map.status_code].trim().toLowerCase() === 'lead_type') o.lead_type = o.status_code;
      return o;
    });
    return { rows, map, unmapped };
  }
  async function importCsv(text, filename) {
    if (!isOwner(DF.auth.email)) { DF.toast('Owner only'); return null; }
    const parsed = csvToRows(text);
    if (parsed.map.lat === undefined || parsed.map.lng === undefined || parsed.map.address === undefined) {
      const r = { added: 0, updated: 0, rejected: [{ row: 0, reason: 'CSV needs address + lat + lng columns (got: ' + Object.keys(parsed.map).join(', ') + ')' }] };
      renderReport(r, filename); return r;
    }
    const report = await DF.sync.importRows(parsed.rows, { source: 'csv' });
    report.mapped = Object.keys(parsed.map); report.unmapped = parsed.unmapped;
    renderReport(report, filename); renderProgress();
    return report;
  }
  function renderReport(r, filename) {
    $('#import-report').innerHTML = '<p><b>' + DF.esc(filename || 'CSV') + '</b>: ' + r.added + ' added · ' + r.updated + ' updated · ' + r.rejected.length + ' rejected</p>' +
      (r.mapped ? '<p class="muted">Mapped: ' + DF.esc(r.mapped.join(', ')) + (r.unmapped && r.unmapped.length ? ' · ignored: ' + DF.esc(r.unmapped.join(', ')) : '') + '</p>' : '') +
      (r.rejected.length ? '<ul class="rejects">' + r.rejected.slice(0, 50).map(x => '<li>Row ' + x.row + ': ' + DF.esc(x.reason) + '</li>').join('') + '</ul>' : '');
  }
  function readFile(file) {
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => importCsv(fr.result, file.name);
    fr.readAsText(file);
  }

  // ---- turfs: polygon -> point-in-polygon -> bulk assign (one event per door) ----
  function turfs() { return DF.sync.meta('turfs') || []; }
  async function createTurf(poly, name, repEmail) {
    if (!isOwner(DF.auth.email)) { DF.toast('Owner only'); return null; }
    const ids = DF.map.pointsIn(poly), turfId = String(name || 'Turf ' + (turfs().length + 1)).trim();
    repEmail = String(repEmail || '').trim().toLowerCase();
    ids.forEach(id => DF.sync.mutate(id, { turf_id: turfId, assigned_rep_email: repEmail }, 'assign'));
    const list = turfs().filter(t => t.turf_id !== turfId).concat([{ turf_id: turfId, rep: repEmail, polygon: poly, created_at: new Date().toISOString(), doors: ids.length }]);
    await DF.sync.setMeta('turfs', list);
    renderProgress();
    DF.toast(ids.length + ' doors → ' + turfId + (repEmail ? ' (' + DF.firstName(repEmail) + ')' : ''));
    return { turf_id: turfId, ids };
  }
  function progress() {
    const by = {};
    DF.sync.all().forEach(r => {
      const k = r.turf_id || '(no turf)', p = by[k] = by[k] || { turf_id: k, total: 0, knocked: 0, sold: 0, reps: new Set() };
      p.total++; if (DF.sync.knock(r.status_code)) p.knocked++; if (r.status_code === 'SOLD') p.sold++;
      if (r.assigned_rep_email) p.reps.add(r.assigned_rep_email);
    });
    return Object.values(by).sort((a, b) => a.turf_id < b.turf_id ? -1 : 1).map(p => Object.assign(p, { reps: Array.from(p.reps) }));
  }
  function renderProgress() {
    const el = $('#turf-progress'); if (!el) return [];
    const rows = progress();
    el.innerHTML = '<table><thead><tr><th>Turf</th><th>Rep</th><th>Knocked / Total</th><th>Sold</th></tr></thead><tbody>' +
      rows.map(p => '<tr data-turf="' + DF.esc(p.turf_id) + '"><td>' + DF.esc(p.turf_id) + '</td><td>' + DF.esc(p.reps.map(DF.firstName).join(', ') || '—') +
        '</td><td><meter min="0" max="' + p.total + '" value="' + p.knocked + '"></meter> ' + p.knocked + ' / ' + p.total + '</td><td>' + p.sold + '</td></tr>').join('') + '</tbody></table>';
    return rows;
  }
  function repOptions() {
    const reps = (DF.cfg.REPS || []).slice();
    DF.sync.all().forEach(r => { if (r.assigned_rep_email && !reps.some(x => x.email === r.assigned_rep_email)) reps.push({ email: r.assigned_rep_email }); });
    $('#turf-rep').innerHTML = '<option value="">Unassigned</option>' + reps.map(r => '<option value="' + DF.esc(r.email) + '">' + DF.esc(r.name || r.email) + '</option>').join('');
  }

  function init() {
    const zone = $('#drop-zone'), input = $('#csv-input');
    ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('hover'); }));
    ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('hover'); }));
    zone.addEventListener('drop', e => readFile(e.dataTransfer.files[0]));
    zone.addEventListener('click', () => input.click());
    input.addEventListener('change', () => { readFile(input.files[0]); input.value = ''; });
    $('#turf-draw').addEventListener('click', () => {
      const name = $('#turf-name').value, rep = $('#turf-rep').value;
      DF.map.startLasso((poly) => { createTurf(poly, name, rep).then(() => DF.showTab('admin')); });
      DF.toast('Tap the turf corners on the map, then Done');
    });
    DF.bus.on('tab:changed', t => { if (t === 'admin') { repOptions(); renderProgress(); } });
    DF.bus.on('auth:role', role => { if (role === 'owner' && !isOwner(DF.auth.email)) return; DF.$('#tab-admin').hidden = role !== 'owner'; });
  }

  DF.admin = { init, isOwner, parseCsv, csvToRows, importCsv, createTurf, progress, renderProgress, turfs, ALIASES };
})();
