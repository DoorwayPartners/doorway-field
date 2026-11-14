// Doorway Field — minimal Apps Script runtime mock (Node vm) for server/FieldApi.gs: SpreadsheetApp, DriveApp, PropertiesService, CacheService,
// LockService, ContentService, Utilities, Logger. In-memory only; just the API surface FieldApi.gs uses.
const crypto = require('crypto'), vm = require('vm'), fs = require('fs');
function makeSheet(name) {
  const rows = [];
  return {
    _rows: rows, getName: () => name, getLastRow: () => rows.length, appendRow: v => { rows.push(v.slice()); },
    getRange: (r, c, nr, nc) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => ((rows[r - 1 + i] || [])[c - 1 + j] ?? ''))),
      setValues: vals => vals.forEach((v, i) => { const row = rows[r - 1 + i] || (rows[r - 1 + i] = []); v.forEach((x, j) => { row[c - 1 + j] = x; }); })
    })
  };
}
function makeGas(props) {
  const books = {}, cache = {}, store = Object.assign({}, props || {});
  let n = 0;
  const book = id => { const sheets = {}; return books[id] = { getId: () => id, _sheets: sheets, getSheetByName: s => sheets[s] || null, insertSheet: s => (sheets[s] = makeSheet(s)) }; };
  const ctx = {
    console, Logger: { log: () => {} },
    SpreadsheetApp: { openById: id => { if (!books[id]) throw new Error('no sheet ' + id); return books[id]; }, create: () => book('sheet-' + (++n)) },
    DriveApp: { getFileById: () => ({ moveTo: f => f }), getFolderById: id => ({ id }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in store ? store[k] : null), setProperty: (k, v) => { store[k] = String(v); }, deleteProperty: k => { delete store[k]; } }) },
    CacheService: { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ _s: s, setMimeType() { return this; }, getContent() { return this._s; } }) },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(String(s), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)) }
  };
  vm.createContext(ctx);
  return { ctx, books, cache, store, load: file => vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file }) };
}
module.exports = { makeGas };
