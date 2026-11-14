// Doorway Field v2.0 — MapTools: pills (Filters, Search, Lasso, Multi-Select, Rapid-Stamp | Layers, Drop Pin, Compass, Follow Me),
// long-press radial status wheel (drops a reverse-geocoded pin stamped with the active campaign), Rapid-Stamp mode,
// freehand or tap-corner lasso (temporary: cleared when its sheet closes). Foreground GPS only; Follow Me stops when hidden.
(function () {
  'use strict';
  const DF = window.DF;
  const $ = s => DF.$(s);
  let lastFix = null;   // { ll, acc, ts } from any foreground GPS read
  let lasso = null, freehand = null, skipClick = false, multi = false, dropArmed = false, stamp = null, wheelAt = null, watchId = null, lastPos = null, pressTimer = null;
  const geoCache = new Map(); let geoLast = 0;
  const armSkip = () => { skipClick = true; setTimeout(() => { skipClick = false; }, 400); };   // swallow only the click that follows a drag / long-press

  // ---- reverse geocoding (OSM Nominatim, light use: 1 request/s, cached; falls back to a coordinate label) ----
  async function geocode(ll) {
    const key = ll.lat.toFixed(5) + ',' + ll.lng.toFixed(5);
    if (geoCache.has(key)) return geoCache.get(key);
    const fallback = { address: 'Pin ' + key.replace(',', ', ') };
    if (!DF.cfg.GEOCODE_URL || navigator.onLine === false) return fallback;
    const wait = Math.max(0, geoLast + 1100 - Date.now()); geoLast = Date.now() + wait;
    await new Promise(r => setTimeout(r, wait));
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 2500);
      const j = await (await fetch(DF.cfg.GEOCODE_URL + '?format=jsonv2&addressdetails=1&zoom=18&lat=' + ll.lat + '&lon=' + ll.lng, { signal: ctl.signal })).json();
      clearTimeout(t);
      const a = j.address || {}, street = [a.house_number, a.road].filter(Boolean).join(' ');
      const out = street ? { address: street.toUpperCase(), city: String(a.city || a.town || a.village || a.hamlet || '').toUpperCase(),
        state: String(a['ISO3166-2-lvl4'] || '').replace(/^US-/, ''), zip: String(a.postcode || '').slice(0, 5) } : fallback;
      geoCache.set(key, out); return out;
    } catch (e) { return fallback; }
  }
  const activeCampaign = () => DF.campaign === '*' ? (DF.myCampaigns()[0] || DF.cfg.DEFAULT_CAMPAIGN) : DF.campaign;
  async function createPinAt(ll, code, apt, how) {
    const g = await geocode(ll);
    const row = Object.assign({ lat: ll.lat, lng: ll.lng, status_code: 'NEW', campaign: activeCampaign(), assigned_rep_email: DF.isManager() ? '' : DF.auth.id }, g, apt ? { apt } : {});
    const rep = await DF.sync.importRows([row], { source: 'drop' }), id = DF.sync.leadId(row.address, row.apt || '', row.zip || '');
    if (!rep.added && !rep.updated) { DF.toast('Could not drop a pin here'); return null; }
    DF.sync.append({ type: 'create', lead_id: id, campaign: row.campaign, how: how || (stamp ? 'stamp' : 'wheel') });
    if (code && code !== 'NEW') DF.card.dispose(id, code, { source: stamp ? 'stamp' : 'wheel' });
    if (!stamp) { DF.map.select([id]); DF.bus.emit('pin:selected', id); }
    return id;
  }

  // ---- radial status wheel (centred on screen; the map eases the pressed house to the centre: no positioned elements) ----
  function openWheel(ll) {
    wheelAt = ll; showAdd(false);
    DF.map.instance.easeTo({ center: ll, duration: 250 });
    const items = DF.sync.STATUS.filter(s => s.menu);
    $('#wheel-items').className = 'wheel-items wn-' + Math.min(items.length, 12);
    $('#wheel-items').innerHTML = items.slice(0, 12).map((s, i) => '<button type="button" class="wbtn wi-' + i + ' dispo-' + s.code + '" data-code="' + s.code + '"><i>' + DF.esc(s.icon) + '</i><span>' + DF.esc(s.short) + '</span></button>').join('');
    DF.$$('#wheel-items .wbtn').forEach(b => b.addEventListener('click', () => { const at = wheelAt; closeWheel(); createPinAt(at, b.dataset.code); }));
    $('#wheel').classList.add('open');
  }
  function closeWheel() { wheelAt = null; $('#wheel').classList.remove('open'); }

  // ---- lasso: freehand drag (or tap corners + Done). Opens the breakdown sheet; the shape is cleared when the sheet closes. ----
  const pip = (pt, poly) => { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside; } return inside; };
  const pointsIn = poly => DF.sync.all().filter(r => DF.map.visible(r) && pip([r.lng, r.lat], poly)).map(r => r.lead_id);
  function lassoCount() { const n = lasso ? lasso.length : 0; $('#lasso-count').textContent = n ? n + ' corner' + (n === 1 ? '' : 's') + (n >= 3 ? ' · ' + pointsIn(lasso).length + ' doors' : '') : 'Drag a circle around doors, or tap corners'; }
  function startLasso() { lasso = []; DF.showTab('map'); DF.bus.emit('map:blank'); $('#lasso-bar').classList.add('open'); $('#pill-lasso').classList.add('active'); DF.map.drawLasso([]); lassoCount(); }
  function endLasso(keepShape) { lasso = null; freehand = null; DF.map.instance.dragPan.enable(); $('#lasso-bar').classList.remove('open'); $('#pill-lasso').classList.remove('active'); if (!keepShape) DF.map.drawLasso([]); }
  function finishLasso(poly) {
    poly = poly || (lasso || []).slice(); endLasso(true);
    if (poly.length < 3) { DF.map.drawLasso([]); return []; }
    DF.map.drawLasso(poly);
    const ids = pointsIn(poly); DF.map.select(ids); DF.lasso.open(ids, 'Lasso', poly);
    return ids;
  }
  function bindFreehand() {
    const el = DF.map.instance.getCanvasContainer(), m = DF.map.instance;
    const pt = e => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    el.addEventListener('pointerdown', e => { if (!lasso) return; m.dragPan.disable(); freehand = { px: [pt(e)], ll: [m.unproject(pt(e)).toArray()] }; });
    el.addEventListener('pointermove', e => {
      if (!lasso || !freehand) return;
      const p = pt(e), last = freehand.px[freehand.px.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 6) return;
      freehand.px.push(p); freehand.ll.push(m.unproject(p).toArray()); DF.map.drawLasso(freehand.ll);
    });
    el.addEventListener('pointerup', () => { if (!lasso || !freehand) return; const f = freehand; freehand = null; m.dragPan.enable(); if (f.ll.length >= 8) { armSkip(); finishLasso(f.ll); } });
  }

  // ---- long press (touch hold 550 ms, or right-click / contextmenu) ----
  function bindLongPress() {
    const m = DF.map.instance, cancel = () => { clearTimeout(pressTimer); pressTimer = null; };
    m.on('touchstart', e => { if (lasso || (e.originalEvent.touches || []).length > 1) return cancel(); const ll = e.lngLat; cancel(); pressTimer = setTimeout(() => { pressTimer = null; armSkip(); openWheel(ll); }, 550); });
    ['touchend', 'touchmove', 'movestart', 'zoomstart'].forEach(ev => m.on(ev, cancel));
    m.on('contextmenu', e => { if (!lasso) openWheel(e.lngLat); });
  }

  // ---- what a tap means right now (called by MapEngine) ----
  function pinTap(id) {
    if (lasso || wheelAt) return true;
    if (stamp) { DF.card.dispose(id, stamp, { source: 'stamp' }); return true; }
    if (multi) { const s = new Set(DF.map.selected()); s.has(id) ? s.delete(id) : s.add(id); DF.map.select(Array.from(s)); return true; }
    return false;
  }
  function mapTap(e) {
    if (skipClick) { skipClick = false; return true; }
    if (wheelAt) { closeWheel(); return true; }
    if (dropArmed) { openWheel(e.lngLat); return true; }
    if (lasso) { lasso.push([e.lngLat.lng, e.lngLat.lat]); DF.map.drawLasso(lasso); lassoCount(); return true; }
    if (stamp) { createPinAt(e.lngLat, stamp); return true; }
    return multi;
  }
  function setStamp(code) {
    stamp = code || null; DF.$$('#stamp-items .dispo').forEach(b => b.classList.toggle('on', b.dataset.code === stamp));
    $('#stamp-bar').classList.toggle('open', stamp !== null || $('#stamp-bar').classList.contains('open') && code !== false);
    $('#pill-stamp').classList.toggle('active', !!stamp);
  }
  function renderStampBar() {
    $('#stamp-items').innerHTML = DF.sync.STATUS.filter(s => s.menu).map(s => '<button type="button" class="dispo dispo-' + s.code + '" data-code="' + s.code + '"><i>' + DF.esc(s.icon) + '</i><span>' + DF.esc(s.short) + '</span></button>').join('');
    DF.$$('#stamp-items .dispo').forEach(b => b.addEventListener('click', () => setStamp(stamp === b.dataset.code ? null : b.dataset.code)));
  }

  // ---- rep location (v2.4.2): blue dot + accuracy ring only from a REAL fix; Locate Me = immediate high-accuracy fix + fly; GPS pauses when hidden ----
  const GPS_OPTS = { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }, JITTER_M = 4;
  let pausedFollow = false;
  const meters = (a, b) => { const k = Math.PI / 180, x = (b[0] - a[0]) * k * Math.cos((a[1] + b[1]) * k / 2), y = (b[1] - a[1]) * k; return Math.hypot(x, y) * 6371000; };
  function ring(ll, acc) {                                              // accuracy circle as a 48-point polygon (metres → degrees)
    const r = Math.min(Math.max(acc || 0, 3), 2000), pts = [];
    for (let i = 0; i <= 48; i++) { const t = i / 48 * 2 * Math.PI; pts.push([ll[0] + r * Math.cos(t) / (111320 * Math.cos(ll[1] * Math.PI / 180)), ll[1] + r * Math.sin(t) / 110540]); }
    return pts;
  }
  function drawMe() {
    const s = DF.map.instance && DF.map.instance.getSource('me'); if (!s) return;
    s.setData({ type: 'FeatureCollection', features: lastPos ? [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring(lastPos, lastFix && lastFix.acc)] }, properties: {} },
      { type: 'Feature', geometry: { type: 'Point', coordinates: lastPos }, properties: {} }] : [] });
  }
  // every GPS reading goes through here: ignore < 4 m micro-jitter (rep standing at a door) unless accuracy clearly improved
  function onFix(c) {
    const ll = [c.longitude, c.latitude], now = Date.now();
    if (lastPos && lastFix && meters(lastPos, ll) < JITTER_M && !(c.accuracy < lastFix.acc - 3)) { lastFix.ts = now; return false; }
    lastPos = ll; lastFix = { ll, acc: c.accuracy, ts: now }; drawMe();
    return true;
  }
  function follow(on) {
    if (on === undefined) on = watchId === null;
    if (on && navigator.geolocation && watchId === null) {
      watchId = navigator.geolocation.watchPosition(p => { if (onFix(p.coords)) DF.map.instance.easeTo({ center: lastPos, zoom: Math.max(DF.map.instance.getZoom(), 17), duration: 500 }); },
        () => { DF.toast('Location unavailable'); follow(false); }, GPS_OPTS);
    } else if (!on && watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    DF.tools.following = watchId !== null; $('#pill-gps').classList.toggle('active', DF.tools.following);
  }
  function locateMe() {                                                 // tap: fresh high-accuracy fix → fly there → keep following; tap again = stop
    if (watchId !== null) return follow(false);
    if (!navigator.geolocation) { DF.toast('Location unavailable'); return Promise.resolve(null); }
    return new Promise(res => navigator.geolocation.getCurrentPosition(p => {
      onFix(p.coords); lastPos = [p.coords.longitude, p.coords.latitude]; lastFix = { ll: lastPos, acc: p.coords.accuracy, ts: Date.now() }; drawMe();
      DF.map.moved = true; DF.map.instance.flyTo({ center: lastPos, zoom: Math.max(DF.map.instance.getZoom(), 17), bearing: 0, duration: 600 });
      follow(true); res(lastPos);
    }, () => { DF.toast('Location unavailable: check location permission'); res(null); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }));
  }
  function onVisibility() {
    if (document.visibilityState === 'hidden') { pausedFollow = watchId !== null; follow(false); }
    else if (pausedFollow) { pausedFollow = false; follow(true); }        // resume right away when the screen comes back
  }
  function locateOnce(maxAge) {
    return new Promise(res => {
      if (!navigator.geolocation) return res(null);
      navigator.geolocation.getCurrentPosition(p => { onFix(p.coords); res({ ll: [p.coords.longitude, p.coords.latitude], acc: p.coords.accuracy }); },
        () => res(null), { enableHighAccuracy: true, maximumAge: maxAge == null ? 30000 : maxAge, timeout: 8000 });
    });
  }
  // Knock GPS: always ask for a FRESH fix (maximumAge 0). If none arrives within `ms` (default 800), fall back to the latest cached fix,
  // flagged 'cached' with its age, so a stale position is never logged as if it were fresh.
  function locateFresh(ms) {
    ms = ms || 800;
    return new Promise(res => {
      if (!navigator.geolocation) return res(null);
      let done = false;
      const cached = () => lastFix ? { ll: lastFix.ll, acc: lastFix.acc, fix: 'cached', age_s: Math.round((Date.now() - lastFix.ts) / 1000) } : null;
      const t = setTimeout(() => { done = true; res(cached()); }, ms);
      navigator.geolocation.getCurrentPosition(p => {
        onFix(p.coords);
        if (!done) { done = true; clearTimeout(t); res({ ll: [p.coords.longitude, p.coords.latitude], acc: p.coords.accuracy, fix: 'fresh', age_s: 0 }); }
      }, () => { if (!done) { done = true; clearTimeout(t); res(cached()); } }, { enableHighAccuracy: true, maximumAge: 0, timeout: ms });
    });
  }
  function position() { if (lastPos) return lastPos; const c = DF.map.instance ? DF.map.instance.getCenter() : { lng: 0, lat: 0 }; return [c.lng, c.lat]; }

  // ---- + Add Pin: unlisted new builds / extra units at my GPS or the map-centre crosshair ----
  function showAdd(on) { $('#add-bar').classList.toggle('open', on); $('#add-cross').hidden = !on; dropArmed = on; $('#pill-drop').classList.toggle('active', on); }
  async function addPin(where) {
    const unit = $('#add-unit').value.trim().slice(0, 12); let ll;
    if (where === 'gps') { const f = await locateFresh(800); if (!f) { DF.toast('No GPS fix: use the map centre'); return null; } ll = { lng: f.ll[0], lat: f.ll[1] }; }
    else { const c = DF.map.instance.getCenter(); ll = { lng: c.lng, lat: c.lat }; }
    const id = await createPinAt(ll, 'NEW', unit, unit ? 'unit' : where);
    if (id) { $('#add-unit').value = ''; showAdd(false); }
    return id;
  }
  // ---- search: 100% on-device over loaded leads. OSM Nominatim is asked ONLY when the rep taps "Search Town/Street" (nothing leaves the phone otherwise) ----
  let geoSeq = 0;
  async function geoSearch(q) {
    const seq = ++geoSeq, c = DF.map.instance.getCenter();
    try {
      const u = DF.cfg.SEARCH_URL + '?format=json&limit=4&countrycodes=us&q=' + encodeURIComponent(q) + '&viewbox=' + [c.lng - 1, c.lat + 1, c.lng + 1, c.lat - 1].join(',');
      const res = await (await fetch(u, { headers: { Accept: 'application/json' } })).json(); if (seq !== geoSeq || !Array.isArray(res)) return [];
      res.slice(0, 4).forEach(p => {
        const parts = String(p.display_name || '').split(','), li = document.createElement('li'); li.className = 'geo';
        li.innerHTML = '<b>⌖ ' + DF.esc(parts.slice(0, 2).join(',')) + '</b><span>' + DF.esc(parts.slice(2, 4).join(',').trim()) + '</span>';
        li.addEventListener('click', () => {
          $('#search-bar').classList.remove('open'); DF.map.moved = true; const m = DF.map.instance, bb = (p.boundingbox || []).map(Number);
          if (bb.length === 4 && bb[1] - bb[0] > 0.01) m.fitBounds([[bb[2], bb[0]], [bb[3], bb[1]]], { padding: 40, maxZoom: 16, duration: 0 }); else m.jumpTo({ center: [+p.lon, +p.lat], zoom: 17 });
        });
        $('#search-results').appendChild(li);
      });
      return res;
    } catch (e) { return []; }
  }
  function search(q) {
    q = q.trim().toLowerCase(); const out = $('#search-results'); out.innerHTML = ''; geoSeq++;
    $('#search-geo').hidden = q.length < 3;
    if (q.length < 2) return [];
    const hits = DF.sync.all().filter(r => DF.inCampaign(r) && [r.address, r.apt, r.first_name, r.last_name, r.zip, r.city, r.rep_note].join(' ').toLowerCase().includes(q)).slice(0, 6);
    hits.forEach(r => { const li = document.createElement('li'); li.innerHTML = '<b>' + DF.esc(r.address + (r.apt ? ' ' + r.apt : '')) + '</b><span>' + DF.esc([r.first_name, r.last_name].join(' ').trim() || r.city) + '</span>';
      li.addEventListener('click', () => { $('#search-bar').classList.remove('open'); DF.map.jumpTo(r.lead_id); }); out.appendChild(li); });
    return hits;
  }

  function init() {
    const on = (sel, fn) => $(sel).addEventListener('click', fn);
    on('#pill-search', () => { $('#search-bar').classList.toggle('open'); $('#search-input').focus(); });
    $('#search-input').addEventListener('input', e => search(e.target.value));
    on('#search-geo', () => { const q = $('#search-input').value.trim(); if (q.length >= 3) geoSearch(q); });
    on('#pill-lasso', () => lasso ? endLasso() : startLasso());
    on('#lasso-done', () => finishLasso());
    on('#lasso-cancel', () => endLasso());
    on('#pill-multi', () => { multi = !multi; $('#pill-multi').classList.toggle('active', multi); $('#sel-bar').classList.toggle('open', multi); if (multi) DF.bus.emit('map:blank'); else DF.map.select([]); });
    on('#sel-status', () => { if (DF.map.selected().length) DF.lasso.open(DF.map.selected(), 'Selected'); });
    on('#sel-clear', () => DF.map.select([]));
    on('#pill-stamp', () => { const open = !$('#stamp-bar').classList.contains('open'); $('#stamp-bar').classList.toggle('open', open); if (!open) setStamp(false); $('#pill-stamp').classList.toggle('active', open); });
    on('#stamp-close', () => { setStamp(false); $('#stamp-bar').classList.remove('open'); $('#pill-stamp').classList.remove('active'); });
    on('#pill-layers', () => DF.openModal('layers-drawer'));
    DF.$$('.mode-card').forEach(c => c.addEventListener('click', () => { DF.map.setMode(c.dataset.mode); DF.closeModal('layers-drawer'); }));
    on('#pill-drop', () => showAdd(!dropArmed));   // bar explains itself: tap a house, or My GPS / Map centre
    on('#add-gps', () => addPin('gps')); on('#add-center', () => addPin('center')); on('#add-close', () => showAdd(false));
    on('#pill-compass', () => DF.map.instance.easeTo({ bearing: 0, pitch: 0, duration: 300 }));   // N = back to north-up, flat
    on('#pill-gps', () => locateMe());
    on('#wheel-cancel', closeWheel);
    DF.bus.on('selection:changed', ids => { $('#sel-count').textContent = ids.length + ' selected'; });
    DF.bus.on('statuses:changed', renderStampBar);
    document.addEventListener('visibilitychange', onVisibility);
    renderStampBar(); bindFreehand(); bindLongPress();
  }

  DF.tools = { init, busy: () => !!(lasso || wheelAt || dropArmed), pinTap, mapTap, openWheel, closeWheel, createPinAt, geocode, startLasso, finishLasso, endLasso,
    pointsIn, pip, setStamp, follow, locateMe, onFix, locateOnce, locateFresh, position, addPin, geoSearch, showAdd, search, following: false, stamp: () => stamp, multi: () => multi };
})();
