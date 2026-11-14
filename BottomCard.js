// Doorway Field v1.0 — BottomCard: slide-up house card + Lead Menu (optimistic < 30 ms flip, 5 s undo), Appointment and
// SOLD Forms modals, Details (Info | Notes | Activity), List (nearest first, 1-tap Jump to Pin), Stats (Leaderboard + My Stats).
(function () {
  'use strict';
  const DF = window.DF;
  let current = null, bulk = null, range = 'today';
  const $ = s => DF.$(s);
  const label = code => (DF.sync.BY_CODE[code] || { label: code }).label;
  const fullName = r => [r.first_name, r.last_name].join(' ').trim();
  const addr = r => r.address + (r.apt ? ' ' + r.apt : '');

  // ---- card ----
  function buildMenu() {
    const strip = $('#lead-menu');
    DF.sync.STATUS.filter(s => s.menu).forEach(s => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'dispo dispo-' + s.code; b.dataset.code = s.code;
      b.innerHTML = '<i>' + DF.esc(s.icon) + '</i><span>' + DF.esc(s.short) + '</span>';
      b.addEventListener('click', () => flip(s.code));
      strip.appendChild(b);
    });
  }
  function paintCard(r) {
    $('#card-name').textContent = fullName(r) || 'Homeowner';
    $('#card-status').textContent = label(r.status_code);
    $('#card-status').className = 'status-chip chip-' + r.status_code;
    $('#card-address').textContent = addr(r) + ', ' + [r.city, r.state, r.zip].filter(Boolean).join(' ');
    $('#card-appt').textContent = r.appt_at ? 'Appointment ' + DF.fmtTime(r.appt_at) : '';
    $('#card-intel').textContent = r.turf_intel_note || '';
    DF.$$('#lead-menu .dispo').forEach(b => b.classList.toggle('on', b.dataset.code === r.status_code));
  }
  function open(id) {
    const t0 = performance.now(), r = DF.sync.get(id); if (!r) return;
    current = id; bulk = null;
    $('#card').classList.remove('bulk');
    paintCard(r);
    $('#card').classList.add('open');
    DF.lastCardMs = performance.now() - t0;
  }
  function openBulk(ids) {
    if (!ids.length) return;
    bulk = ids.slice(); current = null;
    $('#card-name').textContent = ids.length + ' doors selected';
    $('#card-status').textContent = 'Bulk status'; $('#card-status').className = 'status-chip';
    $('#card-address').textContent = 'Tap a status to apply it to every selected door';
    $('#card-appt').textContent = ''; $('#card-intel').textContent = '';
    $('#card').classList.add('open', 'bulk'); $('#sel-bar').classList.remove('open');   // the bulk card replaces the selection bar
  }
  function close() { $('#card').classList.remove('open', 'bulk'); current = null; bulk = null; }

  // The flip: memory write (sync) -> source diff to the map -> card repaint. IndexedDB + queue happen after, off the tap path.
  function flip(code) {
    const t0 = performance.now();
    if (bulk) {
      const evs = bulk.map(id => { const e = DF.sync.mutate(id, { status_code: code }, 'status'); DF.map.setStatus(id, code); return e; });
      DF.lastFlipMs = performance.now() - t0;
      DF.toast(evs.length + ' doors → ' + label(code), 'Undo', () => evs.forEach(e => { DF.sync.undo(e); DF.map.setStatus(e.lead_id, e.from); }), DF.cfg.UNDO_MS);
      close(); DF.map.select([]); return;
    }
    if (!current) return;
    const id = current, ev = DF.sync.mutate(id, { status_code: code }, 'status');
    DF.map.setStatus(id, code);
    paintCard(DF.sync.get(id));
    DF.lastFlipMs = performance.now() - t0;
    DF.toast(label(ev.from) + ' → ' + label(code), 'Undo', () => { DF.sync.undo(ev); DF.map.setStatus(id, ev.from); if (current === id) paintCard(DF.sync.get(id)); }, DF.cfg.UNDO_MS);
    if (code === 'SOLD') openForms();
    if (code === 'APPT') openAppt();
  }

  // ---- Appointment + SOLD Forms ----
  function openAppt() {
    const r = DF.sync.get(current); if (!r) return;
    $('#appt-input').value = r.appt_at ? new Date(new Date(r.appt_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
    DF.openModal('modal-appt');
  }
  function saveAppt(e) {
    e.preventDefault();
    const v = $('#appt-input').value; if (!v || !current) return;
    DF.sync.mutate(current, { appt_at: new Date(v).toISOString() }, 'appt');
    DF.closeModal('modal-appt'); paintCard(DF.sync.get(current)); DF.toast('Appointment set');
  }
  function buildForms() {
    const box = $('#forms-fields');
    DF.cfg.SOLD_FIELDS.slice(0, 4).forEach(f => {
      const l = document.createElement('label');
      l.innerHTML = '<span>' + DF.esc(f.label) + (f.required ? ' *' : '') + '</span><input name="' + DF.esc(f.key) + '" type="' + DF.esc(f.type) + '"' + (f.required ? ' required' : '') + '>';
      box.appendChild(l);
    });
  }
  function openForms() { const r = DF.sync.get(current); $('#forms-form').reset(); if (r) { const n = $('#forms-fields input'); if (n && !n.value) n.value = fullName(r); } DF.openModal('modal-forms'); }
  function saveForms(e) {
    e.preventDefault(); if (!current) return;
    const form = {}; new FormData($('#forms-form')).forEach((v, k) => { form[k] = String(v).trim(); });
    const patch = DF.sync.get(current).status_code === 'SOLD' ? {} : { status_code: 'SOLD' };
    DF.sync.mutate(current, patch, 'sold_form', { form });   // form lives in Field_Events only (owner + assigned rep)
    if (patch.status_code) DF.map.setStatus(current, 'SOLD');
    DF.closeModal('modal-forms'); paintCard(DF.sync.get(current)); DF.toast('SOLD order saved');
  }

  // ---- Notes ----
  function saveNote(text, id) {
    id = id || current; text = String(text || '').trim().slice(0, 500); if (!text || !id) return;
    DF.sync.mutate(id, { rep_note: text }, 'note', { text });
    DF.toast('Note saved'); if ($('#details').classList.contains('open')) renderDetails('notes');
  }

  // ---- Details: Info | Notes | Activity (no distance or tracking badges) ----
  function renderDetails(tab) {
    const r = DF.sync.get(current); if (!r) return;
    tab = tab || 'info';
    DF.$$('.dtab').forEach(b => b.classList.toggle('active', b.dataset.dtab === tab));
    const body = $('#details-body'), evs = DF.sync.events(r.lead_id).slice().reverse();
    $('#details-title').textContent = addr(r);
    if (tab === 'info') {
      const rows = [['First Name', r.first_name], ['Last Name', r.last_name], ['Phone', r.phone], ['Email', r.email], ['Address', r.address], ['Apt', r.apt],
        ['City', r.city], ['Zip', r.zip], ['Assigned Rep', r.assigned_rep_email || 'Unassigned'], ['Appointment', DF.fmtTime(r.appt_at)], ['Turf', r.turf_id], ['Turf intel', r.turf_intel_note]];
      body.innerHTML = '<dl class="info">' + rows.map(x => '<dt>' + x[0] + '</dt><dd>' + (DF.esc(x[1]) || '—') + '</dd>').join('') + '</dl>' +
        '<div class="status-grid">' + DF.sync.STATUS.filter(s => s.menu).map(s => '<button type="button" class="dispo dispo-' + s.code + (s.code === r.status_code ? ' on' : '') +
        '" data-code="' + s.code + '"><i>' + DF.esc(s.icon) + '</i><span>' + DF.esc(s.short) + '</span></button>').join('') + '</div>' +
        '<div class="row-actions"><button type="button" class="btn" id="d-appt">Set Appointment</button>' +
        (DF.auth.role === 'owner' ? '<button type="button" class="btn danger" id="d-delete">Delete Lead</button>' : '') + '</div>';
      DF.$$('.status-grid .dispo', body).forEach(b => b.addEventListener('click', () => { flip(b.dataset.code); renderDetails('info'); }));
      $('#d-appt').addEventListener('click', openAppt);
      const del = $('#d-delete');
      if (del) del.addEventListener('click', () => { DF.sync.mutate(r.lead_id, { _deleted: true }, 'delete'); DF.map.refresh(); DF.closeModal('details'); close(); DF.toast('Lead deleted (kept in history)'); });
    } else if (tab === 'notes') {
      const notes = evs.filter(e => e.type === 'note');
      body.innerHTML = '<form class="note-form" id="d-note-form"><input id="d-note" maxlength="500" placeholder="Add a note..."><button class="btn" type="submit">Save</button></form>' +
        '<ul class="timeline">' + (notes.map(e => '<li><time>' + DF.fmtTime(e.device_ts) + ' · ' + DF.esc(DF.firstName(e.rep)) + '</time><p>' + DF.esc(e.text) + '</p></li>').join('') || '<li class="empty">No notes yet</li>') + '</ul>';
      $('#d-note-form').addEventListener('submit', ev => { ev.preventDefault(); saveNote($('#d-note').value); });
    } else {
      const act = evs.map(e => {
        const what = e.type === 'status' || e.type === 'undo' && e.to ? label(e.from) + ' → ' + label(e.to) : e.type === 'appt' ? 'Appointment ' + DF.fmtTime(e.patch.appt_at)
          : e.type === 'sold_form' ? 'SOLD order captured' : e.type === 'note' ? 'Note added' : e.type === 'assign' ? 'Assigned to ' + e.patch.assigned_rep_email : e.type;
        return '<li><time>' + DF.fmtTime(e.device_ts) + ' · ' + DF.esc(DF.firstName(e.rep)) + '</time><p>' + DF.esc(what) + '</p></li>';
      });
      body.innerHTML = '<ul class="timeline">' + (act.join('') || '<li class="empty">No activity yet</li>') + '</ul>';
    }
  }

  // ---- List: straight-line distance from GPS (or map centre), nearest first ----
  function haversine(a, b) {
    const R = 6371000, rad = x => x * Math.PI / 180, dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const fmtDist = m => m < 1609 ? Math.round(m * 3.281) + ' ft' : (m / 1609.34).toFixed(1) + ' mi';
  function renderList(from) {
    from = from || DF.map.position();
    const q = $('#list-search').value.trim().toLowerCase(), st = $('#list-filter').value;
    const rows = DF.sync.all().filter(r => (!st || r.status_code === st) && (!q || (addr(r) + ' ' + fullName(r)).toLowerCase().includes(q)))
      .map(r => ({ r, d: haversine(from, [r.lng, r.lat]) })).sort((a, b) => a.d - b.d).slice(0, 300);
    $('#list-items').innerHTML = rows.map(x => '<li data-id="' + x.r.lead_id + '"><span class="status-chip chip-' + x.r.status_code + '">' + DF.esc((DF.sync.BY_CODE[x.r.status_code] || {}).short || x.r.status_code) +
      '</span><div><b>' + DF.esc(addr(x.r)) + '</b><small>' + DF.esc(fullName(x.r) || x.r.city) + ' · ' + fmtDist(x.d) + '</small></div><button type="button" class="btn jump">Jump to Pin</button></li>').join('') || '<li class="empty">No doors match</li>';
    DF.$$('#list-items .jump').forEach(b => b.addEventListener('click', () => DF.map.jumpTo(b.closest('li').dataset.id)));
    return rows.map(x => x.r.lead_id);
  }

  // ---- Stats: from Field_Events (knock = status tap on a knock code; sale = SOLD) ----
  function since(rg) {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    if (rg === 'week') d.setDate(d.getDate() - d.getDay()); else if (rg === 'month') d.setDate(1); else if (rg === 'year') d.setMonth(0, 1);
    return d.toISOString();
  }
  function stats(rg) {
    const from = since(rg || range), per = {};
    const undone = new Set(DF.sync.events().filter(e => e.undo_of).map(e => e.undo_of));
    DF.sync.events().forEach(e => {
      if (e.type !== 'status' || e.device_ts < from || undone.has(e.event_id)) return;
      const p = per[e.rep] = per[e.rep] || { rep: e.rep, knocks: 0, sales: 0, appts: 0 };
      if (DF.sync.knock(e.to)) p.knocks++;
      if (e.to === 'SOLD') p.sales++;
      if (e.to === 'APPT') p.appts++;
    });
    const board = Object.values(per).sort((a, b) => b.sales - a.sales || b.knocks - a.knocks);
    return { board, me: per[DF.auth.email] || { knocks: 0, sales: 0, appts: 0 } };
  }
  function renderStats() {
    const s = stats();
    DF.$$('.range').forEach(b => b.classList.toggle('active', b.dataset.range === range));
    $('#my-knocks').textContent = s.me.knocks; $('#my-sales').textContent = s.me.sales; $('#my-appts').textContent = s.me.appts;
    $('#my-close').textContent = s.me.knocks ? Math.round(100 * s.me.sales / s.me.knocks) + '%' : '0%';
    $('#leaderboard').innerHTML = s.board.map((p, i) => '<li><span class="rank">' + (i + 1) + '</span><b>' + DF.esc(DF.firstName(p.rep)) + '</b><span>' + p.sales + ' sold · ' + p.knocks + ' knocks</span></li>').join('') || '<li class="empty">No knocks yet</li>';
    return s;
  }

  function init() {
    buildMenu(); buildForms();
    const f = $('#list-filter');
    f.innerHTML = '<option value="">All statuses</option>' + DF.sync.STATUS.map(s => '<option value="' + s.code + '">' + DF.esc(s.label) + '</option>').join('');
    $('#card-close').addEventListener('click', () => { close(); DF.map.select([]); });
    $('#card-details').addEventListener('click', () => { if (!current) return; DF.openModal('details'); renderDetails('info'); });
    $('#card-appt-btn').addEventListener('click', openAppt);
    $('#card-forms-btn').addEventListener('click', openForms);
    $('#card-note-form').addEventListener('submit', e => { e.preventDefault(); saveNote($('#card-note').value); $('#card-note').value = ''; });
    $('#appt-form').addEventListener('submit', saveAppt);
    $('#forms-form').addEventListener('submit', saveForms);
    DF.$$('.dtab').forEach(b => b.addEventListener('click', () => renderDetails(b.dataset.dtab)));
    DF.$$('.range').forEach(b => b.addEventListener('click', () => { range = b.dataset.range; renderStats(); }));
    $('#list-search').addEventListener('input', () => renderList());
    f.addEventListener('change', () => renderList());
    DF.bus.on('pin:selected', open);
    DF.bus.on('map:blank', close);
    DF.bus.on('bulk:open', openBulk);
    DF.bus.on('tab:changed', t => { if (t === 'list') { renderList(); DF.map.locateOnce().then(renderList); } if (t === 'stats') renderStats(); });
    DF.bus.on('dispo:queued', () => { if (DF.currentTab === 'stats') renderStats(); });
    DF.bus.on('sync:state', s => { $('#sync-state').textContent = s; $('#sync-state').className = 'sync sync-' + s; $('#sync-queue').textContent = DF.sync.queueSize() ? DF.sync.queueSize() + ' queued' : ''; });
  }

  DF.card = { init, open, openBulk, close, flip, saveNote, renderDetails, renderList, renderStats, stats, haversine, current: () => current };
})();
