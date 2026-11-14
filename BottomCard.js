// Doorway Field v2.0 — BottomCard: slide-up house card + Lead Menu (optimistic < 30 ms flip, 5 s undo, SOLD never locked,
// optional soft-lock for Existing Customer), Appointment / Callback scheduler, 4-field SOLD capture, Notes, Lead Detail
// (Info | Notes | Activity). Activity is append-only: who, campaign, when, from → to, and GPS distance (ft) from the pin at the tap.
(function () {
  'use strict';
  const DF = window.DF;
  let current = null, armedLock = null;
  const $ = s => DF.$(s);
  const st = code => DF.sync.BY_CODE[code] || { label: code, short: code, icon: '?' };
  const fullName = r => [r.first_name, r.last_name].join(' ').trim();
  const addr = r => r.address + (r.apt ? ' ' + r.apt : '');
  const FIELD = ['tap', 'stamp', 'wheel'];          // field actions get a GPS proximity fix; bulk/lasso/list actions do not

  // ---- GPS proximity: one foreground fix right after the tap, appended as its own immutable event (feet only, no coordinates kept) ----
  function haversine(a, b) {
    const R = 6371000, rad = x => x * Math.PI / 180, dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function captureGps(ev) {
    const lead = DF.sync.get(ev.lead_id); if (!lead) return Promise.resolve(null);
    return DF.tools.locateFresh(800).then(fix => DF.sync.append({ type: 'gps_fix', ref: ev.event_id, lead_id: ev.lead_id, campaign: ev.campaign,
      ft: fix ? Math.round(haversine(fix.ll, [lead.lng, lead.lat]) * 3.281) : null, acc_ft: fix ? Math.round(fix.acc * 3.281) : null, gps: fix ? 'ok' : 'unavailable', fix: fix ? fix.fix : 'none', age_s: fix ? fix.age_s : null }));
  }

  // ---- the one disposition path (card tap, Rapid-Stamp, wheel, lasso, list bulk) ----
  function dispose(id, code, opts) {
    opts = opts || {};
    const t0 = performance.now(), r = DF.sync.get(id); if (!r || r.status_code === code && opts.source !== 'tap') return null;
    if (st(r.status_code).lock && code !== r.status_code && !opts.force) {
      if (!FIELD.includes(opts.source || 'tap')) return null;                         // bulk actions skip soft-locked pins
      if (armedLock !== id + code) { armedLock = id + code; DF.toast(st(r.status_code).label + ' is locked: tap ' + st(code).short + ' again to change'); return null; }
    }
    armedLock = null;
    const ev = DF.sync.mutate(id, { status_code: code }, 'status', { source: opts.source || 'tap' });
    DF.map.setStatus(id, code);
    if (current === id) paintCard(DF.sync.get(id));
    DF.lastFlipMs = performance.now() - t0;
    if (FIELD.includes(opts.source || 'tap')) DF.card.lastGps = captureGps(ev);
    return ev;
  }

  // ---- card ----
  function buildMenu() {
    $('#lead-menu').innerHTML = DF.sync.STATUS.filter(s => s.menu).map(s => '<button type="button" class="dispo dispo-' + s.code + '" data-code="' + s.code + '"><i>' + DF.esc(s.icon) + '</i><span>' + DF.esc(s.short) + '</span></button>').join('');
    DF.$$('#lead-menu .dispo').forEach(b => b.addEventListener('click', () => flip(b.dataset.code)));
  }
  function paintCard(r) {
    $('#card-name').textContent = fullName(r) || 'Homeowner';
    $('#card-status').textContent = st(r.status_code).label;
    $('#card-status').className = 'status-chip chip-' + r.status_code;
    $('#card-address').textContent = addr(r) + ', ' + [r.city, r.state, r.zip].filter(Boolean).join(' ');
    $('#card-dir').href = 'https://maps.google.com/?daddr=' + r.lat + ',' + r.lng;                 // 1-tap turn-by-turn in native maps
    const le = DF.sync.events(r.lead_id).filter(e => e.type === 'note' || e.type === 'status').pop();
    $('#card-last').textContent = le ? 'Last: ' + (le.type === 'note' ? '📝 ' + le.text : st(le.to).short) + ' · ' + DF.firstName(le.rep) + ' · ' + DF.fmtTime(le.device_ts) : '';
    $('#card-meta').textContent = r.campaign + ' · ' + DF.roster.name(r.assigned_rep_email);
    $('#card-appt').textContent = r.appt_at ? 'Appointment / callback ' + DF.fmtTime(r.appt_at) : '';
    $('#card-intel').textContent = r.turf_intel_note || '';
    DF.$$('#lead-menu .dispo').forEach(b => b.classList.toggle('on', b.dataset.code === r.status_code));
  }
  function open(id) {
    const t0 = performance.now(), r = DF.sync.get(id); if (!r) return;
    current = id; paintCard(r); $('#card').classList.add('open');
    DF.lastCardMs = performance.now() - t0;
  }
  function close() { $('#card').classList.remove('open'); current = null; }
  function flip(code) {
    if (!current) return;
    const id = current, ev = dispose(id, code, { source: 'tap' }); if (!ev) return;
    DF.toast(st(ev.from).label + ' → ' + st(code).label, 'Undo', () => { DF.sync.undo(ev); DF.map.setStatus(id, ev.from); if (current === id) paintCard(DF.sync.get(id)); }, DF.cfg.UNDO_MS);
    if (code === 'SOLD') openForms();
    if (code === 'APPT') openAppt('appointment');
  }

  // ---- Appointment / Callback + SOLD Forms ----
  function openAppt(kind) {
    const r = DF.sync.get(current); if (!r) return;
    $('#appt-kind').value = kind || 'appointment';
    $('#appt-input').value = r.appt_at ? new Date(new Date(r.appt_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
    DF.openModal('modal-appt');
  }
  function saveAppt(e) {
    e.preventDefault(); const v = $('#appt-input').value; if (!v || !current) return;
    DF.sync.mutate(current, { appt_at: new Date(v).toISOString() }, 'appt', { kind: $('#appt-kind').value });
    DF.closeModal('modal-appt'); paintCard(DF.sync.get(current)); DF.toast($('#appt-kind').value === 'callback' ? 'Callback scheduled' : 'Appointment set');
  }
  function buildForms() {
    $('#forms-fields').innerHTML = DF.cfg.SOLD_FIELDS.slice(0, 4).map(f => '<label><span>' + DF.esc(f.label) + (f.required ? ' *' : '') + '</span><input name="' + DF.esc(f.key) + '" type="' + DF.esc(f.type) + '"' + (f.required ? ' required' : '') + '></label>').join('');
  }
  function openForms() { const r = DF.sync.get(current); $('#forms-form').reset(); const n = $('#forms-fields input'); if (r && n) n.value = fullName(r); DF.openModal('modal-forms'); }
  function saveForms(e) {
    e.preventDefault(); if (!current) return;
    const form = {}; new FormData($('#forms-form')).forEach((v, k) => { form[k] = String(v).trim(); });
    if (DF.sync.get(current).status_code !== 'SOLD') dispose(current, 'SOLD', { source: 'tap', force: true });
    DF.sync.mutate(current, {}, 'sold_form', { form });                         // order details live in the event log only
    DF.closeModal('modal-forms'); paintCard(DF.sync.get(current)); DF.toast('SOLD order saved');
  }
  function saveNote(text, id) {
    id = id || current; text = String(text || '').trim().slice(0, 500); if (!text || !id) return;
    DF.sync.mutate(id, { rep_note: text }, 'note', { text });
    DF.toast('Note saved'); if ($('#details').classList.contains('open')) renderDetails('history');
  }

  // ---- Lead Detail: Info | Notes & History ----
  function describe(e, fixes) {
    const who = DF.roster.name(e.rep), f = fixes[e.event_id];
    const gps = e.type === 'status' ? (f ? (f.gps === 'ok' ? ' · 📍 ' + f.ft + ' ft from pin (±' + f.acc_ft + ' ft' + (f.fix === 'cached' ? ', cached fix ' + f.age_s + ' s old' : '') + ')' : ' · 📍 no GPS fix') : FIELD.includes(e.source) ? ' · 📍 locating…' : ' · ' + (e.source || 'bulk')) : '';
    const what = e.type === 'status' ? st(e.from).short + ' → ' + st(e.to).short : e.type === 'undo' ? 'Undo' + (e.to ? ' → ' + st(e.to).short : '')
      : e.type === 'assign' ? 'Assigned ' + DF.roster.name(e.prev_rep) + ' → ' + DF.roster.name(e.patch.assigned_rep_email) : e.type === 'appt' ? (e.kind === 'callback' ? 'Callback ' : 'Appointment ') + DF.fmtTime(e.patch.appt_at)
      : e.type === 'sold_form' ? 'SOLD order captured' : e.type === 'note' ? 'Note added' : e.type === 'create' ? 'Pin dropped (' + (e.how || 'map') + ')' : e.type === 'delete' ? 'Deleted' : e.type;
    const badge = (e.type === 'status' || e.type === 'undo') && e.to ? '<span class="status-chip chip-' + DF.esc(e.to) + '">' + DF.esc(st(e.to).short) + '</span> ' : e.type === 'note' ? '<span class="status-chip note-chip">Note</span> ' : '';
    return '<li class="h-' + DF.esc(e.type) + '"><time>' + DF.fmtTime(e.device_ts) + ' · ' + DF.esc(who) + ' · ' + DF.esc(e.campaign || '') + '</time><p>' + badge + DF.esc(e.type === 'note' ? e.text || '' : what + gps) + '</p></li>';
  }
  function renderDetails(tab) {
    const r = DF.sync.get(current); if (!r) return;
    tab = tab || 'info';
    DF.$$('.dtab').forEach(b => b.classList.toggle('active', b.dataset.dtab === tab));
    const body = $('#details-body'), all = DF.sync.events(r.lead_id), evs = all.filter(e => e.type !== 'gps_fix').slice().reverse();
    $('#details-title').textContent = addr(r);
    if (tab === 'info') {
      const rows = [['First Name', r.first_name], ['Last Name', r.last_name], ['Phone', r.phone], ['Email', r.email], ['Address', r.address], ['Apt', r.apt], ['City', r.city], ['Zip', r.zip],
        ['Campaign', r.campaign], ['Assigned Rep', DF.roster.name(r.assigned_rep_email)], ['Appointment', DF.fmtTime(r.appt_at)], ['Created', DF.fmtTime(r.created_at)], ['Turf', r.turf_id], ['Turf intel', r.turf_intel_note]];
      body.innerHTML = '<dl class="info">' + rows.map(x => '<dt>' + x[0] + '</dt><dd>' + (DF.esc(x[1]) || '—') + '</dd>').join('') + '</dl>' +
        '<div class="status-grid">' + DF.sync.STATUS.filter(s => s.menu).map(s => '<button type="button" class="dispo dispo-' + s.code + (s.code === r.status_code ? ' on' : '') + '" data-code="' + s.code + '"><i>' + DF.esc(s.icon) + '</i><span>' + DF.esc(s.short) + '</span></button>').join('') + '</div>' +
        '<div class="row-actions"><button type="button" class="btn" id="d-appt">Appointment</button><button type="button" class="btn" id="d-cb">Callback</button>' + (DF.isManager() ? '<button type="button" class="btn danger" id="d-delete">Delete</button>' : '') + '</div>';
      DF.$$('.status-grid .dispo', body).forEach(b => b.addEventListener('click', () => { flip(b.dataset.code); renderDetails('info'); }));
      $('#d-appt').addEventListener('click', () => openAppt('appointment')); $('#d-cb').addEventListener('click', () => openAppt('callback'));
      const del = $('#d-delete'); if (del) del.addEventListener('click', () => { DF.sync.removeMany([r.lead_id], 'detail'); DF.map.refresh(); DF.closeModal('details'); close(); DF.toast('Lead deleted (kept in history)'); });
    } else {                                                          // Notes & History: one newest-first feed + Add Note (no status change needed)
      const fixes = {}; all.filter(e => e.type === 'gps_fix').forEach(e => { fixes[e.ref] = e; });
      body.innerHTML = '<form class="note-form" id="d-note-form"><input id="d-note" maxlength="500" placeholder="Add a note..." aria-label="Add a note"><button class="btn primary" type="submit">Save</button></form>' +
        '<h4>Notes &amp; Activity History</h4><p class="muted small">Append-only. GPS = distance from the pin when the status was tapped.</p><ul class="timeline">' +
        (evs.map(e => describe(e, fixes)).join('') || '<li class="empty">No notes or activity yet</li>') + '</ul>';
      $('#d-note-form').addEventListener('submit', ev => { ev.preventDefault(); saveNote($('#d-note').value); });
    }
  }

  function init() {
    buildMenu(); buildForms();
    $('#card-close').addEventListener('click', () => { close(); DF.map.select([]); });
    $('#card-details').addEventListener('click', () => { if (!current) return; DF.openModal('details'); renderDetails('info'); });
    $('#card-appt-btn').addEventListener('click', () => openAppt('appointment'));
    $('#card-cb-btn').addEventListener('click', () => openAppt('callback'));
    $('#card-forms-btn').addEventListener('click', openForms);
    $('#card-note-form').addEventListener('submit', e => { e.preventDefault(); saveNote($('#card-note').value); $('#card-note').value = ''; });
    $('#appt-form').addEventListener('submit', saveAppt);
    $('#forms-form').addEventListener('submit', saveForms);
    DF.$$('.dtab').forEach(b => b.addEventListener('click', () => renderDetails(b.dataset.dtab)));
    DF.bus.on('pin:selected', open);
    DF.bus.on('map:blank', close);
    DF.bus.on('statuses:changed', () => { buildMenu(); if (current) paintCard(DF.sync.get(current)); });
    DF.bus.on('sync:state', s => { $('#sync-state').textContent = s; $('#sync-state').className = 'sync sync-' + s; const n = DF.sync.queueSize(); $('#sync-queue').textContent = n ? n + ' queued' : ''; });
  }

  DF.card = { init, open, close, flip, dispose, saveNote, renderDetails, haversine, current: () => current, lastGps: null };
})();
