#!/usr/bin/env node
// Doorway Field — static secret / CSP / guardrail scan (no browser, ~1 s). Runs first in field_gate.sh and in GitHub Actions (auto-gate.yml).
// Checks: line caps, zero inline styles, zero secrets / Drive-Sheet-Script IDs, zero emails in app source, strict CSP meta, no inline script/style/handlers.
const fs = require('fs'), path = require('path');
const { APP, FIX, fixture } = require('./field_harness.js');
const MENU = ['NEW', 'NH1', 'NH2', 'NH3', 'GB', 'P_GB', 'SOLD', 'NI', 'APPT', 'PVL'];
function scan(ok) {
  console.log('Guardrails');
  const tests = fs.readdirSync(__dirname).filter(f => /\.js$/.test(f)).map(f => path.join(__dirname, f));
  const SRV = path.join(__dirname, '..', 'server'), srv = fs.existsSync(SRV) ? fs.readdirSync(SRV).filter(f => /\.gs$/.test(f)).map(f => path.join(SRV, f)) : [];
  const files = fs.readdirSync(APP).filter(f => /\.(js|html|css|webmanifest|svg)$/.test(f)).map(f => path.join(APP, f)).concat(tests, [FIX], srv);
  ok(!srv.filter(f => { const s = fs.readFileSync(f, 'utf8'); return /AKfycb|AIza[0-9A-Za-z_-]{20}|[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}|['"][A-Za-z0-9_-]{33,}['"]/.test(s); }).length, 'server/*.gs: zero secrets, IDs or emails (Script Properties only)');
  const limit = f => /OfflineSync\.js$/.test(f) ? 250 : /tests[\\/]test_.*\.js$/.test(f) ? 350 : 300;   // golden test files: owner cap 350; app modules < 300
  files.forEach(f => { const n = fs.readFileSync(f, 'utf8').split('\n').length - 1; ok(n < limit(f), path.basename(f) + ' ' + n + ' lines < ' + limit(f)); });
  const code = fs.readdirSync(APP).filter(f => /\.(js|html|css|webmanifest)$/.test(f)).map(f => [f, fs.readFileSync(path.join(APP, f), 'utf8')]);
  ok(!code.filter(([f, s]) => !f.endsWith('.css') && /\sstyle\s*=|\.style\b|setAttribute\(\s*['"]style|cssText/.test(s)).length, 'zero inline styles (no style=, .style, cssText)');
  ok(!code.filter(([f, s]) => !(process.env.FIELD_PUBLISHED === '1' && f === 'config.env.js') && /AKfycb|AIza[0-9A-Za-z_-]{20}|ya29\.|BEGIN [A-Z ]*PRIVATE KEY|client_secret|['"](?=[\w-]*\d)(?=[\w-]*[A-Z])[\w-]{25,}['"]/.test(s)).length, 'zero secrets / Drive-Sheet-Script IDs in app source (published config.js may hold the public Sync URL)');
  const emails = code.filter(([, s]) => /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/.test(s)).map(x => x[0]);
  ok(!emails.length, 'zero email addresses in public app source (roster = names only)', emails);
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8'), csp = (html.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
  ok(/script-src 'self' https:\/\/unpkg\.com;/.test(csp) && /style-src 'self' https:\/\/unpkg\.com;/.test(csp) && !/unsafe-(inline|eval)/.test(csp) && /object-src 'none'/.test(csp), 'CSP: self + pinned CDN only, no unsafe-inline / unsafe-eval', csp.slice(0, 120));
  ok(!/<script(?![^>]*\bsrc=)[^>]*>|<style[\s>]|\son[a-z]+\s*=/i.test(html), 'index.html: no inline <script>, <style> or on*= handlers');
  const cfg = fs.readFileSync(path.join(APP, 'config.public.js'), 'utf8'), envChk = require('./check_env.js');
  const envKeys = Array.from(((/ENV_KEYS = \[([^\]]*)\]/.exec(cfg) || [])[1] || '').matchAll(/'([A-Z_]+)'/g)).map(m => m[1]).join();
  ok(!fs.existsSync(path.join(APP, 'config.js')) && envKeys === envChk.KEYS.join(), 'config split: config.public.js (zip) + config.env.js (persistent) share one key whitelist; no stray config.js', envKeys);
  const envFile = path.join(APP, 'config.env.js');
  ok(process.env.FIELD_PUBLISHED === '1' ? fs.existsSync(envFile) && !envChk.check(envFile).length : !fs.existsSync(envFile), process.env.FIELD_PUBLISHED === '1' ? 'published config.env.js passes the whitelist' : 'staging app/ ships no config.env.js (zip can never overwrite it)');
  const seed = /ROSTER:\s*\[([\s\S]*?)\n\s*\]/.exec(cfg), names = seed ? Array.from(seed[1].matchAll(/name: '([^']+)'/g)).map(m => m[1]) : ['?'];
  ok(names.length <= 3 && names.every(n => n === 'Cristian Coy' || /^(Manager|Agent) \d+$/.test(n)), 'public roster seed = Owner + generic roles only (real names live in Admin / private Sync)', names);
  ok(fixture.pins.every(p => /^(agent|manager)-\d+$/.test(p.assigned_rep_email || 'agent-0')), 'fixture reps are generic roster ids');
  ok(/API_URL: ''/.test(cfg), 'config.public.js ships with a blank Sync URL (the live one lives in config.env.js)');
  const fx = fixture.pins, codes = new Set(fx.map(p => p.status_code));
  ok(fx.length === 50 && fx.every(p => /@example\.com$/.test(p.email) && /^207-555-01\d\d$/.test(p.phone) && p.campaign), 'fixture: 50 synthetic pins with campaigns');
  ok(MENU.every(c => codes.has(c)), 'fixture covers the 10 Lead Menu codes');
}

module.exports = { scan };
if (require.main === module) {
  let pass = 0, fail = 0;
  scan((cond, name, info) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info).slice(0, 300) : '')); } });
  console.log((fail ? 'SCAN FAIL ' : 'SCAN PASS ') + pass + '/' + (pass + fail)); process.exit(fail ? 1 : 0);
}
