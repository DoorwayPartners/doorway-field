// Doorway Field — shared golden-test harness (used by test_doorway_field.js and test_field_v2.js; Rule 6.3: one harness, no one-offs).
// No real network: MapLibre from node_modules, tiles / glyphs / styles / reverse-geocoder stubbed, Sync API = local mock. CSP violations are captured.
const fs = require('fs'), path = require('path'), http = require('http');
const ROOT = path.resolve(__dirname, '..');
// Staging layout = <root>/app ; published Pages repo layout = app files at the repo root (GitHub Actions auto-gate)
const APP = process.env.FIELD_APP_DIR ? path.resolve(process.env.FIELD_APP_DIR) : fs.existsSync(path.join(ROOT, 'app', 'index.html')) ? path.join(ROOT, 'app') : ROOT;
const ML = path.join(ROOT, 'node_modules', 'maplibre-gl', 'dist');
const FIX = path.join(__dirname, 'Brookline_Sanford_50.json');
const fixture = JSON.parse(fs.readFileSync(FIX, 'utf8'));
const OWNER = 'cristian-coy', MANAGER = 'manager-1', AGENT_A = 'agent-1', AGENT_B = 'agent-2';
// Test roster = the public seed + one generic test-only agent (no real names anywhere in the repo)
const TEST_ROSTER = [{ id: 'cristian-coy', name: 'Cristian Coy', role: 'Owner', team: 'Leadership', campaigns: ['*'], color: '#e31b23' },
  { id: 'manager-1', name: 'Manager 1', role: 'Manager', team: 'Team 1', campaigns: ['*'], color: '#2f80ed' }, { id: 'agent-1', name: 'Agent 1', role: 'Agent', team: 'Team 1', campaigns: ['Fidium'], color: '#00a3a3' },
  { id: 'agent-2', name: 'Agent 2', role: 'Agent', team: 'Team 2', campaigns: ['Fidium', 'AT&T Fiber'], color: '#c9a227' }];
