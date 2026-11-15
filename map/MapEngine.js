// Doorway Field v2.1 — MapEngine: MapLibre GL JS, $0 tiles (Esri/USGS imagery + OpenFreeMap vectors), exact-count 34 px cluster badges, stacked-disc multi-unit edges,
// dual-ring circular pins (inner disc + icon = disposition; outer ring = rep colour on Owner/Manager view, white for Agents / Unassigned),
// Existing Customer = white centre + coloured ring, selection via feature-state, temporary lasso + numbered route layers.
(function () {
  'use strict';
  const DF = window.DF;
  let map = null, mode = 'hybrid';
  const selected = new Set();
  const CLUSTER_LABEL = ['case', ['>=', ['get', 'point_count'], 1000], '1k+', ['to-string', ['get', 'point_count']]];   // exact count up to 999
  const CLUSTER_ICON = ['concat', 'cl-', ['case', ['==', ['get', 'nnew'], ['get', 'point_count']], 'n', 'm'], '-', CLUSTER_LABEL];
  const CLUSTER_RING = { color: '#ffffff', width: 2.5 }, CLUSTER_SIZE = 34, MIXED = '#2c3e50';
  const clusterRadius = () => CLUSTER_SIZE / 2;          // one 34 px badge for every count: roads stay visible when zoomed out
  const PIN_SIZE = 1;   // v2.3: one crisp 32 px pin at every zoom (images are drawn at that size)
  const CLUSTER = { maxZoom: 11, radius: 24 };   // individual pins from zoom 12 (MapLibre switches cluster tiles at whole zooms; closest to the 12.5 spec), tight 24 px clustering below
  const WHITE = '#ffffff';
  const EMPTY = { type: 'FeatureCollection', features: [] };

  // ---- styles ----
  function imagery() {
    const t = DF.cfg.TILES, usgs = DF.cfg.IMAGERY === 'usgs';
    // No @2x endpoint on Esri / USGS: on retina screens use 128 px tiles, so one zoom level deeper is fetched and drawn at 2x density
    return { type: 'raster', tiles: [usgs ? t.usgs : t.esri], tileSize: (window.devicePixelRatio || 1) >= 2 ? 128 : 256, maxzoom: usgs ? 16 : 19, attribution: usgs ? t.usgsAttr : t.esriAttr };
  }
  // Basemap chain (v2.4.4): DF.map.base = 'esri' (default) | 'google' | 'osm' (OpenFreeMap street vectors, OSM data). On tile failure → next.
  const NEXT = { google: 'esri', esri: 'osm', osm: 'esri' }, NAMES = { google: 'Google', esri: 'Esri imagery', osm: 'OpenStreetMap street map' };
  const APP_SRC = { leads: 1, lasso: 1, route: 1, me: 1, 'turf-draw': 1 };
  const base = () => DF.map.base || (DF.map.base = [DF.store.get('basemap', ''), DF.cfg.BASEMAP].find(k => ['google', 'esri', 'osm'].includes(k)) || 'esri');   // rep's pick wins
  function buildStyle(m) {
    const t = DF.cfg.TILES, b = base();
    if (b === 'google') {                                                  // Google Hybrid (labels, borders, shields) | Street | Satellite
      const lyrs = { hybrid: 'y', street: 'm', satellite: 's' }[m] || 'y';
      return { version: 8, glyphs: t.glyphs, sources: { imagery: { type: 'raster', tiles: [0, 1, 2, 3].map(i => t.google.replace('{s}', i).replace('{lyrs}', lyrs)), tileSize: 256, maxzoom: 20,
        attribution: t.googleAttr } }, layers: [{ id: 'imagery', type: 'raster', source: 'imagery' }] };
    }
    if (b === 'osm' || m === 'street') return t.streetStyle;
    const s = { version: 8, glyphs: t.glyphs, sources: { imagery: imagery() }, layers: [{ id: 'imagery', type: 'raster', source: 'imagery' }] };
    if (m !== 'hybrid') return s;
    // Esri reference overlays (raster: roads + shields, boundaries + place names; no fonts needed) + OpenFreeMap house numbers from zoom 17
    const ref = url => ({ type: 'raster', tiles: [url], tileSize: 256, maxzoom: 19, attribution: t.esriRefAttr });
    const halo = { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.8)', 'text-halo-width': 1.4 };
    s.sources['ref-roads'] = ref(t.esriRoads); s.sources['ref-places'] = ref(t.esriPlaces);
    s.sources.omt = { type: 'vector', url: t.vector, attribution: t.vectorAttr };
    s.layers.push({ id: 'ref-roads', type: 'raster', source: 'ref-roads' }, { id: 'ref-places', type: 'raster', source: 'ref-places' },
      { id: 'hy-housenumbers', type: 'symbol', source: 'omt', 'source-layer': 'housenumber', minzoom: 17, layout: { 'text-field': ['get', 'housenumber'], 'text-font': [t.font], 'text-size': 10 }, paint: halo });
    return s;
  }

  // ---- canvas icons (no font downloads: work offline) ----
  function canvas(d, draw) { const c = document.createElement('canvas'); c.width = c.height = d * 2; const x = c.getContext('2d'); x.scale(2, 2); draw(x, d / 2); return x.getImageData(0, 0, d * 2, d * 2); }
  function text(x, t, c, color, px) { x.fillStyle = color; x.font = '700 ' + px + 'px Arial, Helvetica, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(t, c, c + 0.5); }
  function clusterIcon(id) {      // 'cl-m-470' mixed (slate) | 'cl-n-14' all-new (New colour); 34 px incl. a 2.5 px white border
    const [, kind, label] = id.split('-'), r = CLUSTER_SIZE / 2 - CLUSTER_RING.width / 2;
    return canvas(CLUSTER_SIZE + 8, (x, c) => { x.save(); x.shadowColor = 'rgba(0,0,0,0.45)'; x.shadowBlur = 12; x.shadowOffsetY = 4;
      x.beginPath(); x.arc(c, c, r, 0, Math.PI * 2); x.fillStyle = kind === 'n' ? DF.sync.BY_CODE.NEW.color : MIXED; x.fill(); x.restore();
      x.lineWidth = CLUSTER_RING.width; x.strokeStyle = CLUSTER_RING.color; x.stroke(); text(x, label, c, WHITE, label.length > 3 ? 11 : label.length > 2 ? 12 : 14); });
  }
  const stopIcon = n => canvas(26, (x, c) => { x.beginPath(); x.arc(c, c, 11, 0, Math.PI * 2); x.fillStyle = '#1d1d1f'; x.fill(); x.lineWidth = 2; x.strokeStyle = WHITE; x.stroke(); text(x, String(n), c, WHITE, 11); });
  // Pin images are made on demand per status + ring colour: 'pin-NEW|#ffffff'
  function addPin(id) {
    const [code, ring] = id.slice(4).split('|'), s = DF.sync.BY_CODE[code] || DF.sync.BY_CODE.NEW;
    if (!map.hasImage(id)) map.addImage(id, DF.pins.pinImage(s, ring || WHITE), { pixelRatio: 2 });
  }
  const dropPins = () => map.listImages().filter(id => /^pin-/.test(id)).forEach(id => map.removeImage(id));

  // ---- data: only leads that pass the active campaign + filter drawer ----
  const showRings = () => DF.isManager();
  const ringOf = r => showRings() && r.assigned_rep_email && DF.roster.get(r.assigned_rep_email) ? DF.roster.color(r.assigned_rep_email) : WHITE;
  const visible = r => DF.filters ? DF.filters.match(r) : DF.inCampaign(r);
  // Multi-unit overlaps: 2-4 doors within 15 m get a stacked-disc edge in the group's dominant status colour (15 m grid, 3 x 3 lookup).
  function stacks(rows) {
    const out = {}; if (!rows.length) return out;
    const LAT = 15 / 111320, LNG = LAT / Math.max(0.2, Math.cos(rows[0].lat * Math.PI / 180)), g = {}, done = new Set();
    const cell = r => [Math.floor(r.lat / LAT), Math.floor(r.lng / LNG)], m = (a, b) => Math.hypot((a.lat - b.lat) / LAT, (a.lng - b.lng) / LNG) * 15;
    rows.forEach(r => { const k = cell(r).join(':'); (g[k] = g[k] || []).push(r); });
    rows.forEach(r => {
      if (done.has(r.lead_id)) return;
      const [a, b] = cell(r), near = [];
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) (g[(a + i) + ':' + (b + j)] || []).forEach(o => { if (!done.has(o.lead_id) && m(r, o) <= 15) near.push(o); });
      near.forEach(o => done.add(o.lead_id));
      if (near.length < 2 || near.length > 4) return;
      const n = {}; near.forEach(o => { n[o.status_code] = (n[o.status_code] || 0) + 1; });
      const dom = Object.keys(n).sort((x, y) => n[y] - n[x])[0], c = (DF.sync.BY_CODE[dom] || DF.sync.BY_CODE.NEW).color;
      near.forEach(o => { out[o.lead_id] = { n: near.length, c }; });
    });
    return out;
  }
  function fc() {
    const rows = DF.sync.all().filter(visible), st = stacks(rows);
    return { type: 'FeatureCollection', features: rows.map(r => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
      properties: Object.assign({ lead_id: r.lead_id, status_code: r.status_code, ring: ringOf(r) }, st[r.lead_id] ? { stk: st[r.lead_id].n, stkc: st[r.lead_id].c } : {}) })) };
  }
  function addLayers() {
    if (!map.getSource('leads')) {
      map.addSource('leads', { type: 'geojson', data: fc(), cluster: true, clusterRadius: CLUSTER.radius, clusterMaxZoom: CLUSTER.maxZoom, promoteId: 'lead_id',
        clusterProperties: { nnew: ['+', ['case', ['==', ['get', 'status_code'], 'NEW'], 1, 0]] } });
      const unclustered = ['!', ['has', 'point_count']], edge = n => ({ 'circle-radius': 15.5, 'circle-color': ['get', 'stkc'], 'circle-translate': [n, -n],
        'circle-stroke-color': WHITE, 'circle-stroke-width': 1.5, 'circle-opacity': 0.95 });
      map.addLayer({ id: 'clusters', type: 'symbol', source: 'leads', filter: ['has', 'point_count'], layout: { 'icon-image': CLUSTER_ICON, 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
      map.addLayer({ id: 'pin-stack2', type: 'circle', source: 'leads', filter: ['all', unclustered, ['>=', ['coalesce', ['get', 'stk'], 0], 3]], paint: edge(6) });
      map.addLayer({ id: 'pin-stack', type: 'circle', source: 'leads', filter: ['all', unclustered, ['has', 'stk']], paint: edge(3) });
      map.addLayer({ id: 'pin-sel', type: 'circle', source: 'leads', filter: unclustered, paint: { 'circle-radius': 18.5,
        'circle-color': '#1d1d1f', 'circle-opacity': ['case', ['boolean', ['feature-state', 'sel'], false], 0.85, 0] } });
      map.addLayer({ id: 'pins', type: 'symbol', source: 'leads', filter: unclustered, layout: { 'icon-image': ['concat', 'pin-', ['get', 'status_code'], '|', ['get', 'ring']],
        'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': PIN_SIZE } });
      map.addSource('lasso', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'lasso-fill', type: 'fill', source: 'lasso', paint: { 'fill-color': '#e31b23', 'fill-opacity': 0.12 } });
      map.addLayer({ id: 'lasso-line', type: 'line', source: 'lasso', paint: { 'line-color': '#e31b23', 'line-width': 2.5, 'line-dasharray': [2, 1] } });
      map.addSource('route', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'route-line', type: 'line', source: 'route', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#1d1d1f', 'line-width': 3, 'line-opacity': 0.7 } });
      map.addLayer({ id: 'route-stops', type: 'symbol', source: 'route', filter: ['==', ['geometry-type'], 'Point'], layout: { 'icon-image': ['concat', 'stop-', ['to-string', ['get', 'n']]], 'icon-allow-overlap': true, 'icon-offset': [0, -16] } });
      map.addSource('me', { type: 'geojson', data: EMPTY });                        // empty until a REAL GPS fix (no fallback position, ever)
      map.addLayer({ id: 'me-acc', type: 'fill', source: 'me', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#2f80ed', 'fill-opacity': 0.15, 'fill-outline-color': 'rgba(47,128,237,0.5)' } });
      map.addLayer({ id: 'me', type: 'circle', source: 'me', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 8, 'circle-color': '#2f80ed', 'circle-stroke-color': WHITE, 'circle-stroke-width': 3 } });
    }
    selected.forEach(id => map.setFeatureState({ source: 'leads', id }, { sel: true }));
    DF.bus.emit('map:layers');
    DF.map.ready = true;
    DF.bus.emit('map:ready', mode);
  }
  function refresh() { const s = map && map.getSource('leads'); if (s) s.setData(fc()); renderLegend(); }
  // < 30 ms flip: one-property diff to the worker, never a full re-render.
  function setProps(id, props) {
    const s = map && map.getSource('leads'); if (!s) return;
    try { s.updateData({ update: [{ id, addOrUpdateProperties: Object.keys(props).map(key => ({ key, value: props[key] })) }] }); } catch (e) { s.setData(fc()); }
  }
  const setStatus = (id, code) => setProps(id, { status_code: code });
  const setRing = id => { const r = DF.sync.get(id); if (r) setProps(id, { ring: ringOf(r) }); };

  // ---- rep-ring legend pill (Owner/Manager view) ----
  function renderLegend() {
    const el = DF.$('#ring-legend'); if (!el) return;
    const keys = {}; DF.sync.all().filter(visible).forEach(r => { const k = DF.roster.get(r.assigned_rep_email) ? DF.roster.get(r.assigned_rep_email).id : ''; keys[k] = (keys[k] || 0) + 1; });
    el.hidden = !showRings() || !Object.keys(keys).length;
    el.innerHTML = Object.keys(keys).sort().map(k => '<span class="lg"><i class="dot rc-' + DF.esc(k || 'none') + '"></i>' + DF.esc(k ? DF.firstName(k) : 'Unassigned') + ' ' + keys[k] + '</span>').join('');
    DF.ringCss();
  }
  // Rep colours as CSS classes (zero inline styles, CSP-safe): one rule per roster rep in a constructed stylesheet.
  let ringSheet = null;
  DF.ringCss = function () {
    const ok = c => /^#[0-9a-f]{3,8}$/i.test(c) ? c : '#888';     // rep ring dots + Status Pin Inventory colours for chips / Lead Menu
    const css = DF.roster.all().map(r => '.rc-' + r.id.replace(/[^a-z0-9-]/gi, '') + '{background:' + ok(r.color) + '}').join('\n') + '\n.rc-none{background:#fff;border:1px solid #bbb}\n' +
      DF.sync.STATUS.map(s => '.dispo-' + s.code + ',.chip-' + s.code + '{--c:' + ok(s.color) + '}').join('\n');
    if (!ringSheet && window.CSSStyleSheet && 'adoptedStyleSheets' in document) { ringSheet = new CSSStyleSheet(); document.adoptedStyleSheets = document.adoptedStyleSheets.concat([ringSheet]); }
    if (ringSheet) ringSheet.replaceSync(css);
  };

  // ---- selection, jump, lasso + route drawing ----
  function select(ids) {
    selected.forEach(id => map && map.getSource('leads') && map.setFeatureState({ source: 'leads', id }, { sel: false }));
    selected.clear();
    (ids || []).forEach(id => { selected.add(id); if (map && map.getSource('leads')) map.setFeatureState({ source: 'leads', id }, { sel: true }); });
    DF.bus.emit('selection:changed', Array.from(selected));
  }
  function jumpTo(id) {
    const r = DF.sync.get(id); if (!r || !map) return;
    DF.map.moved = true; DF.showTab('map');
    map.flyTo({ center: [r.lng, r.lat], zoom: Math.max(map.getZoom(), 18), duration: 600, offset: [0, -Math.round(map.getContainer().clientHeight * 0.22)] });   // pin sits above the card
    select([id]); DF.bus.emit('pin:selected', id);
  }
  function drawLasso(p) {
    const s = map && map.getSource('lasso'); if (!s) return;
    p = p || []; const f = [];
    if (p.length >= 3) f.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [p.concat([p[0]])] }, properties: {} });
    else if (p.length) f.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: p.length > 1 ? p : [p[0], p[0]] }, properties: {} });
    s.setData({ type: 'FeatureCollection', features: f });
  }
  function setRoute(stops) {        // stops: [[lng, lat], ...] in order
    const s = map && map.getSource('route'); if (!s) return;
    stops.forEach((p, i) => { const id = 'stop-' + (i + 1); if (!map.hasImage(id)) map.addImage(id, stopIcon(i + 1), { pixelRatio: 2 }); });
    s.setData({ type: 'FeatureCollection', features: (stops.length > 1 ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: stops }, properties: {} }] : [])
      .concat(stops.map((p, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { n: i + 1 } }))) });
  }

  // ---- map modes (Map Settings drawer) ----
  // ---- zero-blank-map watchdog: the primary basemap source must draw a tile. Google: 2.5 s (Android PWA blank-white guard); others 8 s; or 3 errors ----
  let tileErr = 0, ok = {}, swaps = 0, dog = null;
  const primary = () => { const src = Object.keys(((map && map.getStyle && map.getStyle()) || {}).sources || {}).filter(id => !APP_SRC[id]); return src.includes('imagery') ? 'imagery' : src[0]; };
  function swap() { if (swaps >= 2) return; swaps++; DF.map.base = NEXT[base()]; DF.map.fallback = true; DF.toast('Map tiles unavailable: switched to ' + NAMES[DF.map.base]); setMode(DF.map.base === 'osm' ? 'street' : mode === 'street' ? 'hybrid' : mode); }
  function arm() { tileErr = 0; ok = {}; clearTimeout(dog); dog = setTimeout(() => { const p = primary(); if (p && !ok[p]) swap(); }, base() === 'google' ? (DF.cfg.TILE_WATCHDOG_MS || 2500) : 8000); }
  // ---- 1-tap basemap switcher (Hybrid ▾): Google Hybrid | Esri Satellite (imagery + road / place labels) | Street (OSM) ----
  const LABEL = { hybrid: 'Hybrid', street: 'Street', satellite: 'Satellite' };
  const choice = m => base() === 'osm' || m === 'street' ? 'osm' : base();
  const label = m => { const b = DF.$('#pill-layers'); if (b) b.textContent = (choice(m) === 'osm' ? 'Street' : choice(m) === 'esri' ? 'Esri' : LABEL[m]) + ' ▾';
    DF.$$('#basemap-menu button').forEach(x => x.classList.toggle('on', x.dataset.b === choice(m))); };
  function setBasemap(k) { if (!NEXT[k]) return; DF.map.base = k; DF.store.set('basemap', k); swaps = 0; setMode(k === 'osm' ? 'street' : 'hybrid'); }
  function setMode(m) {
    if (!['street', 'hybrid', 'satellite'].includes(m)) return;
    mode = DF.map.mode = m; DF.store.set('mapMode', m); DF.map.ready = false; label(m);
    if (map) map.setStyle(buildStyle(m), { diff: false });   // full swap so style.load re-adds pins
  }

  function init(container) {
    mode = DF.map.mode = DF.store.get('mapMode', DF.cfg.DEFAULT_MODE); label(mode);
    const rows = DF.sync.all().filter(visible), b = new maplibregl.LngLatBounds();
    rows.forEach(r => b.extend([r.lng, r.lat]));
    // v2.4.3: full two-finger rotate + tilt (the N compass snaps back to north-up) · no tile fade + no re-fetch of expired tiles (battery + data)
    map = new maplibregl.Map({ container, style: buildStyle(mode), attributionControl: false, dragRotate: true, pitchWithRotate: true, touchPitch: true, maxPitch: 60,
      fadeDuration: 0, refreshExpiredTiles: false,
      center: rows.length ? b.getCenter() : [-98.5, 39.8], zoom: rows.length ? 13 : 3, maxZoom: 20 });
    map.touchZoomRotate.enableRotation(); map.keyboard.enableRotation();
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    map.on('style.load', addLayers);
    map.on('style.load', arm);
    map.on('sourcedata', e => { if (e.sourceId && e.tile && !APP_SRC[e.sourceId]) ok[e.sourceId] = true; });
    map.on('error', e => { const p = primary(); if (!e.sourceId || e.sourceId !== p || ok[p] || ++tileErr < 3) return; swap(); });
    map.on('idle', () => { const p = primary(); if (p && !ok[p] && tileErr > 0) swap(); });            // everything settled, tiles failed, nothing drawn
    map.on('dragstart', () => { DF.map.moved = true; });
    map.on('styleimagemissing', e => { if (/^cl-/.test(e.id)) map.addImage(e.id, clusterIcon(e.id), { pixelRatio: 2 }); else if (/^pin-/.test(e.id)) addPin(e.id); });
    map.once('load', () => {
      if (rows.length > 1 && !DF.map.moved) map.fitBounds(b, { padding: 60, maxZoom: 16, duration: 0 });   // never override a jump / pan made before tiles finished
      DF.$$('.maplibregl-ctrl-attrib').forEach(el => el.classList.add('maplibregl-compact-show', 'df-attrib'));   // credits badge always shown
    });
    map.on('click', 'clusters', e => {
      if (DF.tools.busy()) return;
      const f = e.features[0];
      map.getSource('leads').getClusterExpansionZoom(f.properties.cluster_id).then(z => map.easeTo({ center: f.geometry.coordinates, zoom: Math.max(z, CLUSTER.maxZoom + 0.6) }));
    });
    map.on('click', 'pins', e => { const id = e.features[0].properties.lead_id; if (!DF.tools.pinTap(id)) { select([id]); DF.bus.emit('pin:selected', id); } });
    map.on('click', e => { if (map.queryRenderedFeatures(e.point, { layers: ['pins', 'clusters'] }).length) return; if (!DF.tools.mapTap(e)) { select([]); DF.bus.emit('map:blank'); } });
    ['pins:changed', 'campaign:changed', 'filters:changed', 'roster:changed', 'auth:changed'].forEach(ev => DF.bus.on(ev, refresh));
    DF.bus.on('statuses:changed', () => { DF.ringCss(); if (map && map.getSource('leads')) { dropPins(); refresh(); } });
    DF.bus.on('tab:changed', t => { if (t === 'map' && map) setTimeout(() => map.resize(), 0); });
    DF.map.instance = map;  // CLUSTER settings, cluster images + pin taps are unchanged from v2.1
    renderLegend();
  }

  DF.map = { init, setMode, setBasemap, setStatus, setRing, setProps, refresh, select, jumpTo, drawLasso, setRoute, buildStyle, fc, ringOf, visible,
    CLUSTER, CLUSTER_LABEL, CLUSTER_ICON, CLUSTER_RING, CLUSTER_SIZE, PIN_SIZE, clusterRadius, stacks, mode, ready: false, selected: () => Array.from(selected), instance: null };
})();
