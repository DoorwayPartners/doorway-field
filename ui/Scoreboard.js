// Doorway Field v2.6 — Scoreboard: the Blitz Board inside Today's scoreboard. Live daily team ranking (Rep · Knocks · Contacts · Sold) from the
// Field API's per-rep aggregates (sync `board`; no lead details), this phone's own fresher counts merged in, a 🔥 Knock Streak badge (consecutive
// knocks with no gap > 20 min; 0 once idle) on the card and per rep, and 1-tap "Copy Blitz Update" formatted for GroupMe.
(function () {
  'use strict';
  const DF = window.DF;
  const $ = s => DF.$(s);
  const GAP = 20 * 6e4;

  function streak(times, now) {                                          // [current run, best run]; times ascending (ms)
    let run = 0, best = 0;
    times.forEach((t, i) => { run = i && t - times[i - 1] <= GAP ? run + 1 : 1; best = Math.max(best, run); });
    return [times.length && (now || Date.now()) - times[times.length - 1] <= GAP ? run : 0, best];
  }
  function mine() {                                                      // this phone's own status events today (incl. not yet synced)
    const day = new Date().toDateString(), o = { rep: DF.auth.id, knocks: 0, contacts: 0, sold: 0 }, t = [];
    DF.sync.events().forEach(e => {
      if (e.type !== 'status' || e.source === 'bulk' || e.rep !== DF.auth.id || new Date(e.device_ts).toDateString() !== day || !DF.sync.knock(e.to)) return;
      o.knocks++; t.push(Date.parse(e.device_ts)); if (DF.sync.contact(e.to)) o.contacts++; if (e.to === 'SOLD') o.sold++;
    });
    const s = streak(t.sort((a, b) => a - b)); o.streak = s[0]; o.best = s[1];
    return o;
  }
  function rows() {
    const b = DF.sync.meta('board'), srv = b && b.day === new Date().toDateString() ? b.rows : [], me = mine();
    const list = srv.filter(r => r.rep !== DF.auth.id), s = srv.find(r => r.rep === DF.auth.id);
    if (me.knocks || s) list.push(s && s.knocks > me.knocks ? s : me);
    return list.sort((a, b) => b.sold - a.sold || b.knocks - a.knocks || b.contacts - a.contacts);
  }
  const fire = n => n ? '🔥' + n : '';
  function render() {
    const list = rows(), me = list.find(r => r.rep === DF.auth.id) || mine(), b = DF.sync.meta('board');
    $('#sc-blitz').textContent = '🔥 ' + (me.streak || 0);
    $('#sc-blitz').classList.toggle('hot', (me.streak || 0) >= 10);
    $('#blitz-body').innerHTML = list.length ? list.map((r, i) => '<tr class="' + (r.rep === DF.auth.id ? 'me' : '') + '"><td>' + (i + 1) + '</td><td><i class="dot rc-' + DF.esc(r.rep) + '"></i>' +
      DF.esc(DF.roster.name(r.rep)) + ' <span class="streak">' + fire(r.streak) + '</span></td><td>' + r.knocks + '</td><td>' + r.contacts + '</td><td>' + r.sold + '</td></tr>').join('')
      : '<tr><td colspan="5" class="empty">No knocks yet today. First door wins.</td></tr>';
    $('#blitz-at').textContent = b && b.at && b.day === new Date().toDateString() ? 'Team as of ' + DF.fmtTime(b.at) : 'Team totals arrive with the next sync';
    return list;
  }
  function text() {
    const list = rows(), t = list.reduce((a, r) => ({ k: a.k + r.knocks, c: a.c + r.contacts, s: a.s + r.sold }), { k: 0, c: 0, s: 0 });
    const when = new Date().toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    return ['⚡ Blitz Update · ' + when].concat(list.map((r, i) => (i + 1) + '. ' + DF.roster.name(r.rep) + ' — ' + r.knocks + ' knocks · ' + r.contacts + ' contacts · ' + r.sold + ' sold' + (r.streak ? ' 🔥' + r.streak : '')),
      ['Team: ' + t.k + ' knocks · ' + t.c + ' contacts · ' + t.s + ' sold']).join('\n');
  }
  const copy = () => DF.cardplus.copy(text(), $('#blitz-copy')).then(ok => { if (ok) DF.toast('Blitz Update copied: paste it in GroupMe'); return ok; });
  function open() { render(); DF.openModal('blitz-sheet'); if (DF.sync.syncUrl()) DF.sync.flush().then(render, render); }

  function init() {
    $('#sc-blitz').addEventListener('click', open);
    $('#blitz-copy').addEventListener('click', copy);
    $('#blitz-close').addEventListener('click', () => DF.closeModal('blitz-sheet'));
    ['board:changed', 'dispo:queued', 'card:painted', 'auth:changed'].forEach(ev => DF.bus.on(ev, render));
    render();
  }

  DF.scoreboard = { init, render, rows, mine, text, copy, open, streak };
})();
