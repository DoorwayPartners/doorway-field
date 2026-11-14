#!/usr/bin/env node
// Doorway Field — v2.4.4+ golden suite (field velocity): Prev / Next Door stepper, tap-to-copy address, Call / Text, header navigation,
// Today's Scoreboard, Follow-Ups queue, SOLD order + Copy GroupMe Order, roster-name sign-in + default campaign. Shared harness: field_harness.js.
const H = require('./field_harness.js');
const { ok, newPage, ready, tap, OWNER, api } = H;

(async () => {
  const L = await H.launch();
  try {
    console.log('Field velocity (v2.4.4)');
    const { context, page, errors } = await newPage(L.browser, L.base, { user: OWNER });
    await ready(page);
    await page.evaluate(() => { window.__copied = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__copied.push(t); } } }); });
    // a New door with a phone, and a second New door on the same street
    const pair = await page.evaluate(() => { const st = DF.cardplus.streetOf, a = DF.sync.all().filter(r => r.status_code === 'NEW' && r.phone && DF.map.visible(r));
      for (const r of a) { const b = a.find(x => x !== r && st(x) === st(r)); if (b) return [r.lead_id, b.lead_id]; } return [a[0].lead_id, null]; });
    await page.evaluate(id => { DF.map.jumpTo(id); DF.bus.emit('pin:selected', id); }, pair[0]); await page.waitForTimeout(300);
    const c1 = await page.evaluate(() => { const r = DF.sync.get(DF.card.current()), ph = r.phone.replace(/[^\d+]/g, '');
      return { nav: DF.$('#card-nav').getAttribute('href') === 'https://maps.google.com/?daddr=' + r.lat + ',' + r.lng, call: !DF.$('#card-call').hidden && DF.$('#card-call').getAttribute('href') === 'tel:' + ph,
        text: DF.$('#card-text').getAttribute('href') === 'sms:' + ph, prevOff: DF.$('#card-prev').disabled, score: !!DF.$('#card-score') }; });
    ok(c1.nav && c1.call && c1.text && c1.prevOff && c1.score, 'pin drawer: header navigation icon + 1-tap Call (tel:) / Text (sms:) when a phone is saved + scoreboard strip', c1);
    await page.click('#card-address'); await page.waitForTimeout(100);
    const cp = await page.evaluate(() => ({ copied: window.__copied.pop() || '', flash: DF.$('#card-address').classList.contains('copied'), addr: DF.$('#card-address').textContent }));
    ok(cp.copied === cp.addr && cp.flash, 'tap the address → copied to the clipboard with a "Copied" flash', cp);
    const s0 = await page.evaluate(() => DF.cardplus.score());
    await page.click('#lead-menu [data-code="NH1"]'); await page.waitForTimeout(150);
    const s1 = await page.evaluate(() => ({ s: DF.cardplus.score(), shown: DF.$('#sc-knocks').textContent }));
    await page.click('#sc-team'); const team = await page.evaluate(() => ({ label: DF.$('#sc-team').textContent, s: DF.cardplus.score() })); await page.click('#sc-team');
    ok(s1.s.knocks === s0.knocks + 1 && s1.shown === String(s1.s.knocks) && team.label === 'Team' && team.s.knocks >= s1.s.knocks, "Today's Scoreboard: a knock counts live (Knocks | Contacts | Sold), Me / Team toggle", [s0, s1, team]);
    const from = await page.evaluate(() => DF.card.current());
    await page.click('#card-next'); await page.waitForTimeout(300);
    const nx = await page.evaluate(from => { const cur = DF.card.current(), r = DF.sync.get(cur), f = DF.sync.get(from);
      return { cur, open: DF.$('#card').classList.contains('open'), isNew: r.status_code === 'NEW', same: DF.cardplus.streetOf(r) === DF.cardplus.streetOf(f), prevOn: !DF.$('#card-prev').disabled }; }, from);
    await page.click('#card-prev'); await page.waitForTimeout(200);
    const back = await page.evaluate(() => DF.card.current());
    ok(nx.cur !== from && nx.open && nx.isNew && (pair[1] ? nx.same : true) && nx.prevOn && back === from, 'Next Door → steps to the nearest unknocked New door on the same street without closing the drawer; ← Prev returns', nx);
    // SOLD order capture + Copy GroupMe Order
    await page.evaluate(id => DF.bus.emit('pin:selected', id), pair[1] || pair[0]);
    await page.click('#lead-menu [data-code="SOLD"]');
    const labels = await page.$$eval('#forms-fields span', s => s.map(x => x.textContent.replace(' *', '')).join('|'));
    const pre = await page.inputValue('#forms-fields input[name=phone]');
    await page.fill('#forms-fields input[name=speed_tier]', 'Fiber 2 Gig'); await page.fill('#forms-fields input[name=install_date]', '2026-11-20');
    await page.click('#forms-groupme'); const gm = await page.evaluate(() => window.__copied.pop() || '');
    await page.click('#forms-form button[type=submit]'); await page.waitForTimeout(150);
    const so = await page.evaluate(() => { const id = DF.card.current(), evs = DF.sync.events(id), f = evs.filter(e => e.type === 'sold_form').pop(), s = evs.filter(e => e.type === 'status' && e.to === 'SOLD').pop();
      return { ref: f && s && f.ref === s.event_id, tier: f && f.form.speed_tier, phone: f && f.form.phone, toast: DF.$('#toast-action').textContent }; });
    ok(labels === 'Customer Name|Phone|Speed Tier|Install Date' && /^207-555-01/.test(pre) && /SOLD/.test(gm) && /Fiber 2 Gig/.test(gm) && /2026-11-20/.test(gm) && so.ref && so.tier === 'Fiber 2 Gig' && so.toast === 'Copy GroupMe',
      'SOLD → 4-field order (Customer Name, Phone, Speed Tier, Install Date; phone pre-filled), saved with its SOLD knock event, Copy GroupMe Order', { labels, pre, gm: gm.slice(0, 80), so });
    await page.evaluate(() => DF.card.close());
    // Follow-Ups: APPT by time, then P GB / GB grouped by street + house number
    const fuIds = await page.evaluate(() => { const a = DF.sync.all().filter(r => r.status_code === 'NEW' && DF.inCampaign(r)).slice(-4).map(r => r.lead_id), t = Date.now();
      DF.card.dispose(a[0], 'APPT', { source: 'bulk', force: true }); DF.sync.mutate(a[0], { appt_at: new Date(t + 7200e3).toISOString() }, 'appt', { kind: 'appointment' });
      DF.card.dispose(a[1], 'APPT', { source: 'bulk', force: true }); DF.sync.mutate(a[1], { appt_at: new Date(t + 3600e3).toISOString() }, 'appt', { kind: 'appointment' });
      DF.card.dispose(a[2], 'GB', { source: 'bulk', force: true }); DF.card.dispose(a[3], 'P_GB', { source: 'bulk', force: true }); return a; });
    await page.click('.tab[data-tab=list]'); await page.click('#list-fu');
    const fu = await page.evaluate(ids => { const li = DF.$$('#followups li'), firstAppts = li.slice(0, 2).map(x => x.dataset.id);
      return { visible: !DF.$('#followups').hidden, apptOrder: firstAppts[0] === ids[1] && firstAppts[1] === ids[0], streets: DF.$$('#followups h4').length, nav: DF.$$('#followups .fu-nav').length === li.length,
        hasGb: [ids[2], ids[3]].every(id => !!DF.$('#followups li[data-id="' + id + '"]')), count: DF.$('#fu-count').textContent, n: li.length }; }, fuIds);
    await page.click('#followups li[data-id="' + fuIds[2] + '"] .fu-jump'); await page.waitForTimeout(700);
    const jumped = await page.evaluate(id => DF.currentTab === 'map' && DF.card.current() === id, fuIds[2]);
    ok(fu.visible && fu.apptOrder && fu.streets >= 1 && fu.nav && fu.hasGb && fu.count === String(fu.n) && jumped, 'Follow-Ups: APPT by appointment time, P GB / GB grouped by street, navigation on every row, 1-tap jump to the pin', fu);
    ok(!errors.length && !(await page.evaluate(() => window.__csp.length)), 'no page errors, zero CSP violations (v2.4.4 run)', errors.slice(0, 3));
    await context.close();

    console.log('Roster-name sign-in');
    const nm = await newPage(L.browser, L.base, { override: { ROSTER: [{ id: 'cristian-coy', name: 'Cristian Coy', role: 'Owner', team: 'Leadership', campaigns: ['*'], color: '#e31b23' },
      { id: 'manager-1', name: 'Manager 1', role: 'Manager', team: 'Team 1', campaigns: ['*'], color: '#2f80ed' },
      { id: 'agent-1', name: 'Rep Uno', role: 'Agent', team: 'Team 1', campaigns: ['Fidium'], defaultCampaign: 'Fidium', color: '#00a3a3' }] } });
    await nm.page.waitForSelector('#modal-signin.open');
    const opts = await nm.page.$$eval('#signin-name option', o => o.map(x => x.textContent + '=' + x.value).join('|'));
    const posts0 = api.posts;
    await nm.page.selectOption('#signin-name', 'agent-1'); await nm.page.fill('#signin-pin', '1357'); await nm.page.click('#signin-form button'); await ready(nm.page);
    await nm.page.waitForFunction(() => /synced/.test(DF.$('#sync-state').textContent), null, { timeout: 10000 }); const synced = api.posts > posts0;
    const st = await nm.page.evaluate(() => ({ id: DF.auth.id, camp: DF.campaign, pill: DF.$('#campaign-pill').textContent, sess: !!(DF.store.get('session') || {}).token }));
    ok(opts === 'Cristian Coy=cristian-coy|Rep Uno=agent-1|Other rep: enter Rep ID=__id' && st.id === 'agent-1' && st.camp === 'Fidium' && /Fidium/.test(st.pill) && st.sess && synced,
      'sign-in lists full roster names (placeholder seats hidden): tap name + PIN (server-checked) → default campaign + immediate authorized sync', { opts, st, synced });
    await nm.context.close();

    console.log('Stability (v2.4.5)');
    const hg = await newPage(L.browser, L.base, { user: OWNER, hang: /mt\d\.google\.com/ }); await ready(hg.page); const t0 = Date.now();
    await hg.page.waitForFunction(() => DF.map.base === 'esri' && DF.map.ready, null, { timeout: 9000 }).catch(() => {});
    const hgs = await hg.page.evaluate(() => ({ base: DF.map.base, t: (DF.map.instance.getStyle().sources.imagery || {}).tiles + '', label: DF.$('#pill-layers').textContent })), secs = (Date.now() - t0) / 1000;
    await hg.context.close();
    ok(hgs.base === 'esri' && /World_Imagery/.test(hgs.t) && hgs.label === 'Esri ▾' && secs < 5, 'Google tiles that never render (no error, no tile) → Esri within ~2.5 s: the canvas never stays blank white', { hgs, secs });
    const ep = await newPage(L.browser, L.base, { user: OWNER, noApi: true, env: { API_URL: 'https://api.test/exec' } }); await ready(ep.page);
    await ep.page.waitForFunction(() => /synced/.test(DF.$('#sync-state').textContent), null, { timeout: 10000 });
    const e1 = await ep.page.evaluate(() => ({ api: DF.cfg.API_URL, saved: localStorage.getItem('df.env_api') }));
    await ep.context.unroute('**/config.env.js'); await ep.context.route('**/config.env.js', r => r.fulfill({ status: 404, body: '' }));
    await ep.page.reload(); await ready(ep.page);
    await ep.page.waitForFunction(() => /synced/.test(DF.$('#sync-state').textContent), null, { timeout: 10000 }).catch(() => {});
    const e2 = await ep.page.evaluate(() => ({ api: DF.cfg.API_URL, state: DF.$('#sync-state').textContent }));
    const vis = v => ep.page.evaluate(x => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => x }); document.dispatchEvent(new Event('visibilitychange')); }, v);
    await vis('hidden'); const p1 = api.posts; await vis('visible'); await ep.page.waitForTimeout(700); const resumed = api.posts > p1;
    await ep.context.close();
    ok(e1.api === 'https://api.test/exec' && e1.saved === e1.api && e2.api === e1.api && /synced/.test(e2.state) && resumed,
      'config.env.js URL remembered: a missing / uncached env file (offline PWA, SW update) keeps the live Sync URL, never "local"; foreground resume pulls + pushes at once', { e1, e2, resumed });
  } finally { await L.close(); }
  process.exit(H.report() ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
