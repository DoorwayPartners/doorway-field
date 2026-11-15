// Doorway Field v2.5 — TurfLasso: pink freehand finger-lasso. The Turf Draw toggle (⬠) turns pink, shows "👆 Draw turf with your finger" and pauses
// map panning; the finger (or mouse) path draws a live pink line. On lift the path is smoothed (Douglas-Peucker, 3 px), closed, the doors inside counted
// (point-in-polygon, same filters as the map), panning restored, and the compact Assign Turf sheet opens: door count · rep · campaign · Save Turf / Clear / More.
(function () {
  'use strict';
  const DF = window.DF;
  const $ = s => DF.$(s);
  const PINK = '#ec4899', EMPTY = { type: 'FeatureCollection', features: [] };
  let on = false, path = null, shape = null, ids = [];

  const segDist = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
  function simplify(pts, tol) {                                          // Douglas-Peucker on screen pixels
    if (pts.length < 3) return pts.slice();
    let dmax = 0, idx = 0; const a = pts[0], b = pts[pts.length - 1];
    for (let i = 1; i < pts.length - 1; i++) { const d = segDist(pts[i], a, b); if (d > dmax) { dmax = d; idx = i; } }
    return dmax > tol ? simplify(pts.slice(0, idx + 1), tol).slice(0, -1).concat(simplify(pts.slice(idx), tol)) : [a, b];
  }
  function layer() {
    const m = DF.map.instance; if (!m || m.getSource('turf-draw')) return;
    try { m.addSource('turf-draw', { type: 'geojson', data: EMPTY });
      m.addLayer({ id: 'turf-draw', type: 'line', source: 'turf-draw', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': PINK, 'line-width': 4, 'line-opacity': 0.95 } });
    } catch (e) { /* style still loading: map:layers adds it */ }
  }
  const draw = ll => { const s = DF.map.instance && DF.map.instance.getSource('turf-draw'); if (s) s.setData(ll.length > 1 ? { type: 'Feature', geometry: { type: 'LineString', coordinates: ll }, properties: {} } : EMPTY); };

  function start() {
    if (on) return stop();
    on = true; DF.showTab('map'); DF.bus.emit('map:blank'); DF.map.instance.dragPan.disable();
    $('#pill-lasso').classList.add('turf-draw'); $('#turf-badge').hidden = false;
  }
  function stop() { on = false; path = null; if (DF.map.instance) DF.map.instance.dragPan.enable(); $('#pill-lasso').classList.remove('turf-draw'); $('#turf-badge').hidden = true; draw([]); }

  function bind() {
    const el = DF.map.instance.getCanvasContainer(), m = DF.map.instance;
    const pt = e => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    el.addEventListener('pointerdown', e => { if (!on) return; e.preventDefault(); const p = pt(e); path = [p]; draw([m.unproject(p).toArray()]); });
    el.addEventListener('pointermove', e => {
      if (!on || !path) return;
      const p = pt(e), last = path[path.length - 1]; if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 5) return;
      path.push(p); draw(path.map(q => m.unproject(q).toArray()));
    });
    const end = () => {
      if (!on || !path) return;
      const px = simplify(path, 3); path = null;
      if (px.length < 3) { draw([]); return; }                        // a tap, not a lasso: keep drawing mode on
      DF.tools.armSkip(); stop(); open(px.map(q => m.unproject(q).toArray()));
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }

  // ---- Assign Turf sheet ----
  const inCamp = (id, c) => c === '*' || (DF.sync.get(id) || {}).campaign === c;
  function count() { const c = $('#ts-camp').value, n = ids.filter(id => inCamp(id, c)).length; $('#ts-count').textContent = n + ' door' + (n === 1 ? '' : 's'); return n; }
  function open(poly) {
    shape = poly; DF.map.drawLasso(poly); ids = DF.tools.pointsIn(poly); DF.map.select(ids);
    $('#ts-rep').innerHTML = '<option value="">Unassigned</option>' + DF.roster.all().filter(r => r.role !== 'Owner').map(r => '<option value="' + DF.esc(r.id) + '">' + DF.esc(r.name) + '</option>').join('');
    $('#ts-camp').innerHTML = (DF.isManager() ? '<option value="*">All campaigns</option>' : '') + DF.myCampaigns().map(c => '<option>' + DF.esc(c) + '</option>').join('');
    $('#ts-camp').value = DF.campaign === '*' && DF.isManager() ? '*' : (DF.campaign === '*' ? DF.myCampaigns()[0] : DF.campaign);
    $('#ts-name').value = ''; count(); DF.openModal('turf-sheet');
    return ids;
  }
  async function save() {
    if (!DF.isManager() || !shape) return null;
    const rep = $('#ts-rep').value, camp = $('#ts-camp').value, targets = ids.filter(id => inCamp(id, camp));
    const name = $('#ts-name').value.trim() || 'Turf ' + new Date().toLocaleDateString([], { month: 'short', day: 'numeric' }) + (rep ? ' · ' + DF.roster.name(rep) : '');
    targets.forEach(id => { DF.sync.mutate(id, { assigned_rep_email: rep }, 'assign', { source: 'turf' }); DF.map.setRing(id); });
    const z = await DF.turf.save(name, rep, shape, camp === '*' ? '' : camp);
    clear(); DF.toast('Turf saved: ' + targets.length + ' doors → ' + DF.roster.name(rep));
    return z;
  }
  function clear() { DF.closeModal('turf-sheet'); DF.map.drawLasso([]); DF.map.select([]); shape = null; ids = []; }
  function more() { const s = shape, list = ids.slice(); DF.closeModal('turf-sheet'); DF.lasso.open(list, 'Lasso', s); }

  function init() {                                                      // called by MapTools once the map exists
    $('#pill-lasso').addEventListener('click', start);
    $('#ts-camp').addEventListener('change', count);
    $('#ts-save').addEventListener('click', save); $('#ts-clear').addEventListener('click', clear); $('#ts-close').addEventListener('click', clear); $('#ts-more').addEventListener('click', more);
    DF.bus.on('map:layers', layer); layer(); bind();
  }

  DF.turflasso = { init, start, stop, open, save, clear, count, simplify, active: () => on, ids: () => ids.slice() };
})();
