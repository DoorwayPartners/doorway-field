// Doorway Field v2.0 — LassoSheet: bottom sheet for a lasso / multi-select. Rep Breakdown & Assign, Disposition Breakdown with
// tap-to-toggle filters + Change Status, Create Route (≤ 23 numbered stops, Google legs of 10 / Apple per stop), Export, Delete.
// Closing or applying clears the lasso shape and highlight: no permanent boundaries on the map.
(function () {
  'use strict';
  const DF = window.DF;
  const $ = s => DF.$(s);
  let ids = [], toggled = null, armedDelete = false, route = [];

  const leads = () => ids.map(DF.sync.get).filter(r => r && !r._deleted);
  const repKey = r => DF.filters.repKey(r);
  function counts(fn) { const c = {}; leads().forEach(r => { const k = fn(r); c[k] = (c[k] || 0) + 1; }); return c; }
  // Disposition toggle math: which doors change when applying `target` with the toggled-on statuses (already-target doors are skipped).
  function plan(target, on) { on = on || toggled; return leads().filter(r => on.has(r.status_code) && r.status_code !== target).map(r => r.lead_id); }

  function render() {
    const L = leads(), reps = counts(repKey), disp = counts(r => r.status_code);
    if (!toggled) toggled = new Set(Object.keys(disp));
    const target = $('#ls-target') ? $('#ls-target').value : 'NEW';
    $('#ls-title').textContent = L.length + ' doors · ' + ($('#lasso-sheet').dataset.title || 'Lasso');
    $('#ls-reps').innerHTML = Object.keys(reps).sort().map(k => '<li><i class="dot rc-' + DF.esc(DF.roster.get(k) ? DF.roster.get(k).id : 'none') + '"></i><b>' + DF.esc(DF.roster.name(k)) + '</b><span>' + reps[k] + '</span></li>').join('');
    $('#ls-rep').innerHTML = '<option value="">Unassigned</option>' + DF.roster.all().map(r => '<option value="' + DF.esc(r.id) + '">' + DF.esc(r.name) + ' (' + DF.esc(r.role) + ')</option>').join('');
    $('#ls-disp').innerHTML = Object.keys(disp).map(code => { const s = DF.sync.BY_CODE[code] || { short: code, icon: '?' };
      return '<li><button type="button" class="tog dispo-' + code + (toggled.has(code) ? ' on' : '') + '" data-code="' + code + '"><i>' + DF.esc(s.icon) + '</i>' + DF.esc(s.short) + '</button><span>' + disp[code] + '</span></li>'; }).join('');
    $('#ls-target').innerHTML = DF.sync.STATUS.filter(s => s.menu).map(s => '<option value="' + s.code + '"' + (s.code === target ? ' selected' : '') + '>' + DF.esc(s.label) + '</option>').join('');
    updatePlan();
    DF.$$('#ls-disp .tog').forEach(b => b.addEventListener('click', () => { toggled.has(b.dataset.code) ? toggled.delete(b.dataset.code) : toggled.add(b.dataset.code); b.classList.toggle('on'); updatePlan(); }));
    DF.ringCss();
  }
  function updatePlan() { const n = plan($('#ls-target').value).length; $('#ls-apply').textContent = 'Change ' + n + ' → ' + (DF.sync.BY_CODE[$('#ls-target').value] || {}).short; $('#ls-apply').disabled = !n; }

  function assign() {
    const rep = $('#ls-rep').value, list = leads().filter(r => r.assigned_rep_email !== rep);
    list.forEach(r => { DF.sync.mutate(r.lead_id, { assigned_rep_email: rep }, 'assign', { source: 'lasso' }); DF.map.setRing(r.lead_id); });
    DF.toast(list.length + ' doors → ' + DF.roster.name(rep)); render(); DF.map.refresh();
    return list.length;
  }
  function apply() {
    const target = $('#ls-target').value, todo = plan(target);
    const done = todo.map(id => DF.card.dispose(id, target, { source: 'bulk' })).filter(Boolean);
    DF.toast(done.length + ' doors → ' + DF.sync.BY_CODE[target].short + (done.length < todo.length ? ' (' + (todo.length - done.length) + ' locked, skipped)' : ''));
    close();
    return done.length;
  }

  // ---- route: nearest-neighbour order from the rep's position, ≤ ROUTE_MAX_STOPS stops among the toggled-on statuses ----
  function buildRoute(from) {
    let pool = leads().filter(r => toggled.has(r.status_code)), here = from || DF.tools.position(); const out = [];
    while (pool.length && out.length < DF.cfg.ROUTE_MAX_STOPS) {
      let best = 0, bd = Infinity;
      pool.forEach((r, i) => { const d = DF.card.haversine(here, [r.lng, r.lat]); if (d < bd) { bd = d; best = i; } });
      const r = pool.splice(best, 1)[0]; out.push(r); here = [r.lng, r.lat];
    }
    return out;
  }
  const ll = r => r.lat + ',' + r.lng;
  function googleLegs(stops, origin) {          // free Maps URLs allow 9 waypoints (3 in a mobile browser): legs of up to 10 stops
    const legs = [];
    for (let i = 0; i < stops.length; i += 10) {
      const leg = stops.slice(i, i + 10), o = i === 0 ? origin : ll(stops[i - 1]);
      legs.push('https://www.google.com/maps/dir/?api=1&travelmode=driving' + (o ? '&origin=' + encodeURIComponent(o) : '') + '&destination=' + encodeURIComponent(ll(leg[leg.length - 1])) +
        (leg.length > 1 ? '&waypoints=' + encodeURIComponent(leg.slice(0, -1).map(ll).join('|')) : ''));
    }
    return legs;
  }
  async function makeRoute() {
    const fix = await DF.tools.locateOnce(30000), origin = fix ? fix.ll : null;
    route = buildRoute(origin);
    DF.map.setRoute(route.map(r => [r.lng, r.lat]));
    const legs = googleLegs(route, origin ? origin[1] + ',' + origin[0] : '');
    $('#ls-route').innerHTML = '<div class="legs">' + legs.map((u, i) => '<a class="btn" target="_blank" rel="noopener" href="' + DF.esc(u) + '">Google Maps' + (legs.length > 1 ? ' · stops ' + (i * 10 + 1) + '–' + Math.min(route.length, i * 10 + 10) : '') + '</a>').join('') + '</div>' +
      '<ol class="stops">' + route.map(r => '<li><b>' + DF.esc(r.address) + '</b> <a target="_blank" rel="noopener" href="https://maps.apple.com/?dirflg=d&daddr=' + encodeURIComponent(ll(r)) + '">Apple Maps</a></li>').join('') + '</ol>';
    $('#route-clear').hidden = !route.length;
    return { stops: route.map(r => r.lead_id), legs };
  }

  function exportSel() { return DF.imports.exportCsv(leads(), 'Selected'); }
  function del() {
    if (!armedDelete) { armedDelete = true; $('#ls-delete').textContent = 'Tap again to delete ' + leads().length; setTimeout(() => { armedDelete = false; $('#ls-delete').textContent = 'Delete Selected'; }, 3000); return 0; }
    const n = DF.sync.removeMany(ids, 'lasso').length; armedDelete = false; DF.map.refresh(); DF.toast(n + ' doors deleted (kept in history)'); close(); return n;
  }

  function open(list, title) {
    ids = list.slice(); toggled = null; armedDelete = false;
    $('#lasso-sheet').dataset.title = title || 'Lasso';
    $('#ls-route').innerHTML = '';
    render(); DF.openModal('lasso-sheet');
  }
  function close() { DF.closeModal('lasso-sheet'); DF.map.drawLasso([]); DF.map.select([]); ids = []; }

  function init() {
    $('#ls-close').addEventListener('click', close);
    $('#ls-assign').addEventListener('click', assign);
    $('#ls-target').addEventListener('change', updatePlan);
    $('#ls-apply').addEventListener('click', apply);
    $('#ls-route-btn').addEventListener('click', makeRoute);
    $('#ls-export').addEventListener('click', exportSel);
    $('#ls-delete').addEventListener('click', del);
    $('#route-clear').addEventListener('click', () => { DF.map.setRoute([]); route = []; $('#route-clear').hidden = true; });
  }

  DF.lasso = { init, open, close, plan, assign, apply, buildRoute, googleLegs, makeRoute, del, ids: () => ids.slice(), toggled: () => toggled, setToggled: s => { toggled = new Set(s); render(); } };
})();
