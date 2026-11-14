// Doorway Field v1.1 — TurfAdmin (owner only): owner gate, polygon/lasso turf creator + rep assignment, live progress
// (Knocked / Total / Sold). CSV import lives in LeadImport.js since v1.1. The Doorway Field API re-checks owner actions (Foundation §7).
(function () {
  'use strict';
  const DF = window.DF;
  const $ = s => DF.$(s);

  function isOwner(email) {
    email = String(email || '').toLowerCase();
    const list = (DF.cfg.OWNER_EMAILS || []).map(e => String(e).toLowerCase());
    return !!email && email.endsWith('@' + DF.cfg.OWNER_DOMAIN) && list.includes(email);   // fail closed when the list is empty
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
    const reps = DF.imports.reps();   // owner + CSV + map reps, built at runtime (v1.1.1)
    $('#turf-rep').innerHTML = '<option value="">Unassigned</option>' + reps.map(r => '<option value="' + DF.esc(r.email) + '">' + DF.esc(r.name || r.email) + '</option>').join('');
  }

  function init() {
    $('#turf-draw').addEventListener('click', () => {
      const name = $('#turf-name').value, rep = $('#turf-rep').value;
      DF.map.startLasso((poly) => { createTurf(poly, name, rep).then(() => DF.showTab('admin')); });
      DF.toast('Tap the turf corners on the map, then Done');
    });
    DF.bus.on('tab:changed', t => { if (t === 'admin') { repOptions(); renderProgress(); } });
    DF.bus.on('auth:role', role => { if (role === 'owner' && !isOwner(DF.auth.email)) return; DF.$('#tab-admin').hidden = role !== 'owner'; });
  }

  DF.admin = { init, isOwner, createTurf, progress, renderProgress, turfs };
})();
