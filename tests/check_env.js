#!/usr/bin/env node
// Doorway Field — validates the persistent runtime file config.env.js (never in a drop zip; field_gate.sh copies it into the Pages repo).
// Allowed: window.DF_ENV = { API_URL, ORG_ID, BASEMAP, IMAGERY }. https Sync URL only; no roster, names or emails. Usage: node tests/check_env.js [file]
const fs = require('fs'), vm = require('vm');
const KEYS = ['API_URL', 'ORG_ID', 'BASEMAP', 'IMAGERY'];   // must equal ENV_KEYS in app/config.public.js (the scan checks)
function check(file) {
  const src = fs.readFileSync(file, 'utf8'), box = { window: {} }, errs = [];
  try { vm.runInNewContext(src, box, { timeout: 500 }); } catch (e) { return ['does not run: ' + e.message]; }
  const env = box.window.DF_ENV;
  if (!env || typeof env !== 'object' || Array.isArray(env)) return ['must set window.DF_ENV = { ... }'];
  Object.keys(env).forEach(k => { if (!KEYS.includes(k)) errs.push('key not allowed: ' + k); });
  if (env.API_URL && !/^https:\/\//.test(env.API_URL)) errs.push('API_URL must start with https://');
  if (process.argv.includes('--require-api') && !/^https:\/\/script\.google\.com\/.+\/exec$|^https:\/\/.+/.test(env.API_URL || '')) errs.push('API_URL is required (the live Field API /exec URL)');
  if (env.BASEMAP && !['google', 'esri'].includes(env.BASEMAP)) errs.push("BASEMAP must be 'google' or 'esri'");
  if (env.IMAGERY && !['esri', 'usgs'].includes(env.IMAGERY)) errs.push("IMAGERY must be 'esri' or 'usgs'");
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/.test(src)) errs.push('no email addresses');
  return errs;
}
module.exports = { check, KEYS };
if (require.main === module) {
  const errs = check(process.argv[2] || 'config.env.js');
  if (errs.length) { console.error('config.env.js rejected:\n  ' + errs.join('\n  ')); process.exit(1); }
  console.log('config.env.js OK');
}