let pass = 0, fail = 0;
const ok = (cond, name, info) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info).slice(0, 400) : '')); } };
const report = () => { console.log('\n' + (fail ? 'FAIL' : 'PASS') + ' ' + pass + '/' + (pass + fail)); return fail; };

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAAABJRU5ErkJggg==', 'base64');
const api = { events: new Map(), leads: new Map(), posts: 0, reject: new Set(), extra: [], invites: new Map(), geoSearches: 0 };
function apiHandle(body) {
  if (body.action === 'redeem_invite') {                          // Sync contract: single-use, unexpired token hash -> authorized roster profile
    const i = api.invites.get(body.token_hash); if (!i || i.used || i.exp < Date.now()) return { ok: false };
    i.used = true; return { ok: true, rep: i.rep };
  }
  api.posts++;
  const accepted = [];
  (body.events || []).forEach(e => {
    if (api.reject.has(e.lead_id)) return;
    accepted.push(e.event_id);
    if (api.events.has(e.event_id)) return;                       // idempotent on event_id
    api.events.set(e.event_id, e);
    if (e.type === 'invite') api.invites.set(e.h, { exp: e.exp, rep: { id: e.rep, name: e.name, role: e.role, team: e.team, campaigns: e.campaigns, color: e.color, pin: e.pin } });
    if (!e.lead_id || !e.patch) return;
    const cur = api.leads.get(e.lead_id) || { lead_id: e.lead_id };
    api.leads.set(e.lead_id, Object.assign(cur, e.patch, { updated_at: new Date().toISOString() }));
  });
  return { ok: true, accepted, leads: api.extra.splice(0), server_ts: new Date().toISOString() };
}
async function stub(context) {
  await context.route('https://unpkg.com/maplibre-gl@4.7.1/dist/*', r => r.fulfill({ path: path.join(ML, path.basename(new URL(r.request().url()).pathname)) }));
  await context.route(/server\.arcgisonline\.com|basemap\.nationalmap\.gov|mt\d\.google\.com/, r => r.fulfill({ body: PNG, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } }));
  await context.route('https://tiles.openfreemap.org/**', r => {
    const u = r.request().url();
    if (u.endsWith('/styles/liberty')) return r.fulfill({ json: { version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf', sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#f4f1ea' } }] } });
    if (u.endsWith('/planet')) return r.fulfill({ json: { tilejson: '2.2.0', tiles: ['https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 } });
    if (u.includes('/fonts/')) return r.fulfill({ status: 404 });                // offline-like: no glyphs; pins + clusters must still draw
    return r.fulfill({ body: Buffer.alloc(0), contentType: 'application/x-protobuf' });
  });
  await context.route('https://nominatim.openstreetmap.org/**', r => {           // reverse geocoder stub: deterministic house number from the coordinates
    const u = new URL(r.request().url());
    if (u.pathname === '/search') { api.geoSearches++; return r.fulfill({ json: /portland/i.test(u.searchParams.get('q')) ? [{ display_name: 'Portland, Cumberland County, Maine, United States', lat: '43.6591', lon: '-70.2568',
      boundingbox: ['43.54', '43.71', '-70.35', '-70.17'] }] : [], headers: { 'access-control-allow-origin': '*' } }); }
    const n = 300 + Math.round(Math.abs(Number(u.searchParams.get('lon')) * 1e4)) % 600;
    r.fulfill({ json: { address: { house_number: String(n), road: 'Elm Street', city: 'Sanford', 'ISO3166-2-lvl4': 'US-ME', postcode: '04073' } }, headers: { 'access-control-allow-origin': '*' } });
  });
  await context.route('https://api.test/exec', r => r.fulfill({ json: apiHandle(JSON.parse(r.request().postData() || '{}')), headers: { 'access-control-allow-origin': '*' } }));
}
function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
  return new Promise(res => {
    const srv = http.createServer((req, resp) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
      const file = p.startsWith('/tests/') ? path.join(__dirname, p.slice(7)) : path.join(APP, p);
      if (!(file.startsWith(APP) || file.startsWith(__dirname)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { resp.writeHead(404); return resp.end(); }
      resp.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(resp);
    }).listen(0, () => res(srv));
  });
}
async function newPage(browser, base, opts) {
  const { devices } = require('playwright');
  opts = opts || {};
  const context = await browser.newContext(Object.assign({}, devices[opts.device || 'iPhone 13'], { serviceWorkers: 'block', permissions: ['geolocation'],
    geolocation: opts.geo || { latitude: 43.4394, longitude: -70.7743 }, acceptDownloads: true }));
  await stub(context);
  if (opts.block) await context.route(opts.block, r => r.abort());
  if (opts.env) await context.route('**/config.env.js', r => r.fulfill({ body: 'window.DF_ENV = ' + JSON.stringify(opts.env) + ';', contentType: 'text/javascript' }));   // later routes win: simulate a blocked tile host
  await context.addInitScript(o => {
    window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
    window.DF_CONFIG_OVERRIDE = Object.assign({ API_URL: 'https://api.test/exec', FIXTURE_URL: '/tests/Brookline_Sanford_50.json', SW: false, FLUSH_EVERY_MS: 3000, ROSTER: o.roster }, o.override || {});
    if (!o.install && !localStorage.getItem('df.installDismissed')) localStorage.setItem('df.installDismissed', String(Date.now()));   // banner tested on purpose only
    if (o.user && !localStorage.getItem('df.user')) localStorage.setItem('df.user', JSON.stringify({ id: o.user }));
  }, { user: opts.user || '', override: opts.override || null, roster: TEST_ROSTER, install: !!opts.install });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base + (opts.path || ''));
  return { context, page, errors };
}
const ready = page => page.waitForFunction(() => window.DF && DF.ready && DF.map.ready, null, { timeout: 30000 });
const idle = page => page.evaluate(() => new Promise(r => { const m = DF.map.instance; if (m.loaded() && !m.isMoving()) setTimeout(r, 150); else m.once('idle', r); }));
const tap = async (page, id, code) => { await page.evaluate(i => DF.bus.emit('pin:selected', i), id); await page.click('#lead-menu [data-code="' + code + '"]'); };
async function launch() {
  const { chromium } = require('playwright');
  const srv = await serve(), base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  return { srv, base, browser, close: async () => { await browser.close(); srv.close(); } };
}

module.exports = { ROOT, APP, ML, FIX, fixture, OWNER, MANAGER, AGENT_A, AGENT_B, TEST_ROSTER, ok, report, api, apiHandle, stub, serve, newPage, ready, idle, tap, launch };
