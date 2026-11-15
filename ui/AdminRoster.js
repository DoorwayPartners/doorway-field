// Doorway Field v2.5 — AdminRoster: Admin › "Team & Logins" (Owner + Manager view). Active reps with role, default campaign and login status.
// Owner: + Add / Update Rep (full name, Agent | Manager, default campaign, 4-digit PIN) → device roster + the Field API roster event (PIN as hash),
// and 1-tap Copy Invite Link on each rep. The Field API accepts roster / invite changes from the Owner only.
(function () {
  'use strict';
  const DF = window.DF;
  const $ = s => DF.$(s);
  const PAL = ['#00a3a3', '#c9a227', '#9b51e0', '#f2994a', '#2f80ed', '#ff5fa2', '#1e8e3e'];
  const status = r => r.pin ? 'Active · PIN set' : r.invite && r.invite.exp > Date.now() ? 'Invite sent' : 'Needs PIN or invite';
  const defCamp = r => r.role !== 'Agent' || (r.campaigns || []).includes('*') ? 'All' : DF.defaultCampaign(r);

  function render() {
    const owner = DF.isOwner(), reps = DF.roster.all().slice().sort((a, b) => (a.role === 'Owner' ? -1 : b.role === 'Owner' ? 1 : a.name.localeCompare(b.name)));
    $('#team-body').innerHTML = reps.map(r => '<tr data-id="' + DF.esc(r.id) + '"><td><i class="dot rc-' + DF.esc(r.id) + '"></i>' + DF.esc(r.name) + '</td><td>' + DF.esc(r.role) + '</td><td>' + DF.esc(defCamp(r)) +
      '</td><td>' + DF.esc(r.role === 'Owner' ? 'Owner' : status(r)) + '</td><td>' + (owner && r.role !== 'Owner' ? '<button type="button" class="btn tm-inv">Copy Invite Link</button>' : '') + '</td></tr>').join('');
    DF.$$('#team-body .tm-inv').forEach(b => b.addEventListener('click', () => DF.admin.copyInvite(b.closest('tr').dataset.id)));
    $('#tm-camp').innerHTML = '<option value="*">All</option>' + DF.campaigns().map(c => '<option>' + DF.esc(c) + '</option>').join('');
    $('#team-form').hidden = !owner;
    return reps.length;
  }
  async function save(e) {
    if (e) e.preventDefault();
    if (!DF.isOwner()) return null;
    const name = $('#tm-name').value.trim().slice(0, 40), role = $('#tm-role').value === 'Manager' ? 'Manager' : 'Agent', camp = $('#tm-camp').value, pin = $('#tm-pin').value.trim();
    if (!name) { DF.toast('Enter the rep\'s full name'); return null; }
    if (pin && !/^\d{4}$/.test(pin)) { DF.toast('PIN = exactly 4 digits'); return null; }
    const list = DF.roster.all().map(x => Object.assign({}, x));
    let r = list.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (r && r.role === 'Owner') { DF.toast('The Owner is edited in the roster below'); return null; }
    if (!r) {
      r = { id: DF.admin.slug(name), name, team: '', color: PAL[list.length % PAL.length] };
      if (list.some(x => x.id === r.id)) r.id += '-' + list.length;
      list.push(r);
    }
    r.role = role;
    if (camp === '*' || role === 'Manager') { r.campaigns = ['*']; delete r.defaultCampaign; }
    else { r.defaultCampaign = camp; r.campaigns = [camp].concat((r.campaigns || []).filter(c => c !== camp && c !== '*')); }   // default first: survives the server roster
    if (pin) r.pin = DF.hash(r.id + ':' + pin);
    await DF.roster.save(list);
    DF.sync.append({ type: 'roster', roster: list }); DF.sync.flush();
    $('#team-form').reset(); render(); DF.toast('Saved: ' + name + (pin ? ' · PIN set' : ''));
    return r;
  }
  function init() {
    $('#team-form').addEventListener('submit', save);
    DF.bus.on('tab:changed', t => { if (t === 'admin') render(); });
    DF.bus.on('roster:changed', () => { if (DF.currentTab === 'admin') render(); });
  }

  DF.adminRoster = { init, render, save };
})();
