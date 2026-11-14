// Doorway Field v2.1 — PinStudio: SalesRabbit-scale dual-ring pin renderer (shared by the map + Admin previews) and the
// Admin › Status Pin Inventory visual editor (icon grid, colour swatches, live 34 px preview). v2.2: no new statuses: the official disposition set is locked. Canvas only: no fonts, no inline styles.
(function () {
  'use strict';
  const DF = window.DF;
  // Icon library, keyed by the character stored in status.icon (so chips / menus keep showing a readable glyph). 24-unit paths, white.
  const ICONS = {
    '⌖': { name: 'Pinpoint', d: 'M12 21s-6-5.7-6-11a6 6 0 0 1 12 0c0 5.3-6 11-6 11z M10.2 9.8a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0' },
    '★': { name: 'Star', d: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z', fill: 1 },
    '✓': { name: 'Check', d: 'M5 12.5l4.5 4.5L19 7.5' },
    '?': { name: 'Question', d: 'M8.8 8.8a3.2 3.2 0 1 1 4.5 2.9c-.9.4-1.3 1.1-1.3 2v1.1 M12 18.6v.3' },
    '✕': { name: 'X', d: 'M6.5 6.5l11 11 M17.5 6.5l-11 11' },
    '$': { name: 'Dollar', d: 'M16 7.6c-.8-1.2-2.3-1.9-4-1.9-2.2 0-3.8 1.1-3.8 2.8 0 4 7.8 2.2 7.8 6.2 0 1.8-1.7 2.9-4 2.9-1.8 0-3.4-.7-4.2-2 M12 3.5v17' },
    '☎': { name: 'Phone', d: 'M6.6 3.8l2.6-.3 1.5 3.9-1.8 1.3a10 10 0 0 0 6.4 6.4l1.3-1.8 3.9 1.5-.3 2.6c-.1.9-.9 1.6-1.8 1.5C10.5 18.3 5.7 13.5 5.1 5.6c-.1-.9.6-1.7 1.5-1.8z' },
    '↺': { name: 'Refresh', d: 'M5 12a7 7 0 1 0 2.05-4.95 M5 4v4h4' },
    '🔒': { name: 'Lock', d: 'M6.5 11h11v9h-11z M8.5 11V8a3.5 3.5 0 0 1 7 0v3' },
    '◷': { name: 'Calendar', d: 'M4.5 6h15v14h-15z M4.5 10h15 M8.5 3.5v4 M15.5 3.5v4' },
    '☺': { name: 'Smiley', d: 'M12 3.5a8.5 8.5 0 1 0 .01 0 M8.5 14a4 4 0 0 0 7 0 M9 9.5v.6 M15 9.5v.6' },
    '⚠': { name: 'Warning', d: 'M12 3.5l9 16h-18z M12 10v4.5 M12 17.2v.3' },
    '⌛': { name: 'Hourglass', d: 'M7 3.5h10 M7 20.5h10 M8 3.5c0 4 8 5 8 8.5s-8 4.5-8 8.5 M16 3.5c0 4-8 5-8 8.5s8 4.5 8 8.5' }
  };
  const SWATCHES = ['#58C322', '#1e8e3e', '#7cc4f5', '#3a8fe0', '#1c4f9c', '#2350d8', '#00a3a3', '#ff5fa2', '#9b51e0', '#f2b705', '#f2994a', '#e53935', '#a68a64', '#1d1d1f'];
  const PIN = 34, RING = 3.5, DISC = 27, GLYPH = 17, PAD = 6, BOX = PIN + PAD * 2;   // css px; drawn at 2x
  const paths = {};
  const path = ch => paths[ch] || (paths[ch] = new Path2D(ICONS[ch].d));

  function glyph(x, ch, c, color) {
    if (ICONS[ch]) {
      x.save(); x.translate(c - GLYPH / 2, c - GLYPH / 2); x.scale(GLYPH / 24, GLYPH / 24);
      x.lineWidth = 2.5; x.lineCap = x.lineJoin = 'round'; x.strokeStyle = x.fillStyle = color;
      if (ICONS[ch].fill) x.fill(path(ch)); else x.stroke(path(ch)); x.restore();
    } else {                                                                   // unknown / custom character: bold text glyph
      x.fillStyle = color; x.font = '700 ' + (String(ch).length > 1 ? 12 : 15) + 'px Arial, Helvetica, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(ch || ''), c, c + 1);
    }
  }
  // 34 px dual-ring pin: 3.5 px outer rep ring + 27 px status disc + 17 px white icon + 0 2px 6px rgba(0,0,0,.45) shadow.
  // Ring statuses (Existing Customer): white centre + inner status-colour ring + status-colour icon.
  function pinCanvas(s, ring) {
    const cv = document.createElement('canvas'); cv.width = cv.height = BOX * 2;
    const x = cv.getContext('2d'), c = BOX / 2; x.scale(2, 2);
    x.save(); x.shadowColor = 'rgba(0,0,0,0.45)'; x.shadowBlur = 12; x.shadowOffsetY = 4;          // shadow units are device px (2x)
    x.beginPath(); x.arc(c, c, PIN / 2, 0, Math.PI * 2); x.fillStyle = ring || '#ffffff'; x.fill(); x.restore();
    x.beginPath(); x.arc(c, c, DISC / 2, 0, Math.PI * 2);
    if (s.ring) { x.fillStyle = '#ffffff'; x.fill(); x.beginPath(); x.arc(c, c, DISC / 2 - 1.5, 0, Math.PI * 2); x.lineWidth = 3; x.strokeStyle = s.color; x.stroke(); glyph(x, s.icon, c, s.color); }
    else { x.fillStyle = s.color; x.fill(); glyph(x, s.icon, c, '#ffffff'); }
    return cv;
  }
  const pinImage = (s, ring) => pinCanvas(s, ring).getContext('2d').getImageData(0, 0, BOX * 2, BOX * 2);
  const urls = {};
  const pinUrl = (s, ring) => { const k = [s.icon, s.color, s.ring ? 1 : 0, ring].join('|'); return urls[k] || (urls[k] = pinCanvas(s, ring).toDataURL()); };

  // ---- Admin › Status Pin Inventory: visual editor (2 taps: tap a pin, tap an icon or colour → saved) ----
  let code = null;
  const row = () => code && DF.$('#inv-body tr[data-code="' + code + '"]');
  const draft = () => { const r = row(), s = DF.sync.BY_CODE[code]; return r ? Object.assign({}, s, { icon: DF.$('.i-icon', r).value || s.icon, color: DF.$('.i-color', r).value || s.color }) : s; };
  function paint() {
    const el = DF.$('#pin-studio'); if (!el) return;
    el.hidden = !code || !DF.sync.BY_CODE[code]; if (el.hidden) return;
    const s = draft();
    DF.$('#ps-title').textContent = s.label;
    DF.$('#ps-preview').src = pinUrl(s, '#ffffff');
    DF.$('#ps-preview-rep').src = pinUrl(s, DF.auth.color || '#e31b23');
    DF.$$('#ps-icons button').forEach(b => b.classList.toggle('on', b.dataset.icon === s.icon));
    DF.$$('#ps-swatches button').forEach(b => b.classList.toggle('on', b.dataset.color.toLowerCase() === String(s.color).toLowerCase()));
    const pv = row() && DF.$('.pin-pv img', row()); if (pv) pv.src = pinUrl(s, '#ffffff');
  }
  function open(c) { code = c; paint(); const el = DF.$('#pin-studio'); if (el && !el.hidden && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }
  async function pick(field, value) {
    const r = row(); if (!r || !DF.isManager()) return;
    DF.$(field === 'icon' ? '.i-icon' : '.i-color', r).value = value; paint();
    await DF.admin.saveInventory();                                            // picking = saving (2-tap edit)
    paint();
  }
  function init() {
    const icons = DF.$('#ps-icons'), sw = DF.$('#ps-swatches'); if (!icons) return;
    icons.innerHTML = Object.keys(ICONS).map(ch => '<button type="button" data-icon="' + ch + '" title="' + ICONS[ch].name + '" aria-label="' + ICONS[ch].name + '"><img alt="" src="' +
      pinUrl({ icon: ch, color: '#3c4043' }, '#3c4043') + '"></button>').join('');
    sw.innerHTML = SWATCHES.map(c => '<button type="button" data-color="' + c + '" aria-label="Colour ' + c + '"><img alt="" src="' + pinUrl({ icon: '', color: c }, c) + '"></button>').join('');
    DF.$$('#ps-icons button').forEach(b => b.addEventListener('click', () => pick('icon', b.dataset.icon)));
    DF.$$('#ps-swatches button').forEach(b => b.addEventListener('click', () => pick('color', b.dataset.color)));
    DF.$('#ps-close').addEventListener('click', () => { code = null; paint(); });
    DF.$('#inv-body').addEventListener('click', e => { const b = e.target.closest('.pin-pv'); if (b) open(b.closest('tr').dataset.code); });
    DF.$('#inv-body').addEventListener('input', e => { const r = e.target.closest('tr'); if (r && r.dataset.code === code) paint(); });
  }

  DF.pins = { ICONS, SWATCHES, SIZE: PIN, BOX, pinCanvas, pinImage, pinUrl, open, pick, paint, init, current: () => code };
})();
