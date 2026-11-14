#!/usr/bin/env node
// Doorway Field — core golden suite (v2.0) on Brookline_Sanford_50: guardrails, schema v2, map + card, offline sync, list, CSV import.
// Run: node tests/test_doorway_field.js   (exit 0 = PASS). v2 features live in tests/test_field_v2.js. Shared harness: tests/field_harness.js.
const fs = require('fs'), path = require('path');
const H = require('./field_harness.js');
const { ok, fixture, api, apiHandle, newPage, ready, idle, tap, OWNER, AGENT_A, APP, ROOT } = H;
const SR19 = ['Assigned to (email)', 'Assigned to (name)', 'Status', 'Business Name', 'First Name', 'Last Name', 'Phone', 'Email', 'Address', 'Apt/Suite', 'City', 'State/Region', 'Postal Code', 'Country', 'Latitude', 'Longitude', 'Notes', 'Appointment', 'Date Created'];
const MENU = ['NEW', 'NH1', 'NH2', 'NH3', 'GB', 'P_GB', 'SOLD', 'NI', 'APPT', 'PVL'];

const guardrails = () => require('./scan_secrets_csp.js').scan(ok);

(async () => {
  guardrails();
  const L = await H.launch();
  try {
    console.log('Owner on iPhone 13');
    const { context, page, errors } = await newPage(L.browser, L.base, { user: OWNER });
    await ready(page);
    const rows = await page.evaluate(() => ({ fields: DF.sync.FIELDS, rows: DF.sync.all() }));
    ok(rows.rows.length === 50, '50 pins imported into IndexedDB', rows.rows.length);
    ok(rows.fields.length === 22 && rows.fields[0] === 'org_id' && rows.fields[1] === 'campaign' && rows.rows.every(r => Object.keys(r).join() === rows.fields.join()), 'schema v2: org_id + campaign + 19 fields + created_at, in order, on every row');
    ok(rows.rows.every(r => r.org_id === 'doorway' && /^DL-[0-9a-f]{16}$/.test(r.lead_id) && /^\d{5}$/.test(r.zip) && r.state === 'ME' && r.created_at), 'org_id = doorway, lead_id = DL-+16 hex, zip/state normalised, created_at set');
    const core = path.join(ROOT, '..', '_Shared_Core', 'Doorway_Core.gs');
    if (fs.existsSync(core)) {
      const DC = new Function(fs.readFileSync(core, 'utf8') + '\nreturn DoorwayCore;')(), p = fixture.pins[3];
      ok(await page.evaluate(q => DF.sync.leadId(q.address, q.apt, q.zip), p) === 'DL-' + DC.hash_([p.address, p.apt, p.zip].join('|')), 'lead_id hash matches _Shared_Core DoorwayCore.hash_');
    }
    const cl = await page.evaluate(async () => {
      const m = DF.map.instance; m.jumpTo({ center: [-70.7755, 43.4380], zoom: 11 }); await new Promise(r => m.once('idle', r));
      const c = m.querySourceFeatures('leads').filter(f => f.properties.cluster), drawn = m.queryRenderedFeatures({ layers: ['clusters'] }).length, clImgs = m.listImages().filter(i => /^cl-/.test(i));
      m.jumpTo({ center: [-70.7745, 43.4380], zoom: 12.6 }); await new Promise(r => m.once('idle', r));
      return { max: Math.max(0, ...c.map(f => f.properties.point_count)), n: c.length, drawn, hi: m.querySourceFeatures('leads').filter(f => f.properties.cluster).length,
        pins: m.queryRenderedFeatures({ layers: ['pins'] }).length, cfg: DF.map.CLUSTER, label: m.getLayoutProperty('clusters', 'icon-image'), radius: [2, 5, 15, 75, 400].map(DF.map.clusterRadius), clImgs,
        icons: m.listImages().filter(i => /^pin-[A-Z0-9_]+\|#[0-9a-f]{6}$/i.test(i)).length, size: JSON.stringify(m.getLayoutProperty('pins', 'icon-size')), ring: m.getLayer('pin-stack').type };
    });
    ok(cl.n >= 1 && cl.max >= 15 && cl.drawn >= 1, 'town zoom 11: numbered cluster bubbles, no font download (largest ≥ 15)', cl);
    ok(cl.hi === 0 && cl.pins > 10 && cl.cfg.maxZoom === 11 && cl.cfg.radius === 24, 'zoom 12+: individual circular pins (24 px clustering at town zoom)', cl);
    ok(JSON.stringify(cl.label).includes('1k+') && !JSON.stringify(cl.label).includes('75+') && cl.radius.every(r => r === 17) && cl.clImgs.some(i => i.endsWith('-' + cl.max)), 'clusters: one 34 px badge with the EXACT count (1k+ only at 1000+)', cl.clImgs);
    ok(cl.icons >= 1 && cl.size === JSON.stringify(['step', ['zoom'], 32 / 34, 15, 1]) && cl.ring === 'circle', '34 px dual-ring pin images (32 px below zoom 15) + stacked-disc edge layer', cl);
    ok((await page.$$eval('#lead-menu .dispo', b => b.map(x => x.dataset.code))).join() === MENU.join(), 'Lead Menu = the 10 menu codes, in order');
    const attr = await page.evaluate(() => DF.$('.maplibregl-ctrl-attrib').textContent);
    ok(/Google/.test(attr), 'attribution badge visible (Map data © Google)', attr);
    const target = rows.rows.find(r => r.status_code === 'NEW' && r.turf_id === 'BROOKLINE-A');
    await page.evaluate(id => DF.map.jumpTo(id), target.lead_id); await idle(page);
    const pt = await page.evaluate(id => { const r = DF.sync.get(id), p = DF.map.instance.project([r.lng, r.lat]), b = DF.$('#map').getBoundingClientRect(); return { x: b.left + p.x, y: b.top + p.y }; }, target.lead_id);
    await page.evaluate(() => DF.card.close()); await page.waitForTimeout(300); await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(250);
    const opened = await page.evaluate(() => ({ cur: DF.card.current(), ms: DF.lastCardMs, open: DF.$('#card').classList.contains('open') }));
    ok(opened.open && opened.cur === target.lead_id && opened.ms < 100, 'tap on a circular pin opens the card < 100 ms', opened);
    await page.waitForTimeout(250); const gap = await page.evaluate(() => DF.$('#card').getBoundingClientRect().top - DF.$('#pill-gps').getBoundingClientRect().bottom);
    ok(gap > 0, 'open card never covers the map pills on iPhone 13 (390 × 664)', gap);
    await page.click('#lead-menu [data-code="NI"]');
    const flip = await page.evaluate(id => ({ ms: DF.lastFlipMs, st: DF.sync.get(id).status_code, chip: DF.$('#card-status').textContent }), target.lead_id);
    ok(flip.ms < 30 && flip.st === 'NI' && flip.chip === 'Not Interested', 'Lead Menu tap flips the pin < 30 ms (optimistic)', flip);
    await idle(page);
    const onMap = await page.evaluate(id => DF.map.instance.querySourceFeatures('leads', { filter: ['==', ['get', 'lead_id'], id] }).map(f => f.properties.status_code), target.lead_id);
    ok(onMap.length && onMap.every(s => s === 'NI'), 'map source shows the new status (diff update)', onMap);
    await page.click('#toast-action');
    ok(await page.evaluate(id => DF.sync.get(id).status_code, target.lead_id) === 'NEW', '5 s Undo restores the previous status');
    await page.click('#lead-menu [data-code="SOLD"]');
    ok((await page.$$eval('#forms-fields span', s => s.map(x => x.textContent.replace(' *', '')))).join('|') === 'Customer Name|Speed Tier|Phone / Email|Install Date', 'SOLD opens the 4-field Forms (Customer Name, Speed Tier, Phone / Email, Install Date)');
    await page.fill('#forms-fields input[name=phone_email]', '207-555-0199'); await page.fill('#forms-fields input[name=speed_tier]', 'Fiber 1 Gig'); await page.click('#forms-form button[type=submit]');
    const sold = await page.evaluate(id => DF.sync.events(id).find(e => e.type === 'sold_form'), target.lead_id);
    ok(sold && sold.form.speed_tier === 'Fiber 1 Gig' && sold.form.customer_name && sold.campaign === 'Fidium', 'SOLD order saved to the event log with campaign', sold && sold.form);
    await page.click('#card-cb-btn'); await page.fill('#appt-input', '2026-11-20T18:30'); await page.click('#appt-form button[type=submit]');
    const cb = await page.evaluate(id => ({ at: DF.sync.get(id).appt_at, ev: DF.sync.events(id).filter(e => e.type === 'appt').pop() }), target.lead_id);
    ok(/^2026-11-2\dT/.test(cb.at) && cb.ev.kind === 'callback', 'Callback scheduler sets appt_at + logs a callback event', cb);
    await page.fill('#card-note', 'Spoke to owner, likes 1 Gig'); await page.click('#card-note-form button');
    await page.click('#card-details'); await page.click('.dtab[data-dtab=notes]');
    ok((await page.textContent('#details-body')).includes('likes 1 Gig'), 'Details › Notes shows the timestamped note');
    await page.click('[data-close=details]');
    await page.waitForFunction(() => DF.sync.queueSize() === 0, null, { timeout: 20000 });
    const before = api.events.size; await context.setOffline(true);
    const ten = rows.rows.filter(r => r.status_code === 'NEW' && r.lead_id !== target.lead_id).slice(0, 10).map(r => r.lead_id);
    const codes = ['NH1', 'NH2', 'NH3', 'GB', 'P_GB', 'NI', 'APPT', 'PVL', 'NH1', 'SOLD'];
    for (let i = 0; i < 10; i++) { await tap(page, ten[i], codes[i]); if (codes[i] === 'SOLD') await page.click('[data-close=modal-forms]'); if (codes[i] === 'APPT') await page.click('[data-close=modal-appt]'); }
    await page.waitForTimeout(2200);
    const offQ = await page.evaluate(() => DF.sync.outbox().filter(e => e.type === 'status').length);
    ok(offQ === 10 && api.events.size === before, 'offline: 10 status taps queued in the IndexedDB outbox, nothing sent', { offQ, sent: api.events.size - before });
    await context.setOffline(false);
    await page.waitForFunction(() => DF.sync.queueSize() === 0, null, { timeout: 20000 });
    const local = await page.evaluate(ids => ids.map(id => DF.sync.get(id).status_code), ten);
    ok(ten.every((id, i) => api.leads.get(id).status_code === local[i]), 'reconnect: outbox flushed, server state equals local');
    const n0 = api.events.size; apiHandle({ events: Array.from(api.events.values()).slice(-10) });
    ok(api.events.size === n0, 'server replay is idempotent on event_id');
    const [mA, mB] = rows.rows.filter(r => r.status_code === 'NEW' && !ten.includes(r.lead_id) && r.lead_id !== target.lead_id).map(r => r.lead_id);
    api.reject.add(mB); await tap(page, mB, 'GB');
    api.extra.push(Object.assign({}, rows.rows.find(r => r.lead_id === mA), { status_code: 'CST', updated_at: '2099-01-01T00:00:00.000Z' }), Object.assign({}, rows.rows.find(r => r.lead_id === mB), { status_code: 'NI', updated_at: '2099-01-01T00:00:00.000Z' }));
    await page.evaluate(() => DF.sync.flush()); await page.waitForTimeout(400);
    const merged = await page.evaluate(([a, b]) => [DF.sync.get(a).status_code, DF.sync.get(b).status_code], [mA, mB]);
    ok(merged[0] === 'CST' && merged[1] === 'GB', 'merge: newer server row wins; lead with a pending local tap keeps local', merged);
    api.reject.clear();
    await page.reload(); await ready(page);
    const kept = await page.evaluate(ids => ids.map(id => (DF.sync.get(id) || {}).status_code), ten);
    ok(kept.join() === local.join() && await page.evaluate(() => DF.sync.count()) === 50, 'reload: statuses survive in IndexedDB (fixture not re-imported)');
    const near = fixture.pins[40]; await context.setGeolocation({ latitude: near.lat, longitude: near.lng });
    await page.click('.tab[data-tab=list]'); await page.waitForTimeout(700);
    const first = await page.getAttribute('#list-body tr:first-child', 'data-id'), nearId = await page.evaluate(p => DF.sync.leadId(p.address, p.apt, p.zip), near);
    ok(first === nearId, 'List sorted nearest-first from GPS', { first, nearId });
    await page.click('#list-body tr:first-child .jump'); await page.waitForTimeout(300);
    ok(await page.evaluate(id => DF.currentTab === 'map' && DF.card.current() === id, nearId), '1-tap Jump to Pin opens the map + card');
    for (const m of ['satellite', 'street', 'hybrid']) {
      await page.click('#pill-layers'); await page.click('.mode-card[data-mode=' + m + ']');
      await page.waitForFunction(x => DF.map.ready && DF.map.mode === x, m, { timeout: 15000 });
      const s = await page.evaluate(() => { const st = DF.map.instance.getStyle(); return { tiles: st.sources.imagery ? st.sources.imagery.tiles[0] : '', leads: !!st.sources.leads, ring: !!DF.map.instance.getLayer('pin-stack') }; });
      ok(s.tiles.includes('google.com/vt/lyrs=' + { street: 'm', satellite: 's', hybrid: 'y' }[m] + '&') && s.leads && s.ring, 'Map Settings › ' + m + ' = Google lyrs=' + { street: 'm', satellite: 's', hybrid: 'y' }[m] + ' (pins + rings re-added)', s);
    }
    await page.click('#pill-gps'); ok(await page.evaluate(() => DF.tools.following), 'Recenter GPS starts Follow Me');
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    ok(!(await page.evaluate(() => DF.tools.following)), 'Follow Me stops when the app is hidden (no background GPS)');
    await page.evaluate(() => { delete document.visibilityState; });
    // ---- Admin: CSV importer ----
    ok(await page.isVisible('#tab-admin'), 'Admin tab visible to the Owner');
    await page.click('.tab[data-tab=admin]');
    const drop = async (name, text) => { await page.setInputFiles('#csv-input', { name, mimeType: 'text/csv', buffer: Buffer.from(text) }); await page.waitForSelector('#import-preview:not([hidden])'); };
    const pv = () => page.evaluate(() => DF.imports.renderPreview());
    const p0 = fixture.pins[0];
    await drop('tool1_export.csv', ['Street Address,Unit,City,State,Zip Code,Latitude,Longitude,First,Phone,Lead Type', '201 BROOK ST,,SANFORD,ME,04073,43.43301,-70.76802,Ari,207-555-0150,PROSPECT',
      '205 BROOK ST,,SANFORD,ME,4073,43.43315,-70.76790,Bo,207-555-0151,PROSPECT', '209 BROOK ST,,SANFORD,ME,04073,43.43329,-70.76778,Cy,,CCI_PROSPECT', '"213 BROOK ST, REAR",,SANFORD,ME,04073,43.43343,-70.76766,,,CUSTOMER',
      '217 BROOK ST,APT 1,SANFORD,ME,04073,43.43357,-70.76754,Ed,,PROSPECT', [p0.address, p0.apt, 'SANFORD', 'ME', p0.zip, p0.lat, p0.lng, 'Dup', '', 'PROSPECT'].join(','),
      '99 NOWHERE LN,,SANFORD,ME,04073,,,Nog,,PROSPECT', '3 ELM ST,,SANFORD,ME,04073,43.4412,-70.7751,Mo,,MISS', '7 MAIN ST,,SANFORD,ME,04073,43.4401,-70.7739,Dee,,DNC'].join('\r\n'));
    const pre = await pv();
    ok(pre.all === 9 && pre.valid === 6 && pre.invalid === 3 && /Unassigned/.test(await page.textContent('#pv-body')) && await page.evaluate(() => DF.sync.count()) === 50, 'preview: 9 | 6 | 3, blank rep = Unassigned, nothing written yet', pre);
    await page.click('#pv-tab-invalid'); const inv = await page.$$eval('#pv-body tr', t => t.map(r => r.querySelector('.issues').textContent));
    ok(inv.length === 3 && inv.some(x => /Latitude\/Longitude/.test(x)) && inv.some(x => /DNC/.test(x)) && inv.some(x => /unknown status MISS/.test(x)), 'Invalid tab: no-GPS, DNC, retired MISS', inv);
    await page.click('#pv-submit'); await page.waitForTimeout(300);
    ok(/5 added · 1 updated · 3 invalid/.test(await page.textContent('#import-report')), 'Submit commits valid pins only: 5 added, 1 dedupe update');
    ok(await page.evaluate(id => DF.sync.get(id).turf_id, rows.rows[0].lead_id) === 'BROOKLINE-A' && await page.evaluate(() => DF.sync.all().filter(r => /BROOK ST/.test(r.address)).map(r => r.status_code).sort().join()) === 'CCI,CST,NEW,NEW,NEW', 'dedupe keeps turf; Tool #1 lead_type mapped');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#sample-csv')]);
    const sample = fs.readFileSync(await dl.path(), 'utf8');
    ok(dl.suggestedFilename() === 'Doorway_Lead_Import_Sample.csv' && sample.split('\r\n')[0] === SR19.join(','), 'Download Sample CSV = the exact 19 SalesRabbit headers');
    await drop('SalesRabbit Export.csv', sample.trimEnd() + '\r\n' + ['alex.rivera@example.com,Alex Rivera,Sold,,Gray,Hollis,207-555-0110,,77 OAK ST,UNIT 3B,SANFORD,me,4073,United States,43.4405,-70.7790,,11/21/2026 6:30 PM,11/14/2026',
      ',,New,,No,Rep,,,81 OAK ST,,SANFORD,ME,04073,US,43.4406,-70.7791,,,', 'jordan.lee@example.com,Jordan Lee,New,,Bad,Coords,,,85 OAK ST,,SANFORD,ME,04073,US,95.1,-70.7792,,,',
      'jordan.lee@example.com,Jordan Lee,New,,Can,Ada,,,89 OAK ST,,SANFORD,ME,04073,Canada,43.4408,-70.7793,,,', 'jordan.lee@example.com,Jordan Lee,New,,Bad,Date,,,93 OAK ST,,SANFORD,ME,04073,US,43.4409,-70.7794,,,not-a-date'].join('\r\n'));
    const m = await page.evaluate(() => { const p = DF.imports.pending(), by = a => p.rows.find(r => r.raw.address === a).lead; return { sr: p.salesrabbit, map: p.map, apt: by('22 SCHOOL ST'), oak: by('77 OAK ST'), diner: by('56 RIVERSIDE AVE'), c: DF.imports.renderPreview() }; });
    ok(m.sr && ['apt', 'state', 'zip', '_country', 'appt_at', '_created'].every(f => m.map[f] !== undefined), '19-column header map 1:1 (Apt/Suite, State/Region, Postal Code, Country, Appointment, Date Created)');
    ok(m.apt.apt === 'APT 2' && m.apt.assigned_rep_email === AGENT_A && m.oak.state === 'ME' && m.oak.zip === '04073' && m.oak.status_code === 'SOLD' && /^2026-11-2[12]T/.test(m.oak.appt_at) && m.oak.assigned_rep_email === 'alex.rivera@example.com',
      'Apt/Suite, State/Region, Postal Code, Status label, US Appointment parsed; roster name → roster id, external email kept', [m.apt.assigned_rep_email, m.oak.assigned_rep_email]);
    ok(m.diner.rep_note === 'Owner back Tuesday · Business: Riverside Diner' && m.c.all === 10 && m.c.valid === 7 && m.c.invalid === 3, 'Business Name kept in notes; SalesRabbit preview 10 | 7 | 3', m.c);
    await page.click('#pv-submit'); await page.waitForTimeout(300);
    const imp = await page.evaluate(() => ['14 MAIN ST', '22 SCHOOL ST', '38 MAIN ST', '56 RIVERSIDE AVE', '9 MAPLE ST', '77 OAK ST', '81 OAK ST'].map(a => DF.sync.all().find(r => r.address === a)).filter(Boolean));
    ok(imp.length === 7 && imp.every(r => r.org_id === 'doorway' && r.campaign && /^DL-/.test(r.lead_id) && r.updated_at && Object.keys(r).length === 22) && imp.filter(r => /^IMP-\d{8}-SALESRABBIT-EXPORT$/.test(r.turf_id)).length === 5,
      'org_id, campaign, lead_id, updated_at stamped on all 7; turf_id auto-stamped on the 5 new pins', imp.map(r => r.turf_id));
    await drop('partner_reps.csv', SR19.join(',') + '\r\n' + ['pat.kim@partner-sales.example,Pat Kim,New,,A,One,,,101 PINE ST,,SANFORD,ME,04073,US,43.4501,-70.7601,,,', ',Sam Ortiz,NH1,,B,Two,,,105 PINE ST,,SANFORD,ME,04073,US,43.4502,-70.7602,,,',
      'NOT-AN-EMAIL,,New,,C,Three,,,,,SANFORD,ME,04073,US,43.4503,-70.7603,,,', 'pat.kim@partner-sales.example,Pat Kim,New,,D,Four,,,113 PINE ST,,SANFORD,ME,04073,US,,,,,'].join('\r\n'));
    const ext = await page.evaluate(() => { const p = DF.imports.pending(); return { c: DF.imports.renderPreview(), rows: p.rows.map(r => [r.ok, r.lead.assigned_rep_email, r.lead.address, r.errors.join()]), pick: Array.from(DF.$$('#pv-assign option')).map(o => o.textContent) }; });
    ok(ext.c.valid === 3 && ext.c.invalid === 1 && ext.rows[0][1] === 'pat.kim@partner-sales.example' && ext.rows[1][1] === '' && ext.rows[2][2] === 'Pin 43.4503, -70.7603' && /needs Latitude\/Longitude/.test(ext.rows[3][3]), 'external / blank reps Valid; coordinates-only pin labelled; address-only needs coordinates', ext.rows);
    ok(ext.pick.includes('Cristian Coy (Owner)') && ext.pick.includes('pat.kim@partner-sales.example'), 'rep picker = roster + CSV reps (no emails in source)', ext.pick);
    await page.click('#pv-submit'); await page.waitForTimeout(300);
    const hist = await page.$$eval('#imports-body tr', t => t.map(r => Array.from(r.cells).map(c => c.textContent)));
    ok(hist.length === 3 && hist[1][2].startsWith('SalesRabbit Export.csv') && hist[1][0] === 'Completed with errors' && hist[1].slice(4, 7).join() === '7,10,7' && hist[0][3] === 'Cristian Coy', 'Imports table: Status, Created, File Name, Imported By, Valid / Total Submitted / Total Processed', hist.map(h => h.slice(0, 7)));
    const csp = await page.evaluate(() => window.__csp);
    ok(!errors.length && !csp.length, 'no page errors, zero CSP violations (owner run)', { errors: errors.slice(0, 3), csp: csp.slice(0, 3) });
    await context.close();

    console.log('Agent on Pixel 7 (fresh device, roster sign-in)');
    const r = await newPage(L.browser, L.base, { device: 'Pixel 7' });
    await r.page.waitForSelector('#modal-signin.open'); await r.page.selectOption('#signin-name', AGENT_A); await r.page.click('#signin-form button');
    await ready(r.page);
    ok(!(await r.page.isVisible('#tab-admin')) && await r.page.evaluate(() => DF.auth.role === 'Agent'), 'roster sign-in as Agent; Admin hidden');
    ok(await r.page.evaluate(async () => { DF.showTab('admin'); return DF.currentTab === 'map' && (await DF.imports.preview('address,lat,lng\n1 X,43,-70', 'x.csv')) === null; }), 'Agent cannot open Admin or import (UI gate; API re-checks)');
    const rid = await r.page.evaluate(() => DF.sync.all().find(x => DF.map.visible(x)).lead_id); await tap(r.page, rid, 'NH1');
    ok(await r.page.evaluate(() => DF.lastFlipMs) < 30, 'Android: flip < 30 ms');
    ok(!r.errors.length && !(await r.page.evaluate(() => window.__csp.length)), 'no page errors, zero CSP violations (agent run)', r.errors.slice(0, 3));
    await r.context.close();
  } finally { await L.close(); }
  process.exit(H.report() ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
