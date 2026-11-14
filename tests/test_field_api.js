#!/usr/bin/env node
// Doorway Field — golden suite for the server (server/FieldApi.gs) on the Apps Script mock: setup, PIN login + lockout, sessions, invite
// tokens (single use, never Owner), role checks per event type, idempotent sync, per-campaign lead visibility, revocation, hash parity with the client.
const path = require('path'), fs = require('fs'), crypto = require('crypto');
const { makeGas } = require('./gas_mock.js');
const ROOT = path.resolve(__dirname, '..'), SRV = path.join(ROOT, 'server', 'FieldApi.gs');
const APPJS = fs.existsSync(path.join(ROOT, 'app', 'app.js')) ? path.join(ROOT, 'app', 'app.js') : path.join(ROOT, 'app.js');
let pass = 0, fail = 0;
const ok = (c, name, info) => { if (c) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info).slice(0, 400) : '')); } };
const DFhash = eval('(' + /DF\.hash = (s => \{[\s\S]*?\});/.exec(fs.readFileSync(APPJS, 'utf8'))[1] + ')');   // the client's own PIN hash
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

console.log('Doorway Field API (server/FieldApi.gs on the Apps Script mock)');
const G = makeGas({ FIELD_EXPORTS_FOLDER_ID: 'folder-test', FIELD_OWNER_PIN: '2580' }); G.load(SRV);
const post = b => JSON.parse(G.ctx.doPost({ postData: { contents: typeof b === 'string' ? b : JSON.stringify(b) } }).getContent());
const tab = n => G.books[G.store.FIELD_DB_SHEET_ID]._sheets[n]._rows;
const ev = (o) => Object.assign({ event_id: 'E-' + crypto.randomUUID(), device_ts: new Date().toISOString() }, o);

G.ctx.fieldSetup();
const owner = tab('Roster')[1];
ok(G.store.FIELD_DB_SHEET_ID && Object.keys(G.books[G.store.FIELD_DB_SHEET_ID]._sheets).join() === 'Roster,Invites,Sessions,Events,Leads,Meta' && !('FIELD_OWNER_PIN' in G.store),
  'fieldSetup: Doorway_Field_DB in the exports folder, 6 tabs, FIELD_OWNER_PIN hashed then deleted');
ok(owner[0] === 'cristian-coy' && owner[2] === 'Owner' && owner[6] === DFhash('cristian-coy:2580') && G.ctx.faPinHash_('x:1') === DFhash('x:1'), 'server PIN hash == client DF.hash (parity)');
ok(JSON.parse(G.ctx.doGet().getContent()).version === G.ctx.FIELD_API_VERSION && post('{bad').error === 'bad_json', 'doGet health + bad JSON refused');
ok(post({ events: [ev({ type: 'status', lead_id: 'L1', patch: { status_code: 'NI' } })] }).error === 'auth' && post({ session: 'nope', events: [] }).error === 'auth', 'sync without a valid session → auth (nothing written)');

const bad = post({ action: 'pin_login', rep_id: 'cristian-coy', pin_hash: DFhash('cristian-coy:0000') }), own = post({ action: 'pin_login', rep_id: 'cristian-coy', pin_hash: DFhash('cristian-coy:2580') });
ok(bad.error === 'bad_pin' && own.ok && own.rep.role === 'Owner' && own.rep.repId === 'cristian-coy' && own.rep.pinHash === owner[6] && /^[0-9a-f]{64}$/.test(own.session), 'pin_login: wrong PIN refused; Owner gets a session + canonical profile');
ok(tab('Sessions').slice(1).every(r => r[0] !== own.session && /^[0-9a-f]{64}$/.test(r[0])), 'sessions stored as SHA-256 only');

const tok = crypto.randomBytes(16).toString('base64url'), h = sha(tok), exp = Date.now() + 7 * 864e5;
const s1 = post({ session: own.session, events: [
  ev({ type: 'roster', roster: [{ id: 'cristian-coy', name: 'Cristian Coy', role: 'Agent' }, { id: 'manager-1', name: 'Manager 1', role: 'Manager', campaigns: ['*'] },
    { id: 'agent-1', name: 'Agent 1', role: 'Agent', campaigns: ['Fidium'], color: '#00a3a3', pin: DFhash('agent-1:1357') }] }),
  ev({ type: 'invite', rep: 'agent-2', name: 'Agent 2', role: 'Agent', campaigns: ['Fidium', 'AT&T Fiber'], color: '#c9a227', h, exp }),
  ev({ type: 'invite', rep: 'boss', name: 'Boss', role: 'Owner', h: sha('x'), exp }),
  ev({ type: 'campaigns', campaigns: ['Fidium', 'AT&T Fiber', 'Frontier'] }),
  ev({ type: 'status', lead_id: 'L-FR', campaign: 'Frontier', patch: { campaign: 'Frontier', status_code: 'NH1' } })] });
