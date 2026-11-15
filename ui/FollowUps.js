// Doorway Field v2.4.4 — FollowUps (List › Follow-Ups): the signed-in rep's APPT (by appointment time), P GB and GB doors, grouped by street and
// house number, each with 1-tap navigation, Call / Text (when a phone is saved) and a jump to the pin. Managers / Owner see the active campaign(s).
(function () {
  'use strict';
  const DF = window.DF;
  const $ = s => DF.$(s);
  const CODES = ['APPT', 'P_GB', 'GB'];
  const num = r => parseInt(String(r.address || ''), 10) || 0;
  const digits = p => String(p || '').replace(/[^\d+]/g, '');
  const mine = r => DF.inCampaign(r) && (DF.isManager() || (DF.roster.get(r.assigned_rep_email) || {}).id === DF.auth.id);
  const items = () => DF.sync.all().filter(r => CODES.includes(r.status_code) && mine(r));

  function row(r) {
    const s = DF.sync.BY_CODE[r.status_code], ph = digits(r.phone);
    return '<li data-id="' + DF.esc(r.lead_id) + '"><span class="status-chip chip-' + r.status_code + '">' + DF.esc(s.short) + '</span> <b>' + DF.esc(r.address + (r.apt ? ' ' + r.apt : '')) + '</b>' +
      (r.appt_at ? ' <time>' + DF.fmtTime(r.appt_at) + '</time>' : '') + '<span class="fu-act"><a class="icon-btn fu-nav" target="_blank" rel="noopener" aria-label="Navigate" href="https://maps.google.com/?daddr=' + r.lat + ',' + r.lng + '">➤</a>' +
      (ph ? '<a class="btn fu-call" href="tel:' + ph + '">Call</a><a class="btn fu-text" href="sms:' + ph + '">Text</a>' : '') + '<button type="button" class="btn fu-jump">Map</button></span></li>';
  }
  function render() {
    const all = items(), appts = all.filter(r => r.status_code === 'APPT').sort((a, b) => String(a.appt_at || '9999') < String(b.appt_at || '9999') ? -1 : 1);
    const groups = {};
    all.filter(r => r.status_code !== 'APPT').forEach(r => { const k = DF.cardplus.streetOf(r) || 'Unknown street'; (groups[k] = groups[k] || []).push(r); });
    $('#fu-count').textContent = all.length || '';
    $('#followups').innerHTML = !all.length ? '<p class="empty">No follow-ups: APPT, P GB and GB doors land here.</p>' :
      (appts.length ? '<h3>Appointments (' + appts.length + ')</h3><ul class="fu-list">' + appts.map(row).join('') + '</ul>' : '') +
      '<h3>Go-Backs by street</h3>' + Object.keys(groups).sort().map(k => '<h4>' + DF.esc(k) + '</h4><ul class="fu-list">' + groups[k].sort((a, b) => num(a) - num(b)).map(row).join('') + '</ul>').join('');
    DF.$$('#followups .fu-jump').forEach(b => b.addEventListener('click', () => { const id = b.closest('li').dataset.id; DF.showTab('map'); DF.map.jumpTo(id); }));
    return all.length;
  }
  function toggle(on) { const el = $('#followups'); el.hidden = on === undefined ? !el.hidden : !on; $('#list-fu').classList.toggle('active', !el.hidden); if (!el.hidden) render(); }
  function init() {
    $('#list-fu').addEventListener('click', () => toggle());
    ['pins:changed', 'campaign:changed', 'auth:changed'].forEach(ev => DF.bus.on(ev, () => { if (!$('#followups').hidden) render(); else $('#fu-count').textContent = items().length || ''; }));
    DF.bus.on('tab:changed', t => { if (t === 'list') $('#fu-count').textContent = items().length || ''; });
  }

  DF.followups = { init, render, toggle, items };
})();
