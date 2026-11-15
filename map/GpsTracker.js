// Doorway Field v2.5 — GpsTracker: 2-mode GPS controller on the ◎ button. Tap = watchPosition + fly to the rep + Follow (button blue, "Following GPS").
// A manual pan unlocks the camera while the blue dot keeps updating; tap again snaps back. Blue dot + accuracy halo only from a REAL fix, < 4 m jitter
// ignored, watch paused while the screen is off and resumed on return. Permission denied → a clear toast; v2.5.1: unavailable / timeout (Android "Precise location" off) → retry low accuracy and still fly to the rep. Also: knock GPS (locateFresh).
(function () {
  'use strict';
  const DF = window.DF;
  const $ = s => DF.$(s);
  const WATCH = { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }, JITTER_M = 4;
  const LOW = { enableHighAccuracy: false, maximumAge: 30000, timeout: 20000 };   // v2.5.1: Android "Precise location" off → network / approximate fix
  const DENIED = 'Enable Location permission in browser settings for GPS';
  let watchId = null, lastPos = null, lastFix = null, paused = false;
  const G = { following: false, watching: false, coarse: false };

  const meters = (a, b) => { const k = Math.PI / 180, x = (b[0] - a[0]) * k * Math.cos((a[1] + b[1]) * k / 2), y = (b[1] - a[1]) * k; return Math.hypot(x, y) * 6371000; };
  function ring(ll, acc) {                                              // accuracy halo as a 48-point polygon (metres → degrees)
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
  function paint() {
    const b = $('#pill-gps'), label = G.following ? 'Following GPS' : G.watching ? 'GPS on: tap to follow' : 'Locate me';
    b.classList.toggle('gps-follow', G.following); b.classList.toggle('gps-live', G.watching && !G.following); b.classList.toggle('active', G.following);
    b.setAttribute('aria-label', label); b.title = label;
  }
  const fly = () => { if (!lastPos) return; DF.map.moved = true; DF.map.instance.flyTo({ center: lastPos, zoom: Math.max(DF.map.instance.getZoom(), 17), duration: 600 }); };
  const center = () => { if (lastPos && G.following) DF.map.instance.easeTo({ center: lastPos, zoom: Math.max(DF.map.instance.getZoom(), 17), duration: 500 }); };
  function denied() { DF.toast(DENIED, null, null, 5000); G.following = false; watch(false); }
  function coarse() { G.coarse = true; if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; watch(true); } }   // unavailable / timeout → retry low accuracy
  function watch(on) {
    if (on && watchId === null) {
      if (!navigator.geolocation) { DF.toast(DENIED, null, null, 5000); return false; }
      watchId = navigator.geolocation.watchPosition(p => { if (onFix(p.coords)) center(); }, e => { if (e.code === 1) denied(); else if (!G.coarse) coarse(); }, G.coarse ? LOW : WATCH);
    } else if (!on && watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    G.watching = watchId !== null; paint();
    return G.watching;
  }
  // the ◎ button: start / resume the watch, follow, and fly to a fresh fix (or the live one)
  function locate() {
    if (!navigator.geolocation) { DF.toast(DENIED, null, null, 5000); return Promise.resolve(null); }
    G.following = true; watch(true);
    if (lastFix && Date.now() - lastFix.ts < 15000) { drawMe(); fly(); return Promise.resolve(lastPos); }
    const got = res => p => { onFix(p.coords); lastPos = [p.coords.longitude, p.coords.latitude]; lastFix = { ll: lastPos, acc: p.coords.accuracy, ts: Date.now() }; drawMe(); fly(); res(lastPos); };
    return new Promise(res => navigator.geolocation.getCurrentPosition(got(res), e => {
      if (e.code === 1) { denied(); return res(null); }
      if (!G.coarse) coarse();                                           // approximate location: same tap, low-accuracy retry, still flies to the rep
      navigator.geolocation.getCurrentPosition(got(res), () => { DF.toast('Waiting for a GPS signal…'); res(null); }, LOW);
    }, G.coarse ? LOW : { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }));
  }
  function follow(on) { if (on === false) { G.following = false; watch(false); return; } G.following = true; watch(true); center(); }   // compat for older callers
  function onVisibility() {
    if (document.visibilityState === 'hidden') { paused = watchId !== null; watch(false); }
    else if (paused) { paused = false; watch(true); }                   // resume right away when the screen comes back
  }
  function locateOnce(maxAge) {
    return new Promise(res => {
      if (!navigator.geolocation) return res(null);
      navigator.geolocation.getCurrentPosition(p => { onFix(p.coords); res({ ll: [p.coords.longitude, p.coords.latitude], acc: p.coords.accuracy }); },
        () => res(null), { enableHighAccuracy: true, maximumAge: maxAge == null ? 30000 : maxAge, timeout: 8000 });
    });
  }
  // Knock GPS: ask for a FRESH fix (maximumAge 0); if none within `ms` (800), use the latest cached fix flagged 'cached' + its age (never logged as fresh)
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
  function init() {                                                      // called by MapTools once the map exists
    $('#pill-gps').addEventListener('click', locate);
    DF.map.instance.on('dragstart', e => { if (e.originalEvent && G.following) { G.following = false; paint(); } });   // a manual pan unlocks the camera
    document.addEventListener('visibilitychange', onVisibility);
    DF.bus.on('map:layers', drawMe);                                     // basemap swap re-adds an empty 'me' source: redraw the dot
    paint();
  }

  DF.gps = Object.assign(G, { init, locate, follow, watch, onFix, drawMe, locateOnce, locateFresh, position, last: () => lastFix, DENIED });
})();
