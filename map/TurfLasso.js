// Doorway Field v2.5.1 — TurfLasso: SalesRabbit-style "Sharpie" lasso. The Turf Draw toggle (⬠) turns pink, shows "👆 Draw turf with your finger" and
// pauses panning; the finger (or mouse) path draws a bold black marker line (5 px #09090b on a white halo), sampled every 10 px. On lift the path is
// smoothed (Douglas-Peucker 3 px) and untwisted (overshoot tails cut at the first self-crossing: no bowties), the doors inside counted (same filters as
// the map) and the Lasso Summary sheet opens: Total · Prospects (New / NH / GB / P GB / APPT) · Customers · Other / NI → Assign Leads (rep or Unassign) / Clear.
// Assign or Clear removes the outline at once: nothing permanent is drawn; assigned pins show the rep colour in their outer ring.
(function () {
  'use strict';
  const DF = window.DF;
  const $ = s => DF.$(s);
  const INK = '#09090b', HALO = '#ffffff', STEP = 10, EMPTY = { type: 'FeatureCollection', features: [] };
  let on = false, path = null, shape = null, ids = [];

  const segDist = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
  function simplify(pts, tol) {                                          // Douglas-Peucker on screen pixels
    if (pts.length < 3) return pts.slice();
    let dmax = 0, idx = 0; const a = pts[0], b = pts[pts.length - 1];
    for (let i = 1; i < pts.length - 1; i++) { const d = segDist(pts[i], a, b); if (d > dmax) { dmax = d; idx = i; } }
    return dmax > tol ? simplify(pts.slice(0, idx + 1), tol).slice(0, -1).concat(simplify(pts.slice(idx), tol)) : [a, b];
  }
  const cross = (a, b, c, d) => { const r = [b[0] - a[0], b[1] - a[1]], q = [d[0] - c[0], d[1] - c[1]], den = r[0] * q[1] - r[1] * q[0]; if (!den) return null;
    const t = ((c[0] - a[0]) * q[1] - (c[1] - a[1]) * q[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
    return t > 0 && t < 1 && u > 0 && u < 1 ? [a[0] + t * r[0], a[1] + t * r[1]] : null; };
  function untwist(pts) {                                                // finger overshot the start: keep the loop between the first crossing pair
    for (let j = pts.length - 2; j > 1; j--) for (let i = 0; i < j - 1; i++) { const x = cross(pts[i], pts[i + 1], pts[j], pts[j + 1]); if (x) return [x].concat(pts.slice(i + 1, j + 1)); }
    return pts;
  }
  function layer() {
    const m = DF.map.instance; if (!m || m.getSource('turf-draw')) return;
    try { m.addSource('turf-draw', { type: 'geojson', data: EMPTY });
      const lay = { 'line-cap': 'round', 'line-join': 'round' };
      m.addLayer({ id: 'turf-draw-halo', type: 'line', source: 'turf-draw', layout: lay, paint: { 'line-color': HALO, 'line-width': 9 } });   // 2 px white halo each side
      m.addLayer({ id: 'turf-draw', type: 'line', source: 'turf-draw', layout: lay, paint: { 'line-color': INK, 'line-width': 5 } });
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
      const p = pt(e), last = path[path.length - 1]; if (Math.hypot(p[0] - last[0], p[1] - last[1]) < STEP) return;
      path.push(p); draw(path.map(q => m.unproject(q).toArray()));
    });
    const end = () => {
      if (!on || !path) return;
      const px = untwist(simplify(path, 3)); path = null;
      if (px.length < 3) { draw([]); return; }                        // a tap, not a lasso: keep drawing mode on
      DF.tools.armSkip(); stop(); open(px.map(q => m.unproject(q).toArray()));
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }

  // ---- Lasso Summary & Assignment sheet ----
  const PROS = [['NEW', 'New'], ['NH', 'NH'], ['GB', 'GB'], ['P_GB', 'P GB'], ['APPT', 'APPT']], CUST = ['SOLD', 'CST'];
  function summary(list) {
    const o = { total: list.length, prospects: 0, customers: 0, other: 0, by: { NEW: 0, NH: 0, GB: 0, P_GB: 0, APPT: 0 } };
    list.forEach(id => { const c = (DF.sync.get(id) || {}).status_code || 'NEW', k = /^NH\d$/.test(c) ? 'NH' : c;
      if (k in o.by) { o.by[k]++; o.prospects++; } else if (CUST.includes(c)) o.customers++; else o.other++; });
    return o;
  }
  function render() {
    const o = summary(ids);
    $('#ts-total').textContent = o.total; $('#ts-pros').textContent = o.prospects; $('#ts-cust').textContent = o.customers; $('#ts-other').textContent = o.other;
    $('#ts-pros-by').textContent = PROS.map(([k, l]) => l + ' ' + o.by[k]).join(' · ');
    return o;
  }
  const outline = poly => draw(poly && poly.length > 2 ? poly.concat([poly[0]]) : []);   // temporary black outline: gone on Assign / Clear
  function open(poly) {
    shape = poly; outline(poly); ids = DF.tools.pointsIn(poly); DF.map.select(ids);
    $('#ts-rep').innerHTML = DF.roster.all().filter(r => r.role !== 'Owner').map(r => '<option value="' + DF.esc(r.id) + '">' + DF.esc(r.name) + '</option>').join('') + '<option value="">Unassign</option>';
    render(); DF.openModal('turf-sheet');
    return ids;
  }
  function assign() {
    if (!DF.isManager() || !shape) return 0;
    const rep = $('#ts-rep').value, n = ids.length;
    ids.forEach(id => { const r = DF.sync.get(id); if (r && (r.assigned_rep_email || '') !== rep) DF.sync.mutate(id, { assigned_rep_email: rep }, 'assign', { source: 'lasso' }); DF.map.setRing(id); });
    clear(); DF.map.refresh(); DF.sync.flush();
    DF.toast(n + ' lead' + (n === 1 ? '' : 's') + (rep ? ' → ' + DF.roster.name(rep) : ' unassigned'));
    return n;
  }
  function clear() { DF.closeModal('turf-sheet'); outline([]); DF.map.drawLasso([]); DF.map.select([]); shape = null; ids = []; }
  function more() { const s = shape, list = ids.slice(); DF.closeModal('turf-sheet'); outline([]); DF.lasso.open(list, 'Lasso', s); }

  function init() {                                                      // called by MapTools once the map exists
    $('#pill-lasso').addEventListener('click', start);
    $('#ts-assign').addEventListener('click', assign); $('#ts-clear').addEventListener('click', clear); $('#ts-close').addEventListener('click', clear); $('#ts-more').addEventListener('click', more);
    DF.bus.on('map:layers', layer); layer(); bind();
  }

  DF.turflasso = { init, start, stop, open, assign, clear, summary, simplify, untwist, active: () => on, ids: () => ids.slice() };
})();