ok(s1.ok && s1.accepted.length === 4 && s1.rejected.length === 1 && s1.roster.every(r => !('pin' in r) && !('pinHash' in r)) && s1.campaigns.length === 3,
  'Owner sync: roster + invite + campaigns + lead accepted; Owner-role invite rejected; roster returned WITHOUT PIN hashes', s1);
ok(tab('Roster').find(r => r[0] === 'cristian-coy')[2] === 'Owner' && tab('Invites').length === 2 && !JSON.stringify(tab('Invites')).includes(tok), 'Owner row can never be demoted; invite stored by hash only');

const forged = post({ action: 'redeem_invite', token_hash: sha('forged') }), red = post({ action: 'redeem_invite', token_hash: h }), again = post({ action: 'redeem_invite', token_hash: h });
ok(forged.error === 'invalid' && red.ok && red.rep.repId === 'agent-2' && red.rep.role === 'Agent' && red.rep.campaignAccess.join() === 'Fidium,AT&T Fiber' && red.session && again.error === 'invalid',
  'redeem_invite: forged → invalid; valid → canonical profile + session; second use → invalid (single use)', [forged, again]);
ok(tab('Invites')[1][11] && tab('Roster').some(r => r[0] === 'agent-2'), 'redeemed invite marked used; rep added to the authorized roster');

const a2 = red.session;
const s2 = post({ session: a2, events: [ev({ type: 'roster', roster: [] }), ev({ type: 'invite', rep: 'x', role: 'Agent', h: sha('y'), exp }), ev({ type: 'assign', lead_id: 'L-FR', patch: { assigned_rep_email: 'agent-2' } }),
  ev({ type: 'status', lead_id: 'L-FI', campaign: 'Fidium', patch: { campaign: 'Fidium', status_code: 'SOLD' } }), ev({ type: 'pin_set', pin_hash: DFhash('agent-2:8642') })] });
ok(s2.ok && s2.rejected.length === 3 && s2.accepted.length === 2, 'Agent session: roster / invite / assign rejected; own status + own PIN accepted', s2);
ok(s2.leads.map(l => l.lead_id).join() === 'L-FI' && post({ session: own.session, events: [] }).leads.length === 2, 'Agents only receive leads in their campaigns (Frontier lead hidden); Owner sees all');
const dup = ev({ type: 'note', lead_id: 'L-FI', patch: { rep_note: 'gate code' } }), n0 = tab('Events').length;
const d1 = post({ session: a2, events: [dup] }), d2 = post({ session: a2, events: [dup] });
ok(d1.accepted[0] === dup.event_id && d2.accepted[0] === dup.event_id && tab('Events').length === n0 + 1 && tab('Events')[n0][3] === 'agent-2', 'idempotent on event_id; events attributed to the session rep');
ok(post({ action: 'pin_login', rep_id: 'agent-2', pin_hash: DFhash('agent-2:8642') }).ok, 'pin_set → that rep can now sign in on any new phone with Rep ID + PIN');

for (let i = 0; i < 5; i++) post({ action: 'pin_login', rep_id: 'agent-1', pin_hash: DFhash('agent-1:000' + i) });
ok(post({ action: 'pin_login', rep_id: 'agent-1', pin_hash: DFhash('agent-1:1357') }).error === 'locked', '5 wrong PINs → locked for 15 minutes (even the right PIN)');
delete G.cache['pin:agent-1'];
ok(post({ action: 'pin_login', rep_id: 'agent-1', pin_hash: DFhash('agent-1:1357') }).ok && post({ action: 'pin_login', rep_id: 'manager-1', pin_hash: DFhash('manager-1:1234') }).error === 'bad_pin',
  'after the window: right PIN works; a rep with no PIN can never PIN-login (needs an invite)');
post({ session: own.session, events: [ev({ type: 'roster', roster: [{ id: 'agent-1', name: 'Agent 1', role: 'Agent', campaigns: ['Fidium'] }] })] });
ok(post({ session: a2, events: [] }).error === 'auth' && post({ action: 'pin_login', rep_id: 'agent-2', pin_hash: DFhash('agent-2:8642') }).error === 'bad_pin' &&
  tab('Roster').find(r => r[0] === 'agent-1')[6] === DFhash('agent-1:1357'), 'removing a rep from the roster revokes their session + PIN login; kept reps keep their PIN hash');

console.log('\n' + (fail ? 'FAIL' : 'PASS') + ' ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
