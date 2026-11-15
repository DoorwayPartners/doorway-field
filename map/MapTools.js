// Doorway Field v2.5 — MapTools: pills (Filters, Search, Multi-Select, Rapid-Stamp | basemap menu, + Add Pin, Compass), long-press radial status wheel
// (drops a reverse-geocoded pin stamped with the active campaign), Rapid-Stamp, search, point-in-polygon helpers. Turf lasso → TurfLasso.js, GPS → GpsTracker.js.
(function () {
  'use strict';
  const DF = window.DF;
  const $ = s => DF.$(s);
  let skipClick = false, multi = false, dropArmed = false, stamp = null, wheelAt = null, pressTimer = null;
  const drawing = () => !!(DF.turflasso && DF.turflasso.active());
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

  // ---- point-in-polygon + programmatic lasso (the finger lasso itself lives in TurfLasso.js) ----
  const pip = (pt, poly) => { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside; } return inside; };
  const pointsIn = poly => DF.sync.all().filter(r => DF.map.visible(r) && pip([r.lng, r.lat], poly)).map(r => r.lead_id);
  function finishLasso(poly) {                                           // full breakdown sheet for a given polygon
    if (!poly || poly.length < 3) { DF.map.drawLasso([]); return []; }
    DF.map.drawLasso(poly);
    const ids = pointsIn(poly); DF.map.select(ids); DF.lasso.open(ids, 'Lasso', poly);
    return ids;
  }

  // ---- long press (touch hold 550 ms, or right-click / contextmenu) ----
  function bindLongPress() {
    const m = DF.map.instance, cancel = () => { clearTimeout(pressTimer); pressTimer = null; };
    m.on('touchstart', e => { if (drawing() || (e.originalEvent.touches || []).length > 1) return cancel(); const ll = e.lngLat; cancel(); pressTimer = setTimeout(() => { pressTimer = null; armSkip(); openWheel(ll); }, 550); });
    ['touchend', 'touchmove', 'movestart', 'zoomstart'].forEach(ev => m.on(ev, cancel));
    m.on('contextmenu', e => { if (!drawing()) openWheel(e.lngLat); });
  }

  // ---- what a tap means right now (called by MapEngine) ----
  function pinTap(id) {
    if (drawing() || wheelAt) return true;
    if (stamp) { DF.card.dispose(id, stamp, { source: 'stamp' }); return true; }
    if (multi) { const s = new Set(DF.map.selected()); s.has(id) ? s.delete(id) : s.add(id); DF.map.select(Array.from(s)); return true; }
    return false;
  }
  function mapTap(e) {
    if (skipClick) { skipClick = false; return true; }
    if (wheelAt) { closeWheel(); return true; }
    if (dropArmed) { openWheel(e.lngLat); return true; }
    if (drawing()) return true;
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

  // ---- + Add Pin: unlisted new builds / extra units at my GPS or the map-centre crosshair ----
  function showAdd(on) { $('#add-bar').classList.toggle('open', on); $('#add-cross').hidden = !on; dropArmed = on; $('#pill-drop').classList.toggle('active', on); }
  async function addPin(where) {
    const unit = $('#add-unit').value.trim().slice(0, 12); let ll;
    if (where === 'gps') { const f = await DF.gps.locateFresh(800); if (!f) { DF.toast('No GPS fix: use the map centre'); return null; } ll = { lng: f.ll[0], lat: f.ll[1] }; }
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
    on('#pill-multi', () => { multi = !multi; $('#pill-multi').classList.toggle('active', multi); $('#sel-bar').classList.toggle('open', multi); if (multi) DF.bus.emit('map:blank'); else DF.map.select([]); });
    on('#sel-status', () => { if (DF.map.selected().length) DF.lasso.open(DF.map.selected(), 'Selected'); });
    on('#sel-clear', () => DF.map.select([]));
    on('#pill-stamp', () => { const open = !$('#stamp-bar').classList.contains('open'); $('#stamp-bar').classList.toggle('open', open); if (!open) setStamp(false); $('#pill-stamp').classList.toggle('active', open); });
    on('#stamp-close', () => { setStamp(false); $('#stamp-bar').classList.remove('open'); $('#pill-stamp').classList.remove('active'); });
    on('#pill-layers', () => DF.$('#basemap-menu').classList.toggle('open'));
    DF.$$('#basemap-menu button').forEach(b => b.addEventListener('click', () => { DF.$('#basemap-menu').classList.remove('open'); DF.map.setBasemap(b.dataset.b); }));
    DF.bus.on('map:blank', () => DF.$('#basemap-menu').classList.remove('open'));
    on('#pill-drop', () => showAdd(!dropArmed));   // bar explains itself: tap a house, or My GPS / Map centre
    on('#add-gps', () => addPin('gps')); on('#add-center', () => addPin('center')); on('#add-close', () => showAdd(false));
    on('#pill-compass', () => DF.map.instance.easeTo({ bearing: 0, pitch: 0, duration: 300 }));   // N = back to north-up, flat
    on('#wheel-cancel', closeWheel);
    DF.bus.on('selection:changed', ids => { $('#sel-count').textContent = ids.length + ' selected'; });
    DF.bus.on('statuses:changed', renderStampBar);
    renderStampBar(); bindLongPress();
    DF.gps.init(); DF.turflasso.init();
  }

  DF.tools = { init, busy: () => !!(drawing() || wheelAt || dropArmed), pinTap, mapTap, openWheel, closeWheel, createPinAt, geocode, finishLasso, armSkip,
    pointsIn, pip, setStamp, addPin, geoSearch, showAdd, search, stamp: () => stamp, multi: () => multi,
    locateOnce: m => DF.gps.locateOnce(m), locateFresh: ms => DF.gps.locateFresh(ms), position: () => DF.gps.position() };   // GPS aliases kept for shared_web callers
})();
