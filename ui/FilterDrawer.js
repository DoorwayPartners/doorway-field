// Doorway Field v2.0 — FilterDrawer (top-left sliders): My Leads / Others Leads, Campaign, Lead Statuses icon grid (Select/Deselect All),
// Date (Created | Knocked | Appt × All Time | Today | This Week | Custom), Assigned Users (ABC | Team). One predicate for map + list.
(function () {
  'use strict';
  const DF = window.DF;
  const $ = s => DF.$(s);
  const F = { mine: true, others: true, statuses: null, dateField: 'created', range: 'all', from: '', to: '', users: null, sort: 'abc' };
  let knockCache = null;

  const repKey = r => { const x = DF.roster.get(r.assigned_rep_email); return x ? x.id : r.assigned_rep_email || ''; };
  function lastKnock(id) {
    if (!knockCache) { knockCache = {}; DF.sync.events().forEach(e => { if (e.type === 'status' && e.source !== 'bulk' && DF.sync.knock(e.to)) knockCache[e.lead_id] = e.device_ts; }); }
    return knockCache[id] || '';
  }
  function startOf(range) {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    if (range === 'week') d.setDate(d.getDate() - d.getDay());
    return d.toISOString();
  }
  function inDate(r) {
    if (F.range === 'all') return true;
    const v = F.dateField === 'created' ? r.created_at : F.dateField === 'appt' ? r.appt_at : lastKnock(r.lead_id);
    if (!v) return false;
    if (F.range === 'custom') return (!F.from || v >= new Date(F.from + 'T00:00').toISOString()) && (!F.to || v <= new Date(F.to + 'T23:59:59').toISOString());
    return v >= startOf(F.range);
  }
  function match(r) {
    if (!DF.inCampaign(r)) return false;
    if (F.statuses && !F.statuses.has(r.status_code)) return false;
    const mine = r.assigned_rep_email && repKey(r) === DF.auth.id;
    if (!mine && !DF.isManager()) return false;                          // v2.5.1: an Agent sees only leads assigned to them (map + list)
    if (mine ? !F.mine : !F.others) return false;
    if (F.users && !F.users.has(repKey(r))) return false;
    return inDate(r);
  }
  const active = () => (!F.mine || !F.others ? 1 : 0) + (F.statuses ? 1 : 0) + (F.range !== 'all' ? 1 : 0) + (F.users ? 1 : 0);
  function changed() { $('#filter-badge').textContent = active() || ''; $('#filter-badge').hidden = !active(); DF.bus.emit('filters:changed', F); }

  function users() {
    const keys = new Map();
    DF.roster.all().forEach(r => keys.set(r.id, { key: r.id, name: r.name, team: r.team || 'No team' }));
    DF.sync.all().forEach(r => { const k = repKey(r); if (!keys.has(k)) keys.set(k, { key: k, name: k ? k : 'Unassigned', team: k ? 'From CSV' : 'Unassigned' }); });
    if (!keys.has('')) keys.set('', { key: '', name: 'Unassigned', team: 'Unassigned' });
    return Array.from(keys.values()).sort((a, b) => F.sort === 'team' ? (a.team + a.name).localeCompare(b.team + b.name) : a.name.localeCompare(b.name));
  }
  const seg = (name, opts, val) => '<div class="seg" data-seg="' + name + '">' + opts.map(o => '<button type="button" data-v="' + o[0] + '" class="' + (o[0] === val ? 'on' : '') + '">' + o[1] + '</button>').join('') + '</div>';
  function render() {
    const camps = (DF.isManager() ? [['*', 'All Campaigns']] : []).concat(DF.myCampaigns().map(c => [c, c]));
    let lastTeam = null;
    $('#filter-body').innerHTML =
      '<h4>Show</h4><label class="chk"><input type="checkbox" id="f-mine"' + (F.mine ? ' checked' : '') + '> My Leads</label><label class="chk"><input type="checkbox" id="f-others"' + (F.others ? ' checked' : '') + '> Others Leads</label>' +
      '<h4>Campaign</h4><select id="f-campaign">' + camps.map(c => '<option value="' + DF.esc(c[0]) + '"' + (c[0] === DF.campaign ? ' selected' : '') + '>' + DF.esc(c[1]) + '</option>').join('') + '</select>' +
      '<h4>Lead Statuses <button type="button" class="link" id="f-all">Select All</button> · <button type="button" class="link" id="f-none">Deselect All</button></h4><div class="icon-grid">' +
      DF.sync.STATUS.map(s => '<button type="button" class="ig dispo-' + s.code + (!F.statuses || F.statuses.has(s.code) ? ' on' : '') + '" data-code="' + s.code + '"><i>' + DF.esc(s.icon) + '</i><span>' + DF.esc(s.short) + '</span></button>').join('') + '</div>' +
      '<h4>Date</h4>' + seg('dateField', [['created', 'Created'], ['knocked', 'Knocked'], ['appt', 'Appt']], F.dateField) + seg('range', [['all', 'All Time'], ['today', 'Today'], ['week', 'This Week'], ['custom', 'Custom']], F.range) +
      '<div class="custom-dates"' + (F.range === 'custom' ? '' : ' hidden') + '><input type="date" id="f-from" value="' + F.from + '"><input type="date" id="f-to" value="' + F.to + '"></div>' +
      '<h4>Assigned Users ' + seg('sort', [['abc', 'ABC'], ['team', 'Team']], F.sort) + '</h4><div class="user-list">' +
      users().map(u => { const head = F.sort === 'team' && u.team !== lastTeam ? '<p class="team">' + DF.esc(lastTeam = u.team) + '</p>' : '';
        return head + '<label class="chk"><input type="checkbox" class="f-user" value="' + DF.esc(u.key) + '"' + (!F.users || F.users.has(u.key) ? ' checked' : '') + '><i class="dot rc-' + DF.esc(u.key || 'none') + '"></i>' + DF.esc(u.name) + '</label>'; }).join('') + '</div>';
    DF.ringCss && DF.ringCss();
    $('#f-mine').onchange = e => { F.mine = e.target.checked; changed(); };
    $('#f-others').onchange = e => { F.others = e.target.checked; changed(); };
    $('#f-campaign').onchange = e => DF.setCampaign(e.target.value);
    $('#f-all').onclick = () => { F.statuses = null; render(); changed(); };
    $('#f-none').onclick = () => { F.statuses = new Set(); render(); changed(); };
    DF.$$('#filter-body .ig').forEach(b => b.addEventListener('click', () => {
      const s = F.statuses || new Set(DF.sync.STATUS.map(x => x.code)); s.has(b.dataset.code) ? s.delete(b.dataset.code) : s.add(b.dataset.code);
      F.statuses = s.size === DF.sync.STATUS.length ? null : s; b.classList.toggle('on'); changed();
    }));
    DF.$$('#filter-body .seg').forEach(g => DF.$$('button', g).forEach(b => b.addEventListener('click', () => { F[g.dataset.seg] = b.dataset.v; render(); changed(); })));
    ['from', 'to'].forEach(k => { const el = $('#f-' + k); el.onchange = () => { F[k] = el.value; changed(); }; });
    DF.$$('#filter-body .f-user').forEach(c => c.addEventListener('change', () => {
      const on = DF.$$('#filter-body .f-user').filter(x => x.checked).map(x => x.value);
      F.users = on.length === DF.$$('#filter-body .f-user').length ? null : new Set(on); changed();
    }));
  }
  function reset() { Object.assign(F, { mine: true, others: true, statuses: null, dateField: 'created', range: 'all', from: '', to: '', users: null }); render(); changed(); }

  function init() {
    $('#pill-filter').addEventListener('click', () => { render(); DF.openModal('filter-drawer'); });
    $('#filter-reset').addEventListener('click', reset);
    DF.bus.on('dispo:queued', () => { knockCache = null; });
    DF.bus.on('campaign:changed', () => { if ($('#filter-drawer').classList.contains('open')) render(); });
    changed();
  }

  DF.filters = { init, match, state: F, set: patch => { Object.assign(F, patch); changed(); }, reset, lastKnock, repKey, users };
})();
