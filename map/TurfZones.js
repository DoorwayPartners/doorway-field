// Doorway Field v2.2 — TurfZones: Lasso › "Save as Turf Zone" (name + rep colour). Saved boundaries stay outlined on the map under the pins,
// persist in IndexedDB (meta 'turfs') and go to the private Sync endpoint as turf events. Filters › Turf Zones toggles them. Agents see only their zones.
(function () {
  'use strict';
  const DF = window.DF;
  const $ = s => DF.$(s);
  let shape = null;                                                   // polygon of the open lasso sheet ([lng, lat] corners)

  const all = () => DF.sync.meta('turfs') || [];
  const shown = () => DF.store.get('showTurf', true);
  const mine = z => DF.isManager() || z.rep === DF.auth.id;
  const inCamp = z => DF.campaign === '*' || !z.campaign || z.campaign === DF.campaign;
  const visible = () => shown() ? all().filter(z => mine(z) && inCamp(z)) : [];
  function fc() {
    return { type: 'FeatureCollection', features: visible().map(z => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [z.poly.concat([z.poly[0]])] },
      properties: { id: z.id, name: z.name, color: z.color } })) };
  }
  function draw() { const m = DF.map.instance, s = m && m.getSource('turfs'); if (s) s.setData(fc()); }
  function layers() {                                                 // re-added after every basemap swap, always beneath clusters + pins
    const m = DF.map.instance; if (!m) return;
    if (m.getSource('turfs')) return draw();
    m.addSource('turfs', { type: 'geojson', data: fc() });
    const before = m.getLayer('clusters') ? 'clusters' : undefined;
    m.addLayer({ id: 'turf-fill', type: 'fill', source: 'turfs', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.08 } }, before);
    m.addLayer({ id: 'turf-line', type: 'line', source: 'turfs', paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-dasharray': [2, 1.2] } }, before);
    m.addLayer({ id: 'turf-label', type: 'symbol', source: 'turfs', minzoom: 13, layout: { 'text-field': ['get', 'name'], 'text-font': [DF.cfg.TILES.font], 'text-size': 13 },
      paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.85)', 'text-halo-width': 1.5 } }, before);
  }
  async function save(name, rep, poly, campaign) {
    name = String(name || '').trim().slice(0, 40); poly = poly || shape;
    if (!DF.isManager()) return null;
    if (!name || !poly || poly.length < 3) { DF.toast('Name the zone first'); return null; }
    const r = DF.roster.get(rep), z = { id: 'TZ-' + DF.hash(name + '|' + Date.now()), name, rep: r ? r.id : '', color: r ? r.color : '#e31b23',
      campaign: campaign !== undefined ? campaign : DF.campaign === '*' ? '' : DF.campaign, poly: poly.map(p => [+Number(p[0]).toFixed(6), +Number(p[1]).toFixed(6)]), by: DF.auth.id, at: new Date().toISOString() };
    await DF.sync.setMeta('turfs', all().concat([z]));
    DF.sync.append({ type: 'turf', turf: z });
    draw(); renderFilter(); DF.toast('Turf zone saved: ' + name);
    return z;
  }
  async function remove(id) {
    if (!DF.isManager()) return;
    await DF.sync.setMeta('turfs', all().filter(z => z.id !== id));
    DF.sync.append({ type: 'turf_delete', turf_id: id });
    draw(); renderFilter();
  }
  function setShown(v) { DF.store.set('showTurf', !!v); draw(); renderFilter(); }
  function renderFilter() {
    const el = $('#turf-filter'); if (!el) return;
    const z = all().filter(mine);
    el.innerHTML = '<h4>Turf Zones</h4><label class="chk"><input type="checkbox" id="turf-show"' + (shown() ? ' checked' : '') + '> Show turf zone outlines</label>' +
      (z.length ? '<ul class="turf-list">' + z.map(x => '<li><i class="dot rc-' + DF.esc(x.rep) + '"></i><b>' + DF.esc(x.name) + '</b> <span class="muted">' + DF.esc(DF.roster.name(x.rep)) +
        (x.campaign ? ' · ' + DF.esc(x.campaign) : '') + '</span>' + (DF.isManager() ? ' <button type="button" class="btn t-del" data-id="' + DF.esc(x.id) + '">Delete</button>' : '') + '</li>').join('') + '</ul>'
        : '<p class="muted">No zones yet. Lasso an area, then Save as Turf Zone.</p>');
    $('#turf-show').addEventListener('change', e => setShown(e.target.checked));
    DF.$$('#turf-filter .t-del').forEach(b => b.addEventListener('click', () => remove(b.dataset.id)));
  }
  function onLasso(poly) {                                            // lasso sheet opened: show the save row only when there is a drawn shape
    shape = poly && poly.length >= 3 ? poly : null;
    const row = $('#ls-turf'); if (!row) return;
    row.hidden = !shape || !DF.isManager();
    $('#ls-turf-name').value = '';
    $('#ls-turf-rep').innerHTML = '<option value="">Unassigned</option>' + DF.roster.all().map(r => '<option value="' + DF.esc(r.id) + '">' + DF.esc(r.name) + '</option>').join('');
  }
  function init() {
    $('#ls-turf-save').addEventListener('click', () => save($('#ls-turf-name').value, $('#ls-turf-rep').value).then(z => { if (z) $('#ls-turf').hidden = true; }));
    DF.bus.on('lasso:open', onLasso);
    DF.bus.on('map:layers', layers);
    ['campaign:changed', 'auth:changed', 'roster:changed'].forEach(ev => DF.bus.on(ev, () => { draw(); renderFilter(); }));
    renderFilter();
  }

  DF.turf = { init, all, visible, fc, save, remove, setShown, shown, renderFilter };
})();
