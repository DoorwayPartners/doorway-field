// Doorway Field v2.0 — StatsView: Personal + Team scorecards (Day | Week | Month | All Time) and a live Leaderboard
// (Doors Knocked, Contacts, Appts, SOLD, Close %) for one campaign or All Campaigns. Field taps only: lasso / list bulk changes and undone taps don't count.
(function () {
  'use strict';
  const DF = window.DF;
  const $ = s => DF.$(s);
  let range = 'day', camp = null;

  function since(rg) {
    if (rg === 'all') return '';
    const d = new Date(); d.setHours(0, 0, 0, 0);
    if (rg === 'week') d.setDate(d.getDate() - d.getDay()); else if (rg === 'month') d.setDate(1);
    return d.toISOString();
  }
  const blank = rep => ({ rep, knocks: 0, contacts: 0, appts: 0, sold: 0 });
  // Close % = SOLD ÷ Contacts (doors where someone answered: GB, P GB, SOLD, NI, APPT by default; editable in Status Pin Inventory)
  const close = p => p.contacts ? Math.round(100 * p.sold / p.contacts) : 0;
  function compute(rg, campaign) {
    const from = since(rg), per = {}, evs = DF.sync.events(), undone = new Set(evs.filter(e => e.undo_of).map(e => e.undo_of));
    const camps = campaign === '*' ? DF.myCampaigns() : [campaign];
    evs.forEach(e => {
      if (e.type !== 'status' || e.source === 'bulk' || undone.has(e.event_id) || e.device_ts < from || !camps.includes(e.campaign)) return;
      const p = per[e.rep] = per[e.rep] || blank(e.rep);
      if (DF.sync.knock(e.to)) p.knocks++;
      if (DF.sync.contact(e.to)) p.contacts++;
      if (e.to === 'APPT') p.appts++;
      if (e.to === 'SOLD') p.sold++;
    });
    const board = Object.values(per).map(p => Object.assign(p, { close: close(p) })).sort((a, b) => b.sold - a.sold || b.knocks - a.knocks);
    const me = per[DF.auth.id] || blank(DF.auth.id);
    const mates = DF.isOwner() ? null : DF.roster.all().filter(r => r.team && r.team === DF.auth.team).map(r => r.id);
    const team = board.filter(p => !mates || mates.includes(p.rep)).reduce((t, p) => { ['knocks', 'contacts', 'appts', 'sold'].forEach(k => { t[k] += p[k]; }); return t; }, blank('team'));
    return { board, me: Object.assign(me, { close: close(me) }), team: Object.assign(team, { close: close(team) }), teamName: DF.isOwner() ? 'Company' : DF.auth.team || 'Team' };
  }
  const tiles = p => [['knocks', 'Doors Knocked'], ['contacts', 'Contacts'], ['appts', 'Appts'], ['sold', 'SOLD'], ['close', 'Close %']]
    .map(t => '<div class="tile"><b>' + p[t[0]] + (t[0] === 'close' ? '%' : '') + '</b><span>' + t[1] + '</span></div>').join('');
  function render() {
    const camps = (DF.isManager() ? [['*', 'All Campaigns']] : []).concat(DF.myCampaigns().map(c => [c, c]));
    if (!camp || !camps.some(c => c[0] === camp)) camp = camps.some(c => c[0] === DF.campaign) ? DF.campaign : camps[0][0];
    $('#stats-campaign').innerHTML = camps.map(c => '<option value="' + DF.esc(c[0]) + '"' + (c[0] === camp ? ' selected' : '') + '>' + DF.esc(c[1]) + '</option>').join('');
    DF.$$('.range').forEach(b => b.classList.toggle('active', b.dataset.range === range));
    const s = compute(range, camp);
    $('#my-tiles').innerHTML = tiles(s.me);
    $('#team-name').textContent = s.teamName;
    $('#team-tiles').innerHTML = tiles(s.team);
    $('#leaderboard').innerHTML = s.board.map((p, i) => '<tr><td><span class="rank">' + (i + 1) + '</span></td><td><i class="dot rc-' + DF.esc(DF.roster.get(p.rep) ? p.rep : 'none') + '"></i>' + DF.esc(DF.roster.name(p.rep)) +
      '</td><td>' + p.knocks + '</td><td>' + p.contacts + '</td><td>' + p.appts + '</td><td>' + p.sold + '</td><td>' + p.close + '%</td></tr>').join('') || '<tr><td colspan="7" class="empty">No knocks yet</td></tr>';
    DF.ringCss();
    return s;
  }
  function init() {
    DF.$$('.range').forEach(b => b.addEventListener('click', () => { range = b.dataset.range; render(); }));
    $('#stats-campaign').addEventListener('change', e => { camp = e.target.value; render(); });
    DF.bus.on('tab:changed', t => { if (t === 'stats') render(); });
    DF.bus.on('dispo:queued', () => { if (DF.currentTab === 'stats') render(); });
  }
  DF.stats = { init, render, compute, setRange: r => { range = r; }, setCampaign: c => { camp = c; } };
})();
