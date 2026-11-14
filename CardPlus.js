// Doorway Field v2.4.4 — CardPlus: pin-drawer velocity tools. ← Prev | Next Door → (nearest unknocked New door, same street first), tap-to-copy
// address, Call / Text (tel: / sms:) when a phone is saved, header navigation icon, Today's Scoreboard (Knocks | Contacts | Sold · Me | Team),
// and the SOLD "Copy GroupMe Order" text. 0 network calls.
(function () {
  'use strict';
  const DF = window.DF;
  const $ = s => DF.$(s);
  let back = [], team = false, stepping = false;
  const streetOf = r => String(r.address || '').toUpperCase().replace(/^\s*[\d-]+[A-Z]?\s+/, '').trim();
  const dist = (a, b) => Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 111320 * Math.cos(a.lat * Math.PI / 180));
  const digits = p => String(p || '').replace(/[^\d+]/g, '');
  const addrLine = r => [String(r.address || '') + (r.apt ? ' ' + r.apt : ''), r.city, [r.state, r.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  // ---- Next Door: nearest New door not yet stepped through, on the same street when there is one ----
  function nextDoor(id) {
    const r = DF.sync.get(id); if (!r) return null;
    const pool = DF.sync.all().filter(x => x.lead_id !== id && x.status_code === 'NEW' && DF.map.visible(x) && !back.includes(x.lead_id));
    const same = pool.filter(x => streetOf(x) === streetOf(r)), list = same.length ? same : pool;
    return list.sort((a, b) => dist(r, a) - dist(r, b))[0] || null;
  }
  function go(id) {
    const r = DF.sync.get(id); if (!r) return;
    stepping = true; DF.map.select([id]); DF.bus.emit('pin:selected', id);
    DF.map.moved = true; DF.map.instance.easeTo({ center: [r.lng, r.lat], duration: 300 });
  }
  function next() {
    const cur = DF.card.current(), n = cur && nextDoor(cur);
    if (!n) { DF.toast('No unknocked doors left nearby'); return null; }
    back.push(cur); go(n.lead_id); return n.lead_id;
  }
  function prev() { const id = back.pop(); if (id) go(id); return id || null; }

  // ---- Today's Scoreboard (status events today; bulk changes don't count) ----
  function score() {
    const day = new Date().toDateString(), c = { knocks: 0, contacts: 0, sold: 0 };
    DF.sync.events().forEach(e => {
      if (e.type !== 'status' || e.source === 'bulk' || new Date(e.device_ts).toDateString() !== day || (!team && e.rep !== DF.auth.id)) return;
      if (DF.sync.knock(e.to)) c.knocks++; if (DF.sync.contact(e.to)) c.contacts++; if (e.to === 'SOLD') c.sold++;
    });
    $('#sc-knocks').textContent = c.knocks; $('#sc-contacts').textContent = c.contacts; $('#sc-sold').textContent = c.sold; $('#sc-team').textContent = team ? 'Team' : 'Me';
    return c;
  }

  function paint(r) {
    const ph = digits(r.phone);
    $('#card-nav').href = 'https://maps.google.com/?daddr=' + r.lat + ',' + r.lng;
    $('#card-call').hidden = $('#card-text').hidden = !ph;
    if (ph) { $('#card-call').href = 'tel:' + ph; $('#card-text').href = 'sms:' + ph; }
    $('#card-prev').disabled = !back.length;
    score();
  }
  function copy(text, el) {
    const flash = () => { if (el) { el.classList.add('copied'); setTimeout(() => el.classList.remove('copied'), 1200); } };
    const w = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard'));
    return w.then(() => { flash(); return true; }, () => { DF.toast('Copy blocked here: long-press the text to copy'); return false; });
  }
  // ---- SOLD order → GroupMe text ----
  function orderText(f, r) {
    return ['🎉 SOLD · ' + (r.campaign || ''), 'Customer: ' + (f.customer_name || ''), 'Address: ' + addrLine(r), 'Phone: ' + (f.phone || ''),
      'Speed: ' + (f.speed_tier || ''), 'Install: ' + (f.install_date || 'TBD'), 'Rep: ' + (DF.auth.name || '')].join('\n');
  }
  function formValues() { const f = {}; new FormData($('#forms-form')).forEach((v, k) => { f[k] = String(v).trim(); }); return f; }
  function copyOrder() { const r = DF.sync.get(DF.card.current()); return r ? copy(orderText(formValues(), r), $('#forms-groupme')) : Promise.resolve(false); }

  function init() {
    $('#card-next').addEventListener('click', next);
    $('#card-prev').addEventListener('click', prev);
    $('#card-address').addEventListener('click', () => copy($('#card-address').textContent, $('#card-address')));
    $('#sc-team').addEventListener('click', () => { team = !team; score(); });
    $('#forms-groupme').addEventListener('click', copyOrder);
    DF.bus.on('card:painted', paint);
    DF.bus.on('pin:selected', () => { if (!stepping) back = []; stepping = false; });   // a manual pin tap starts a new walk
  }

  DF.cardplus = { init, nextDoor, next, prev, score, copy, orderText, copyOrder, streetOf, addrLine };
})();
