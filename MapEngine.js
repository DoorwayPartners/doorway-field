// Doorway Field v1.0 — MapEngine: MapLibre GL JS, $0 tiles (Esri/USGS imagery + OpenFreeMap vectors), white-ringed clusters,
// SVG teardrop status pins, left pills (Search, Lasso, Multi-Select), right pills (Layers, Drop Pin, Compass, Follow Me).
// Foreground GPS only: Follow Me stops when the page is hidden. No background location, no Verify Knock.
(function () {
  'use strict';
  const DF = window.DF;
  let map = null, mode = 'hybrid', lasso = null, lassoCb = null, multi = false, dropArmed = false, watchId = null, lastPos = null;
  const selected = new Set();
  // Cluster bubbles are drawn on a canvas (no font download), so they still render offline with no cached glyphs.
  const CLUSTER_LABEL = ['case', ['>=', ['get', 'point_count'], 75], '75+', ['to-string', ['get', 'point_count']]];
  const CLUSTER_ICON = ['concat', 'cl-', ['case', ['==', ['get', 'nnew'], ['get', 'point_count']], 'n', 'm'], '-', CLUSTER_LABEL];
  const CLUSTER_RING = { color: '#ffffff', width: 3 };
  const clusterRadius = n => n >= 75 ? 31 : n >= 15 ? 24 : n >= 5 ? 19 : 15;          // buckets 2 | 5 | 15 | 75+

  // ---- styles ----
  function imagery() {
    const t = DF.cfg.TILES, usgs = DF.cfg.IMAGERY === 'usgs';
    return { type: 'raster', tiles: [usgs ? t.usgs : t.esri], tileSize: 256, maxzoom: usgs ? 16 : 19, attribution: usgs ? t.usgsAttr : t.esriAttr };
  }
  function buildStyle(m) {
    const t = DF.cfg.TILES;
    if (m === 'street') return t.streetStyle;
    const s = { version: 8, glyphs: t.glyphs, sources: { imagery: imagery() }, layers: [{ id: 'imagery', type: 'raster', source: 'imagery' }] };
    if (m !== 'hybrid') return s;
    const halo = { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.8)', 'text-halo-width': 1.4 };
    s.sources.omt = { type: 'vector', url: t.vector, attribution: t.vectorAttr };
    s.layers.push(
      { id: 'hy-roads', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 10,
        paint: { 'line-color': 'rgba(255,255,255,0.5)', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.4, 16, 1.6, 19, 4] } },
      { id: 'hy-road-names', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 13,
        layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': [t.font], 'text-size': 12 }, paint: halo },
      { id: 'hy-places', type: 'symbol', source: 'omt', 'source-layer': 'place',
        layout: { 'text-field': ['get', 'name'], 'text-font': [t.font], 'text-size': ['interpolate', ['linear'], ['zoom'], 8, 11, 14, 15] }, paint: halo },
      { id: 'hy-housenumbers', type: 'symbol', source: 'omt', 'source-layer': 'housenumber', minzoom: 17,
        layout: { 'text-field': ['get', 'housenumber'], 'text-font': [t.font], 'text-size': 10 }, paint: halo });
    return s;
  }

  // ---- SVG teardrop icons: colour + white inner disc + icon glyph (colour-blind safe) ----
  function pinSvg(s) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="104" viewBox="0 0 40 52">' +
      '<path d="M20 50C20 50 4 31.5 4 19.5a16 16 0 1 1 32 0C36 31.5 20 50 20 50z" fill="' + s.color + '" stroke="#fff" stroke-width="2.6"/>' +
      '<circle cx="20" cy="19.5" r="9.6" fill="#fff"/>' +
      '<text x="20" y="24" font-family="Arial,Helvetica,sans-serif" font-size="12.5" font-weight="700" text-anchor="middle" fill="' + s.color + '">' +
      DF.esc(s.icon) + '</text></svg>';
  }
  let iconCache = null;
  function rasterIcons() {
    if (iconCache) return iconCache;
    iconCache = Promise.all(DF.sync.STATUS.map(s => new Promise(res => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = 80; c.height = 104;
        const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, 80, 104);
        res({ code: s.code, data: ctx.getImageData(0, 0, 80, 104) });
      };
      img.onerror = () => res(null);
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(pinSvg(s));
    }))).then(a => a.filter(Boolean));
    return iconCache;
  }
  function clusterIcon(id) {                // 'cl-m-15' -> mixed (green) bubble, 'cl-n-75+' -> all-new (blue) bubble
    const [, kind, label] = id.split('-'), r = clusterRadius(parseInt(label, 10)), d = (r + CLUSTER_RING.width + 1) * 2, c = document.createElement('canvas');
    c.width = c.height = d * 2;
    const x = c.getContext('2d'); x.scale(2, 2);
    x.beginPath(); x.arc(d / 2, d / 2, r, 0, Math.PI * 2);
    x.fillStyle = kind === 'n' ? DF.sync.BY_CODE.NEW.color : '#27ae60'; x.fill();
    x.lineWidth = CLUSTER_RING.width; x.strokeStyle = CLUSTER_RING.color; x.stroke();
    x.fillStyle = '#ffffff'; x.font = '700 ' + (label.length > 2 ? 12 : 14) + 'px Arial, Helvetica, sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(label, d / 2, d / 2 + 1);
    if (!map.hasImage(id)) map.addImage(id, x.getImageData(0, 0, d * 2, d * 2), { pixelRatio: 2 });
  }
  async function addIcons() {
    (await rasterIcons()).forEach(i => { if (map && !map.hasImage('pin-' + i.code)) map.addImage('pin-' + i.code, i.data, { pixelRatio: 2 }); });
  }

  // ---- data + layers ----
  function fc() {
    return { type: 'FeatureCollection', features: DF.sync.all().map(r => ({ type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] }, properties: { lead_id: r.lead_id, status_code: r.status_code } })) };
  }
  async function addLayers() {
    await addIcons();
    if (!map.getSource('leads')) {
      map.addSource('leads', { type: 'geojson', data: fc(), cluster: true, clusterRadius: 48, clusterMaxZoom: 16, promoteId: 'lead_id',
        clusterProperties: { nnew: ['+', ['case', ['==', ['get', 'status_code'], 'NEW'], 1, 0]] } });
      map.addLayer({ id: 'clusters', type: 'symbol', source: 'leads', filter: ['has', 'point_count'],
        layout: { 'icon-image': CLUSTER_ICON, 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
      map.addLayer({ id: 'pin-sel', type: 'circle', source: 'leads', filter: ['!', ['has', 'point_count']], paint: {
        'circle-radius': 17, 'circle-opacity': 0, 'circle-translate': [0, -24], 'circle-stroke-color': '#ffffff',
        'circle-stroke-width': ['case', ['boolean', ['feature-state', 'sel'], false], 4, 0] } });
      map.addLayer({ id: 'pins', type: 'symbol', source: 'leads', filter: ['!', ['has', 'point_count']], layout: {
        'icon-image': ['concat', 'pin-', ['get', 'status_code']], 'icon-anchor': 'bottom', 'icon-allow-overlap': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.7, 18, 1] } });
      map.addSource('lasso', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'lasso-fill', type: 'fill', source: 'lasso', paint: { 'fill-color': '#e31b23', 'fill-opacity': 0.15 } });
      map.addLayer({ id: 'lasso-line', type: 'line', source: 'lasso', paint: { 'line-color': '#e31b23', 'line-width': 2.5, 'line-dasharray': [2, 1] } });
      map.addSource('me', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'me', type: 'circle', source: 'me', paint: { 'circle-radius': 8, 'circle-color': '#2f80ed', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
    }
    selected.forEach(id => map.setFeatureState({ source: 'leads', id }, { sel: true }));
    drawLasso(); drawMe();
    DF.map.ready = true;
    DF.bus.emit('map:ready', mode);
  }
  function refresh() { const s = map && map.getSource('leads'); if (s) s.setData(fc()); }
  // < 30 ms flip: send only the one changed property to the worker (diff), never a full re-render.
  function setStatus(id, code) {
    const s = map && map.getSource('leads'); if (!s) return;
    try { s.updateData({ update: [{ id, addOrUpdateProperties: [{ key: 'status_code', value: code }] }] }); } catch (e) { s.setData(fc()); }
  }

  // ---- selection (feature-state) ----
  function select(ids) {
    selected.forEach(id => map && map.getSource('leads') && map.setFeatureState({ source: 'leads', id }, { sel: false }));
    selected.clear();
    (ids || []).forEach(id => { selected.add(id); if (map && map.getSource('leads')) map.setFeatureState({ source: 'leads', id }, { sel: true }); });
    DF.$('#sel-count').textContent = selected.size + ' selected';
    DF.$('#sel-bar').classList.toggle('open', selected.size > 0 && (multi || ids.length > 1));
  }
  function toggleSel(id) { const ids = new Set(selected); ids.has(id) ? ids.delete(id) : ids.add(id); select(Array.from(ids)); }
  function jumpTo(id) {
    const r = DF.sync.get(id); if (!r || !map) return;
    DF.showTab('map');
    map.flyTo({ center: [r.lng, r.lat], zoom: Math.max(map.getZoom(), 18), duration: 600 });
    select([id]); DF.bus.emit('pin:selected', id);
  }

  // ---- lasso / area select (tap the corners, then Done) ----
  function pip(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  const pointsIn = poly => DF.sync.all().filter(r => pip([r.lng, r.lat], poly)).map(r => r.lead_id);
  function drawLasso() {
    const s = map && map.getSource('lasso'); if (!s) return;
    const p = lasso || [], f = [];
    if (p.length >= 3) f.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [p.concat([p[0]])] }, properties: {} });
    else if (p.length) f.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: p.length > 1 ? p : [p[0], p[0]] }, properties: {} });
    s.setData({ type: 'FeatureCollection', features: f });
    DF.$('#lasso-count').textContent = p.length + ' corner' + (p.length === 1 ? '' : 's') + ' · ' + (p.length >= 3 ? pointsIn(p).length + ' doors' : 'tap 3+');
  }
  function startLasso(cb) { lasso = []; lassoCb = cb || null; DF.showTab('map'); DF.bus.emit('map:blank'); DF.$('#lasso-bar').classList.add('open'); DF.$('#pill-lasso').classList.add('active'); drawLasso(); }
  function endLasso() { lasso = null; lassoCb = null; DF.$('#lasso-bar').classList.remove('open'); DF.$('#pill-lasso').classList.remove('active'); drawLasso(); }
  function finishLasso(poly) {
    poly = poly || (lasso || []).slice(); const cb = lassoCb; endLasso();
    if (poly.length < 3) return [];
    const ids = pointsIn(poly);
    if (cb) cb(poly, ids); else { select(ids); DF.bus.emit('selection:changed', ids); }
    return ids;
  }

  // ---- Follow Me (foreground only) ----
  function drawMe() { const s = map && map.getSource('me'); if (s) s.setData({ type: 'FeatureCollection', features: lastPos ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: lastPos }, properties: {} }] : [] }); }
  function follow(on) {
    if (on === undefined) on = watchId === null;
    if (on && navigator.geolocation && watchId === null) {
      watchId = navigator.geolocation.watchPosition(p => {
        lastPos = [p.coords.longitude, p.coords.latitude]; drawMe();
        if (map) map.easeTo({ center: lastPos, zoom: Math.max(map.getZoom(), 17), duration: 500 });
      }, () => { DF.toast('Location unavailable'); follow(false); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
    } else if (!on && watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    DF.map.following = watchId !== null;
    DF.$('#pill-gps').classList.toggle('active', DF.map.following);
  }
  function locateOnce() {
    return new Promise(res => {
      if (!navigator.geolocation) return res(position());
      navigator.geolocation.getCurrentPosition(p => { lastPos = [p.coords.longitude, p.coords.latitude]; drawMe(); res(lastPos); },
        () => res(position()), { enableHighAccuracy: true, maximumAge: 30000, timeout: 8000 });
    });
  }
  function position() { if (lastPos) return lastPos; const c = map ? map.getCenter() : { lng: 0, lat: 0 }; return [c.lng, c.lat]; }

  // ---- map modes (Map Settings drawer) ----
  function setMode(m) {
    if (!['street', 'hybrid', 'satellite'].includes(m)) return;
    mode = DF.map.mode = m; DF.store.set('mapMode', m); DF.map.ready = false;
    DF.$$('.mode-card').forEach(c => c.classList.toggle('active', c.dataset.mode === m));
    if (map) map.setStyle(buildStyle(m), { diff: false });   // full swap so style.load re-adds pins
  }

  // ---- search ----
  function search(q) {
    q = q.trim().toLowerCase();
    const out = DF.$('#search-results'); out.innerHTML = '';
    if (q.length < 2) return [];
    const hits = DF.sync.all().filter(r => (r.address + ' ' + r.apt + ' ' + r.first_name + ' ' + r.last_name + ' ' + r.zip).toLowerCase().includes(q)).slice(0, 6);
    hits.forEach(r => {
      const li = document.createElement('li');
      li.innerHTML = '<b>' + DF.esc(r.address + (r.apt ? ' ' + r.apt : '')) + '</b><span>' + DF.esc([r.first_name, r.last_name].join(' ').trim() || r.city) + '</span>';
      li.addEventListener('click', () => { DF.$('#search-bar').classList.remove('open'); jumpTo(r.lead_id); });
      out.appendChild(li);
    });
    return hits;
  }

  function bindPills() {
    const on = (sel, fn) => DF.$(sel).addEventListener('click', fn);
    on('#pill-search', () => { DF.$('#search-bar').classList.toggle('open'); DF.$('#search-input').focus(); });
    DF.$('#search-input').addEventListener('input', e => search(e.target.value));
    on('#pill-lasso', () => lasso ? endLasso() : startLasso());
    on('#lasso-done', () => finishLasso());
    on('#lasso-cancel', endLasso);
    on('#pill-multi', () => { multi = !multi; DF.$('#pill-multi').classList.toggle('active', multi); if (multi) DF.bus.emit('map:blank'); else select([]); });
    on('#sel-clear', () => { multi = false; DF.$('#pill-multi').classList.remove('active'); select([]); });
    on('#sel-status', () => DF.bus.emit('bulk:open', Array.from(selected)));
    on('#pill-layers', () => DF.openModal('layers-drawer'));
    DF.$$('.mode-card').forEach(c => c.addEventListener('click', () => { setMode(c.dataset.mode); DF.closeModal('layers-drawer'); }));
    on('#pill-drop', () => { dropArmed = !dropArmed; DF.$('#pill-drop').classList.toggle('active', dropArmed); if (dropArmed) DF.toast('Tap the map to drop a pin'); });
    on('#pill-compass', () => map && map.resetNorthPitch());
    on('#pill-gps', () => follow());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') follow(false); });
  }
  async function dropAt(ll) {
    dropArmed = false; DF.$('#pill-drop').classList.remove('active');
    const row = { address: 'Dropped pin ' + ll.lat.toFixed(5) + ', ' + ll.lng.toFixed(5), lat: ll.lat, lng: ll.lng, status_code: 'NEW', assigned_rep_email: DF.auth.email };
    await DF.sync.importRows([row]);
    jumpTo(DF.sync.leadId(row.address, '', ''));
  }

  function init(container) {
    mode = DF.map.mode = DF.store.get('mapMode', DF.cfg.DEFAULT_MODE);
    const rows = DF.sync.all(), b = new maplibregl.LngLatBounds();
    rows.forEach(r => b.extend([r.lng, r.lat]));
    map = new maplibregl.Map({ container, style: buildStyle(mode), attributionControl: false, dragRotate: true, touchPitch: false,
      center: rows.length ? b.getCenter() : [-98.5, 39.8], zoom: rows.length ? 13 : 3, maxZoom: 20 });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    map.on('style.load', addLayers);
    map.on('styleimagemissing', e => { if (/^cl-/.test(e.id)) clusterIcon(e.id); else if (/^pin-/.test(e.id)) addIcons(); });
    map.once('load', () => {
      if (rows.length > 1) map.fitBounds(b, { padding: 60, maxZoom: 16, duration: 0 });
      DF.$$('.maplibregl-ctrl-attrib').forEach(el => el.classList.add('maplibregl-compact-show', 'df-attrib'));   // owner: credits badge always shown
    });
    map.on('click', 'clusters', e => {
      if (lasso || dropArmed) return;
      const f = e.features[0];
      map.getSource('leads').getClusterExpansionZoom(f.properties.cluster_id).then(z => map.easeTo({ center: f.geometry.coordinates, zoom: z + 0.2 }));
    });
    map.on('click', 'pins', e => {
      if (lasso || dropArmed) return;
      const id = e.features[0].properties.lead_id;
      if (multi) toggleSel(id); else { select([id]); DF.bus.emit('pin:selected', id); }
    });
    map.on('click', e => {
      if (dropArmed) return dropAt(e.lngLat);
      if (lasso) { lasso.push([e.lngLat.lng, e.lngLat.lat]); return drawLasso(); }
      if (!map.queryRenderedFeatures(e.point, { layers: ['pins', 'clusters'] }).length && !multi) { select([]); DF.bus.emit('map:blank'); }
    });
    DF.bus.on('pins:changed', refresh);
    DF.bus.on('tab:changed', t => { if (t === 'map' && map) setTimeout(() => map.resize(), 0); });
    DF.$$('.mode-card').forEach(c => c.classList.toggle('active', c.dataset.mode === mode));
    bindPills();
    DF.map.instance = map;
  }

  DF.map = { init, setMode, setStatus, refresh, select, jumpTo, startLasso, finishLasso, cancelLasso: endLasso, pointsIn, pip, follow,
    locateOnce, position, buildStyle, search, CLUSTER_LABEL, CLUSTER_ICON, CLUSTER_RING, clusterRadius, mode, following: false, ready: false,
    selected: () => Array.from(selected), instance: null };
})();
