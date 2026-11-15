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
        text: DF.$('#card-text').getAttribute('href').startsWith('sms:' + ph + '?body='), prevOff: DF.$('#card-prev').disabled, score: !!DF.$('#card-score') }; });
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
    // ---- v2.5.1: black Sharpie lasso → Lasso Summary → Assign Leads (no outline left on the map) ----
    await page.evaluate(async () => { DF.card.close(); DF.showTab('map'); const f = DF.sync.all().find(r => r.campaign === 'Fidium');
      DF.map.instance.jumpTo({ center: [f.lng, f.lat], zoom: 17 }); await new Promise(r => setTimeout(r, 300)); });
    await page.click('#pill-lasso');
    const arm = await page.evaluate(() => ({ pink: DF.$('#pill-lasso').classList.contains('turf-draw'), badge: !DF.$('#turf-badge').hidden && /Draw turf with your finger/.test(DF.$('#turf-badge').textContent), pan: DF.map.instance.dragPan.isEnabled() }));
    const mc = await page.evaluate(() => { const b = DF.$('#map').getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2, Math.min(b.width, b.height) * 0.42]; });
    await page.mouse.move(mc[0] + mc[2], mc[1]); await page.mouse.down();
    for (let d = 0; d <= 400; d += 15) await page.mouse.move(mc[0] + mc[2] * Math.cos(d * Math.PI / 180), mc[1] + mc[2] * Math.sin(d * Math.PI / 180));   // overshoots the start (bowtie bait)
    const live = await page.evaluate(() => { const f = DF.map.instance.getSource('turf-draw')._data; return f && f.geometry ? f.geometry.coordinates.length : 0; });
    await page.mouse.up(); await page.waitForTimeout(300);
    const ts = await page.evaluate(() => { const m = DF.map.instance, f = m.getSource('turf-draw')._data, c = f.geometry ? f.geometry.coordinates : [], ids = DF.turflasso.ids(), o = DF.turflasso.summary(ids);
      return { open: DF.$('#turf-sheet').classList.contains('open'), n: ids.length, total: DF.$('#ts-total').textContent, sum: o.prospects + o.customers + o.other === o.total, by: DF.$('#ts-pros-by').textContent,
        closed: c.length > 3 && c[0][0] === c[c.length - 1][0], pan: m.dragPan.isEnabled(), ink: m.getPaintProperty('turf-draw', 'line-color'), w: m.getPaintProperty('turf-draw', 'line-width'),
        halo: m.getPaintProperty('turf-draw-halo', 'line-color') + '/' + m.getPaintProperty('turf-draw-halo', 'line-width'), unassign: Array.from(DF.$('#ts-rep').options).some(x => x.value === '' && x.text === 'Unassign') }; });
    const tw = await page.evaluate(() => DF.turflasso.untwist([[0, 0], [10, 0], [10, 10], [0, 10], [2, -3]]).length);   // tail crossing the first edge is cut
    await page.selectOption('#ts-rep', 'agent-2'); await page.click('#ts-assign'); await page.waitForTimeout(250);
    const sv = await page.evaluate(ids => ({ assigned: ids.every(id => DF.sync.get(id).assigned_rep_email === 'agent-2'), ring: ids.every(id => DF.map.ringOf(DF.sync.get(id)) === DF.roster.color('agent-2')),
      gone: !DF.map.instance.getSource('turf-draw')._data.geometry && !(DF.map.instance.getSource('lasso')._data.features || []).length, closed: !DF.$('#turf-sheet').classList.contains('open'),
      ev: DF.sync.events().filter(e => e.type === 'assign' && e.source === 'lasso').length }), ts.n ? await page.evaluate(() => DF.sync.all().filter(r => r.assigned_rep_email === 'agent-2').map(r => r.lead_id)) : []);
    ok(arm.pink && arm.badge && !arm.pan && live > 5 && ts.open && ts.n > 0 && ts.total === String(ts.n) && ts.sum && /^New \d+ · NH \d+ · GB \d+ · P GB \d+ · APPT \d+$/.test(ts.by) && ts.closed && ts.pan && ts.ink === '#09090b' && ts.w === 5 &&
      ts.halo === '#ffffff/9' && ts.unassign && tw === 4 && sv.assigned && sv.ring && sv.gone && sv.closed && sv.ev > 0,
      'Sharpie lasso: bold black line + white halo, overshoot untwisted, Lasso Summary (Total · Prospects · Customers · Other / NI) → Assign Leads recolours rings + clears the outline', { arm, live, ts, tw, sv });
    // ---- v2.5: 2-mode GPS ----
    await page.click('#pill-gps'); await page.waitForFunction(() => DF.gps.following && DF.gps.watching, null, { timeout: 8000 }); await page.waitForTimeout(700);
    const g1 = await page.evaluate(() => ({ cls: DF.$('#pill-gps').className, label: DF.$('#pill-gps').getAttribute('aria-label') }));
    await page.mouse.move(mc[0], mc[1]); await page.mouse.down(); await page.mouse.move(mc[0] + 80, mc[1] + 40, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
    const g2 = await page.evaluate(() => ({ following: DF.gps.following, watching: DF.gps.watching, cls: DF.$('#pill-gps').className }));
    await page.click('#pill-gps'); await page.waitForTimeout(300); const g3 = await page.evaluate(() => DF.gps.following); await page.evaluate(() => DF.gps.follow(false));
    ok(/gps-follow/.test(g1.cls) && g1.label === 'Following GPS' && !g2.following && g2.watching && /gps-live/.test(g2.cls) && g3, 'GPS: tap = watch + fly + Following GPS (blue); a pan unlocks the camera but the dot keeps updating; tap snaps back', { g1, g2, g3 });
    // ---- v2.5: Team & Logins ----
    await page.click('.tab[data-tab=admin]');
    const tm0 = await page.evaluate(() => ({ rows: DF.$$('#team-body tr').length, roster: DF.roster.all().length, form: !DF.$('#team-form').hidden, ownerInv: !DF.$('#team-body tr[data-id="cristian-coy"] .tm-inv') }));
    await page.fill('#tm-name', 'Rep Dos'); await page.selectOption('#tm-role', 'Agent'); await page.selectOption('#tm-camp', 'AT&T Fiber'); await page.fill('#tm-pin', '2468'); await page.click('#team-form button[type=submit]'); await page.waitForTimeout(250);
    const tm1 = await page.evaluate(() => { const r = DF.roster.get('rep-dos'), row = DF.$('#team-body tr[data-id="rep-dos"]'), ev = DF.sync.events().filter(e => e.type === 'roster').pop();
      return { pin: r && r.pin === DF.hash('rep-dos:2468'), dc: r && r.defaultCampaign, first: r && r.campaigns[0], row: row && row.textContent, ev: !!(ev && ev.roster.some(x => x.id === 'rep-dos' && x.pin)) }; });
    await page.click('#team-body tr[data-id="rep-dos"] .tm-inv'); await page.waitForFunction(() => /token=/.test(DF.$('#invite-out').value));
    const tm2 = await page.evaluate(() => ({ toast: DF.$('#toast-msg').textContent, copied: window.__copied.slice(-1)[0] || '' }));
    ok(tm0.rows === tm0.roster && tm0.form && tm0.ownerInv && tm1.pin && tm1.dc === 'AT&T Fiber' && tm1.first === 'AT&T Fiber' && /Rep Dos.*Agent.*AT&T Fiber.*Active · PIN set/.test(tm1.row) && tm1.ev && tm2.toast === 'Invite Link Copied!' && /\?token=/.test(tm2.copied),
      'Team & Logins: roster table + Add / Update Rep (role, default campaign, 4-digit PIN → Field API roster) + 1-tap Copy Invite Link', { tm0, tm1, tm2 });
    ok(!errors.length && !(await page.evaluate(() => window.__csp.length)), 'no page errors, zero CSP violations (v2.4.4 run)', errors.slice(0, 3));
    // ---- v2.5: zero-clear-data updater (last on this page: it reloads) ----
    await context.route(/version\.json/, r => r.fulfill({ json: { version: '9.9.9', build: 'test' } }));
    await page.evaluate(() => DF.pwa.checkVersion()); await page.waitForTimeout(150);
    const up0 = await page.evaluate(async () => { await (await caches.open('df-shell-old')).put('/stale.js', new Response('old')); await (await caches.open('df-tiles-keep')).put('/t.png', new Response('t'));
      return { text: DF.$('#update-text').textContent, shown: !DF.$('#update-banner').hidden, leads: DF.sync.count() }; });
    await context.unroute(/version\.json/);
    await Promise.all([page.waitForNavigation(), page.click('#update-banner')]); await ready(page);
    const up1 = await page.evaluate(async () => ({ keys: (await caches.keys()).join(), leads: DF.sync.count(), sess: !!(DF.store.get('session') || {}).token, banner: DF.$('#update-banner').hidden }));
    ok(up0.text === 'Update v9.9.9 Ready — Tap to Refresh' && up0.shown && !/df-shell-old/.test(up1.keys) && /df-tiles-keep/.test(up1.keys) && up1.leads === up0.leads && up1.sess && up1.banner,
      'auto-updater: version.json ≠ running build → top banner; tap = stale static caches dropped + reload, leads / session / tile cache kept', { up0, up1 });
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

    console.log('Sign-in prompt + GPS permission (v2.5)');
    const sp = await newPage(L.browser, L.base, { user: H.AGENT_A, noSession: true }); await sp.page.waitForSelector('#modal-signin.open', { timeout: 15000 });
    const sp0 = await sp.page.evaluate(() => ({ banner: !DF.$('#signin-banner').hidden && DF.$('#signin-banner').textContent, sel: DF.$('#signin-name').value }));
    await sp.page.fill('#signin-pin', '1357'); await sp.page.click('#signin-form button[type=submit]'); await ready(sp.page);
    const sp1 = await sp.page.evaluate(() => ({ id: DF.auth.id, sess: !!(DF.store.get('session') || {}).token })); await sp.context.close();
    ok(sp0.banner === 'Sign in to sync your turf & knocks' && sp0.sel === 'agent-1' && sp1.id === 'agent-1' && sp1.sess, 'no valid session on boot → "Who\'s knocking?" opens with the sync banner (rep preselected) → PIN → session', { sp0, sp1 });
    const ng = await newPage(L.browser, L.base, { user: OWNER, noGeo: true }); await ready(ng.page);
    await ng.page.click('#pill-gps'); await ng.page.waitForTimeout(800);
    const ngs = await ng.page.evaluate(() => ({ toast: DF.$('#toast-msg').textContent, following: DF.gps.following })); await ng.context.close();
    ok(ngs.toast === 'Enable Location permission in browser settings for GPS' && !ngs.following, 'GPS permission denied → clear non-blocking toast (no silent failure)', ngs);
    const ap = await newPage(L.browser, L.base, { user: OWNER }); await ready(ap.page);
    await ap.page.evaluate(() => { const g = navigator.geolocation, fake = (s, e, o) => { setTimeout(() => o && o.enableHighAccuracy ? e({ code: 2 }) : s({ coords: { latitude: 43.4501, longitude: -70.7602, accuracy: 900 } }), 40); return 7; };
      g.watchPosition = fake; g.getCurrentPosition = fake; g.clearWatch = () => {}; });
    await ap.page.click('#pill-gps'); await ap.page.waitForFunction(() => DF.gps.last(), null, { timeout: 8000 }); await ap.page.waitForTimeout(900);
    const aps = await ap.page.evaluate(() => { const c = DF.map.instance.getCenter(); return { coarse: DF.gps.coarse, following: DF.gps.following, d: Math.abs(c.lat - 43.4501) + Math.abs(c.lng + 70.7602) }; }); await ap.context.close();
    ok(aps.coarse && aps.following && aps.d < 0.001, 'approximate location: high-accuracy POSITION_UNAVAILABLE → low-accuracy retry still flies to the rep', aps);
    const ag = await newPage(L.browser, L.base, { user: H.AGENT_A }); await ready(ag.page);
    const ags = await ag.page.evaluate(async () => { const mine = r => DF.filters.repKey(r) === 'agent-1', inC = DF.sync.all().filter(r => DF.inCampaign(r)), v0 = DF.sync.all().filter(DF.map.visible), all = v0.every(mine);
      const t = inC.find(mine); DF.sync.mutate(t.lead_id, { assigned_rep_email: 'agent-2' }, 'assign'); DF.map.refresh(); DF.list.render && DF.list.render();
      const v1 = DF.sync.all().filter(DF.map.visible); return { all, n0: v0.length, n1: v1.length, gone: !v1.includes(t), rows: DF.$$('#list-body tr').length }; }); await ag.context.close();
    ok(ags.all && ags.n0 > 0 && ags.n1 === ags.n0 - 1 && ags.gone, 'Agent view isolation: map + list show only leads assigned to that Agent (reassigned lead disappears)', ags);

    console.log('Login form, rolling session, cache reset (v2.5.2)');
    const lf = await newPage(L.browser, L.base, { user: H.AGENT_A, noSession: true }); await lf.page.waitForSelector('#modal-signin.open', { timeout: 15000 });
    const lf0 = await lf.page.evaluate(() => { const u = DF.$('#signin-id'), p = DF.$('#signin-pin'), f = DF.$('#signin-form');
      return { form: f.tagName === 'FORM' && f.method === 'post', u: u.name + '/' + u.autocomplete + '/' + !DF.$('#signin-id-row').hidden + '/' + u.value, p: p.name + '/' + p.type + '/' + p.autocomplete,
        reset: !!f.querySelector('#signin-reset.btn-reset') && /Refresh App \/ Clear Cache/.test(DF.$('#signin-reset').textContent) }; });
    await lf.page.fill('#signin-pin', '1357'); await lf.page.click('#signin-form button[type=submit]'); await ready(lf.page);
    const lf1 = await lf.page.evaluate(async () => { const ls = DF.store.get('session'), idb = DF.sync.meta('session'); return { same: !!ls && !!idb && ls.token === idb.token, d: Math.round((ls.exp - Date.now()) / 864e5) }; });
    await lf.page.evaluate(() => localStorage.removeItem('df.session')); await lf.page.reload(); await ready(lf.page);   // localStorage lost, IndexedDB kept
    const lf2 = await lf.page.evaluate(() => ({ modal: DF.$('#modal-signin').classList.contains('open'), id: DF.auth.id, sess: !!DF.session() }));
    ok(lf0.form && lf0.u === 'username/username/true/agent-1' && lf0.p === 'password/password/current-password' && lf0.reset && lf1.same && lf1.d >= 29 && !lf2.modal && lf2.id === 'agent-1' && lf2.sess,
      'sign-in = semantic username + current-password form (autofill), Refresh App on the sheet; 30-day session kept in localStorage AND IndexedDB (survives a wiped localStorage)', { lf0, lf1, lf2 });
    const gid = await lf.page.evaluate(() => DF.sync.all().find(r => DF.map.visible(r)).lead_id); api.gone.push(gid);
    await lf.page.evaluate(async () => { const s = DF.store.get('session'); DF.store.set('session', { token: s.token, exp: Date.now() + 864e5 }); await DF.sync.flush(); });
    await lf.page.waitForFunction(id => !DF.sync.get(id), gid, { timeout: 5000 }).catch(() => {});
    const lf3 = await lf.page.evaluate(id => ({ gone: !DF.sync.get(id), noDelete: !DF.sync.outbox().some(e => e.type === 'delete'), d: Math.round((DF.store.get('session').exp - Date.now()) / 864e5), idb: Math.round((DF.sync.meta('session').exp - Date.now()) / 864e5) }), gid);
    ok(lf3.gone && lf3.noDelete && lf3.d >= 29 && lf3.idb >= 29, 'sync renews the session to 30 days (both stores); a lead the server reassigned away (gone) is dropped locally, no delete event', lf3);
    const cr0 = await lf.page.evaluate(async () => { await (await caches.open('df-shell-stale')).put('/x.js', new Response('x')); await (await caches.open('df-tiles-keep')).put('/t.png', new Response('t'));
      DF.$('#pill-filter').click(); return { n: DF.sync.count(), btn: !!DF.$('#filter-drawer #drawer-reset.btn-reset') }; });
    await Promise.all([lf.page.waitForNavigation(), lf.page.click('#drawer-reset')]); await ready(lf.page);
    const cr1 = await lf.page.evaluate(async () => ({ keys: (await caches.keys()).join(), n: DF.sync.count(), sess: !!DF.session(), id: DF.auth.id, url: location.search, outbox: DF.sync.queueSize() >= 0 })); await lf.context.close();
    ok(cr0.btn && !/df-shell-stale/.test(cr1.keys) && /df-tiles-keep/.test(cr1.keys) && cr1.n === cr0.n && cr1.sess && cr1.id === 'agent-1' && cr1.url === '',
      'Filters drawer › Refresh App / Clear Cache: stale shell caches gone, tiles + leads + session kept, cache-busted reload (?v= stripped)', { cr0, cr1 });

    console.log('Blitz Board, nudges, Text Customer (v2.6)');
    api.board = [{ rep: 'agent-1', knocks: 30, contacts: 9, sold: 2, streak: 12, best: 15 }];
    const bz = await newPage(L.browser, L.base, { user: OWNER }); await ready(bz.page);
    await bz.page.evaluate(() => { window.__copied = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__copied.push(t); } } }); });
    const ids = await bz.page.evaluate(() => DF.sync.all().filter(r => DF.map.visible(r) && r.status_code === 'NEW').slice(0, 4).map(r => r.lead_id));
    await tap(bz.page, ids[0], 'NH1'); await tap(bz.page, ids[1], 'GB'); await tap(bz.page, ids[2], 'NI'); await tap(bz.page, ids[3], 'P_GB');
    await bz.page.click('#sc-blitz'); await bz.page.waitForFunction(() => DF.$('#blitz-sheet').classList.contains('open') && DF.$$('#blitz-body tr').length === 2, null, { timeout: 8000 });
    await bz.page.click('#blitz-copy'); await bz.page.waitForFunction(() => window.__copied.length > 0);
    const b1 = await bz.page.evaluate(() => ({ rows: DF.$$('#blitz-body tr').map(t => Array.from(t.cells).map(c => c.textContent.trim()).join('|')), pill: DF.$('#sc-blitz').textContent, txt: window.__copied.slice(-1)[0], at: DF.$('#blitz-at').textContent, toast: DF.$('#toast-msg').textContent }));
    const t = b1.txt.split('\n');
    ok(b1.rows[0] === '1|Agent 1 🔥12|30|9|2' && b1.rows[1] === '2|Cristian Coy 🔥4|4|3|0' && b1.pill === '🔥 4' && /^Team as of/.test(b1.at) && /^⚡ Blitz Update · /.test(t[0]) &&
      t[1] === '1. Agent 1 — 30 knocks · 9 contacts · 2 sold 🔥12' && t[2] === '2. Cristian Coy — 4 knocks · 3 contacts · 0 sold 🔥4' && t[3] === 'Team: 34 knocks · 12 contacts · 2 sold' && /GroupMe/.test(b1.toast),
      'Blitz Board: team ranking from server aggregates + this phone\'s live counts, 🔥 knock streak on the card, 1-tap Copy Blitz Update for GroupMe', b1);
    await bz.page.evaluate(() => DF.closeModal('blitz-sheet'));
    const sm = await bz.page.evaluate(() => { const r = DF.sync.all().find(x => x.phone && DF.map.visible(x)); DF.bus.emit('pin:selected', r.lead_id); const h = DF.$('#card-text').getAttribute('href');
      return { h, body: decodeURIComponent(h.split('?body=')[1] || ''), num: h.startsWith('sms:' + r.phone.replace(/[^\d+]/g, '') + '?body='), label: DF.$('#card-text').getAttribute('aria-label'), camp: r.campaign }; });
    ok(sm.num && sm.label === 'Text Customer' && /^Hey \S+, swinging back through [A-Z][a-z]+.* today regarding \S.* fiber availability — let me know if you have 2 mins!$/.test(sm.body) && !/fiber fiber/i.test(sm.body),
      '1-tap Text Customer: sms: deep link pre-filled with the canvassing template (name, street, campaign)', sm);
    const nd = await bz.page.evaluate(id => { DF.card.close(); const d = new Date(); d.setHours(18, 0, 0, 0); const t18 = d.getTime(), t10 = d.setHours(10, 0, 0, 0);
      const ap = DF.sync.all().find(r => DF.map.visible(r) && r.status_code === 'NEW'); DF.sync.mutate(ap.lead_id, { status_code: 'APPT', appt_at: new Date(t18 + 30 * 6e4).toISOString() }, 'appt');
      const pg = DF.sync.get(id), b = (r, t) => DF.followups.badges(r, t).map(x => x[1]).join('+');
      DF.showTab('list'); DF.followups.toggle(true); DF.followups.render(t18);
      return { pg18: b(pg, t18), pg10: b(pg, t10), ap: b(DF.sync.get(ap.lead_id), t18), dom: DF.$$('#followups .nudge.n-due').length > 0, prime: DF.$$('#followups .nudge.n-prime').length,
        firstDue: !!DF.$('#followups .fu-list li .n-due'), sms: !!DF.$('#followups .fu-text') ? /\?body=Hey/.test(DF.$('#followups .fu-text').getAttribute('href')) : 'no-phone' }; }, ids[3]);
    await bz.context.close(); api.board = null;
    ok(nd.pg18 === 'Due Now+2nd Attempt' && nd.pg10 === 'Prime Window: 5–7 PM+2nd Attempt' && nd.ap === 'Due Now' && nd.dom && nd.firstDue && nd.sms !== false,
      'Follow-Ups nudges: Due Now (APPT within the hour, go-backs 5–7 PM), Prime Window: 5–7 PM, 2nd Attempt; Text Customer template on rows', nd);

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
