// Doorway Field v2.0 — ListView: search, Callbacks / Appts quick filter, multi-select (Bulk Status, Bulk Reassign, Bulk Delete),
// column toggles, nearest-first with 1-tap Jump, and 1-tap export of exactly the filtered rows (19 SalesRabbit columns + Campaign).
(function () {
  'use strict';
  const DF = window.DF;
  const $ = s => DF.$(s);
  const COLS = [['rep', 'Rep'], ['campaign', 'Campaign'], ['dist', 'Distance'], ['appt', 'Appt'], ['phone', 'Phone']];
  let cbOnly = false, armedDelete = false, here = null;
  const picked = new Set();
  const fmtDist = m => m < 1609 ? Math.round(m * 3.281) + ' ft' : (m / 1609.34).toFixed(1) + ' mi';
  const addr = r => r.address + (r.apt ? ' ' + r.apt : '');

  function rows() {
    const q = $('#list-search').value.trim().toLowerCase(), from = here || DF.tools.position();
    return DF.sync.all().filter(DF.filters.match).filter(r => (!cbOnly || r.appt_at) && (!q || (addr(r) + ' ' + r.first_name + ' ' + r.last_name + ' ' + r.phone + ' ' + r.zip).toLowerCase().includes(q)))
      .map(r => ({ r, d: DF.card.haversine(from, [r.lng, r.lat]) })).sort((a, b) => cbOnly ? (a.r.appt_at < b.r.appt_at ? -1 : 1) : a.d - b.d);
  }
  function render() {
    const all = rows(), shown = all.slice(0, 300);
    Array.from(picked).forEach(id => { if (!all.some(x => x.r.lead_id === id)) picked.delete(id); });
    $('#list-count').textContent = all.length + ' doors' + (all.length > 300 ? ' (first 300 shown)' : '');
    $('#list-body').innerHTML = shown.map(x => { const r = x.r, s = DF.sync.BY_CODE[r.status_code] || { short: r.status_code };
      return '<tr data-id="' + r.lead_id + '"><td><input type="checkbox" class="pick"' + (picked.has(r.lead_id) ? ' checked' : '') + '></td><td><span class="status-chip chip-' + r.status_code + '">' + DF.esc(s.short) + '</span></td>' +
        '<td><b>' + DF.esc(addr(r)) + '</b><small>' + DF.esc([r.first_name, r.last_name].join(' ').trim() || r.city) + '</small></td><td class="c-rep"><i class="dot rc-' + DF.esc(DF.filters.repKey(r) && DF.roster.get(r.assigned_rep_email) ? DF.roster.get(r.assigned_rep_email).id : 'none') + '"></i>' + DF.esc(DF.firstName(r.assigned_rep_email)) +
        '</td><td class="c-campaign">' + DF.esc(r.campaign) + '</td><td class="c-dist">' + fmtDist(x.d) + '</td><td class="c-appt">' + DF.esc(DF.fmtTime(r.appt_at)) + '</td><td class="c-phone">' + DF.esc(r.phone) +
        '</td><td><button type="button" class="btn jump">Jump</button></td></tr>'; }).join('') || '<tr><td colspan="9" class="empty">No doors match</td></tr>';
    DF.$$('#list-body .jump').forEach(b => b.addEventListener('click', () => DF.map.jumpTo(b.closest('tr').dataset.id)));
    DF.$$('#list-body .pick').forEach(c => c.addEventListener('change', () => { const id = c.closest('tr').dataset.id; c.checked ? picked.add(id) : picked.delete(id); bulkBar(); }));
    $('#list-all').checked = shown.length > 0 && shown.every(x => picked.has(x.r.lead_id));
    DF.ringCss(); bulkBar();
    return all.map(x => x.r.lead_id);
  }
  function bulkBar() {
    $('#list-bulk').hidden = !picked.size; $('#list-picked').textContent = picked.size + ' selected';
    $('#bulk-delete').hidden = !DF.isManager(); $('#bulk-rep-wrap').hidden = !DF.isManager();
  }
  function fillPickers() {
    $('#bulk-status').innerHTML = DF.sync.STATUS.filter(s => s.menu).map(s => '<option value="' + s.code + '">' + DF.esc(s.label) + '</option>').join('');
    $('#bulk-rep').innerHTML = '<option value="">Unassigned</option>' + DF.roster.all().map(r => '<option value="' + DF.esc(r.id) + '">' + DF.esc(r.name) + '</option>').join('');
    $('#list-cols').innerHTML = COLS.map(c => '<label class="chk"><input type="checkbox" value="' + c[0] + '"' + (DF.store.get('hide.' + c[0], false) ? '' : ' checked') + '> ' + c[1] + '</label>').join('');
    DF.$$('#list-cols input').forEach(i => { $('#list-table').classList.toggle('hide-' + i.value, !i.checked);
      i.addEventListener('change', () => { DF.store.set('hide.' + i.value, !i.checked); $('#list-table').classList.toggle('hide-' + i.value, !i.checked); }); });
  }
  function bulkStatus() { const code = $('#bulk-status').value, n = Array.from(picked).map(id => DF.card.dispose(id, code, { source: 'bulk' })).filter(Boolean).length; DF.toast(n + ' doors → ' + DF.sync.BY_CODE[code].short); picked.clear(); render(); return n; }
  function bulkReassign() {
    const rep = $('#bulk-rep').value; let n = 0;
    picked.forEach(id => { const r = DF.sync.get(id); if (r && r.assigned_rep_email !== rep) { DF.sync.mutate(id, { assigned_rep_email: rep }, 'assign', { source: 'list' }); DF.map.setRing(id); n++; } });
    DF.toast(n + ' doors → ' + DF.roster.name(rep)); picked.clear(); render(); DF.map.refresh(); return n;
  }
  function bulkDelete() {
    if (!armedDelete) { armedDelete = true; $('#bulk-delete').textContent = 'Tap again to delete ' + picked.size; setTimeout(() => { armedDelete = false; $('#bulk-delete').textContent = 'Delete'; }, 3000); return 0; }
    const n = DF.sync.removeMany(Array.from(picked), 'list').length; armedDelete = false; $('#bulk-delete').textContent = 'Delete'; picked.clear(); DF.map.refresh(); render(); DF.toast(n + ' deleted (kept in history)'); return n;
  }
  function exportFiltered() { return DF.imports.exportCsv(rows().map(x => x.r), DF.campaign === '*' ? 'All-Campaigns' : DF.campaign); }

  function init() {
    $('#list-search').addEventListener('input', render);
    $('#list-cb').addEventListener('click', () => { cbOnly = !cbOnly; $('#list-cb').classList.toggle('on', cbOnly); render(); });
    $('#list-all').addEventListener('change', e => { DF.$$('#list-body tr[data-id]').forEach(tr => e.target.checked ? picked.add(tr.dataset.id) : picked.delete(tr.dataset.id)); render(); });
    $('#list-colbtn').addEventListener('click', () => $('#list-cols').classList.toggle('open'));
    $('#bulk-status-go').addEventListener('click', bulkStatus);
    $('#bulk-rep-go').addEventListener('click', bulkReassign);
    $('#bulk-delete').addEventListener('click', bulkDelete);
    $('#list-export').addEventListener('click', exportFiltered);
    DF.bus.on('tab:changed', t => { if (t === 'list') { fillPickers(); render(); DF.tools.locateOnce().then(f => { if (f) { here = f.ll; render(); } }); } });
    ['filters:changed', 'campaign:changed', 'pins:changed'].forEach(ev => DF.bus.on(ev, () => { if (DF.currentTab === 'list') render(); }));
  }

  DF.list = { init, render, rows, bulkStatus, bulkReassign, bulkDelete, exportFiltered, pick: list => { picked.clear(); list.forEach(id => picked.add(id)); render(); }, setHere: p => { here = p; } };
})();
