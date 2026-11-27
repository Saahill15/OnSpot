// Public family-tracking page: GET /t/:id (outside the /v1 prefix so the share link is short).
// Self-contained HTML; reads GET /v1/track/:id every 5 s. Shows only what the public job view allows:
// first name, pro name/plate/rating, status, ETA and map. No phones, start code, chat or notes.
import { Controller, Get, Header, Param } from '@nestjs/common';

const page = (id: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>OnSpot · Live trip</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" />
<style>
  :root { --ink: #222; --muted: #717171; --line: #EBEBEB; --bg2: #F7F7F7; --accent: #FF385C; --ok: #008A05; --okbg: #F0F8F0; --warn: #B35C00; --warnbg: #FFF6EC; --bad: #C13515; --badbg: #FFF2EF; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #fff; color: var(--ink); font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .app { max-width: 520px; margin: 0 auto; min-height: 100%; display: flex; flex-direction: column; }
  header { display: flex; align-items: center; gap: 8px; padding: 14px 18px; font-weight: 700; font-size: 17px; letter-spacing: -.02em; border-bottom: 1px solid var(--line); }
  .logo { width: 26px; height: 26px; border-radius: 8px; background: var(--accent); display: grid; place-items: center; }
  header span.sub { margin-left: auto; font-weight: 500; font-size: 12px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
  .live { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px rgba(0,138,5,.15); }
  #map { height: 42vh; min-height: 240px; background: #EEF0EC; z-index: 0; }
  .leaflet-tile-pane { filter: saturate(.3) brightness(1.05) contrast(.92); }
  .sheet { padding: 18px; margin-top: -18px; background: #fff; border-radius: 20px 20px 0 0; position: relative; z-index: 1; box-shadow: 0 -4px 20px rgba(0,0,0,.06); flex: 1; }
  .label { font-size: 13px; color: var(--muted); }
  h1 { margin: 2px 0 14px; font-size: 28px; letter-spacing: -.03em; font-weight: 600; line-height: 1.15; }
  .pro { display: flex; align-items: center; gap: 12px; padding: 14px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  .av { width: 46px; height: 46px; border-radius: 50%; background: var(--ink); color: #fff; display: grid; place-items: center; font-weight: 600; flex: none; }
  .pill { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 99px; background: var(--bg2); color: #484848; }
  .plate { margin-left: auto; font: 600 12px/1.6 ui-monospace, Consolas, monospace; border: 1px solid #DDD; border-radius: 6px; padding: 0 6px; color: #484848; white-space: nowrap; }
  .note { margin: 14px 0; padding: 12px 14px; border-radius: 12px; background: var(--bg2); font-size: 14px; color: #484848; }
  .note.warn { background: var(--warnbg); } .note.bad { background: var(--badbg); } .note.ok { background: var(--okbg); }
  .btn { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 13px; border-radius: 12px; border: 1px solid #DDD; color: var(--bad); font-weight: 600; text-decoration: none; margin: 14px 0; }
  h3 { font-size: 14px; margin: 18px 0 10px; }
  ul { list-style: none; margin: 0; padding: 0 0 0 14px; border-left: 1px solid var(--line); display: grid; gap: 10px; }
  li { font-size: 13.5px; color: #484848; } li time { display: block; font-size: 12px; color: var(--muted); }
  .center { text-align: center; padding: 60px 24px; }
  .mk { position: absolute; transform: translate(-50%, -50%); border-radius: 50%; border: 3px solid #fff; box-shadow: 0 2px 8px rgba(0,0,0,.25); }
</style>
</head>
<body>
<div class="app">
  <header><span class="logo"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/></svg></span>OnSpot<span class="sub" id="live"><i class="live"></i>Live</span></header>
  <div id="map"></div>
  <div class="sheet" id="sheet"><p class="label">Loading trip…</p></div>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script>
(function () {
  var id = ${JSON.stringify(id)};
  var ACTIVE = ['SEARCHING', 'ASSIGNED', 'ARRIVED', 'IN_PROGRESS'];
  var TITLE = { SEARCHING: 'Finding a pro nearby', ASSIGNED: 'Pro on the way', ARRIVED: 'Pro has arrived', IN_PROGRESS: 'Work in progress', COMPLETED: 'Job done', PAID: 'Job done', CANCELLED: 'Request cancelled', NO_PROVIDER: 'No pro was available' };
  var SERVICE = { tow: 'Towing', puncture: 'Flat tyre', fuel: 'Fuel delivery', battery: 'Battery jump', mechanic: 'Mechanic', plumber: 'Plumber', electrician: 'Electrician', locksmith: 'Locksmith' };
  var map = L.map('map', { zoomControl: false, attributionControl: true }).setView([18.75, 73.4], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  var me = null, pro = null, line = null, fitted = false, timer = null;
  var icon = function (css) { return L.divIcon({ className: '', html: '<div class="mk" style="' + css + '"></div>', iconSize: [0, 0] }); };
  function el(tag, attrs, text) { var e = document.createElement(tag); for (var k in attrs || {}) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; }
  // IST (UTC+5:30, no daylight saving), whatever the viewer's device zone.
  function hhmm(d) { var t = new Date(new Date(d).getTime() + 330 * 60000), h = t.getUTCHours(); return (h % 12 || 12) + ':' + String(t.getUTCMinutes()).padStart(2, '0') + (h < 12 ? ' AM' : ' PM') + ' IST'; }

  function render(j) {
    var s = document.getElementById('sheet'); s.textContent = '';
    var active = ACTIVE.indexOf(j.status) >= 0;
    s.appendChild(el('div', { class: 'label' }, j.customer.name + ' is getting help · ' + (SERVICE[j.service] || j.service)));
    s.appendChild(el('h1', null, j.status === 'ASSIGNED' && j.eta != null ? 'Arriving in ' + j.eta + ' min' : TITLE[j.status] || j.status));
    if (j.late && j.status === 'ASSIGNED') s.appendChild(el('div', { class: 'note warn' }, 'The pro is running late. ' + j.customer.name + ' can switch to another pro for free.'));
    if (j.provider) {
      var p = el('div', { class: 'pro' });
      p.appendChild(el('div', { class: 'av' }, j.provider.name.split(' ').map(function (w) { return w[0]; }).slice(0, 2).join('').toUpperCase()));
      var info = el('div'); info.appendChild(el('div', { style: 'font-weight:600' }, j.provider.name));
      var meta = el('div', { style: 'margin-top:3px;display:flex;gap:6px;align-items:center;font-size:12px;color:#717171' });
      if (j.provider.verified) meta.appendChild(el('span', { class: 'pill' }, '✓ Verified'));
      meta.appendChild(el('span', null, '★ ' + Number(j.provider.rating).toFixed(1)));
      info.appendChild(meta); p.appendChild(info);
      if (j.provider.vehicleNo) p.appendChild(el('span', { class: 'plate' }, j.provider.vehicleNo));
      s.appendChild(p);
    }
    if (!active) s.appendChild(el('div', { class: 'note ' + (j.status === 'PAID' || j.status === 'COMPLETED' ? 'ok' : 'bad') }, j.status === 'PAID' || j.status === 'COMPLETED' ? 'The job is finished. This link stops working 2 hours after the trip ends.' : 'This request is no longer active.'));
    var call = el('a', { class: 'btn', href: 'tel:112' }, 'Call 112 if something is wrong'); s.appendChild(call);
    s.appendChild(el('h3', null, 'Trip updates'));
    var ul = el('ul'); j.events.slice().reverse().forEach(function (e) { var li = el('li'); li.appendChild(el('time', null, hhmm(e.at))); li.appendChild(document.createTextNode(e.text)); ul.appendChild(li); });
    s.appendChild(ul);

    var at = [j.pickup.lat, j.pickup.lng];
    if (!me) me = L.marker(at, { icon: icon('width:20px;height:20px;background:#FF385C') }).addTo(map); else me.setLatLng(at);
    var hasPro = j.provider && j.provider.lat != null && active;
    if (hasPro) {
      var pp = [j.provider.lat, j.provider.lng];
      if (!pro) pro = L.marker(pp, { icon: icon('width:36px;height:36px;background:#222') }).addTo(map); else pro.setLatLng(pp);
      if (j.status === 'ASSIGNED') { if (!line) line = L.polyline([pp, at], { color: '#222', weight: 3, dashArray: '6 8' }).addTo(map); else line.setLatLngs([pp, at]); }
      else if (line) { line.remove(); line = null; }
    } else { if (pro) { pro.remove(); pro = null; } if (line) { line.remove(); line = null; } }
    if (!fitted) { fitted = true; if (hasPro) map.fitBounds([at, [j.provider.lat, j.provider.lng]], { padding: [50, 50], maxZoom: 15 }); else map.setView(at, 14); }
    if (!active) { clearInterval(timer); document.getElementById('live').textContent = 'Ended'; }
  }
  function gone(msg) {
    clearInterval(timer);
    document.getElementById('live').textContent = '';
    document.getElementById('map').style.display = 'none';
    var s = document.getElementById('sheet'); s.textContent = '';
    var c = el('div', { class: 'center' }); c.appendChild(el('h1', null, 'Link expired')); c.appendChild(el('p', { class: 'label' }, msg)); s.appendChild(c);
  }
  function load() {
    fetch('/v1/track/' + encodeURIComponent(id)).then(function (r) {
      if (r.status === 404 || r.status === 410) return gone('This tracking link is no longer available. Links stop working 2 hours after a trip ends.');
      if (!r.ok) return; // temporary error: try again on the next tick
      return r.json().then(render);
    }).catch(function () { /* offline: keep the last state */ });
  }
  load(); timer = setInterval(load, 5000);
})();
</script>
</body>
</html>`;

@Controller('t')
export class TrackPageController {
  @Get(':id') @Header('Content-Type', 'text/html; charset=utf-8') @Header('Cache-Control', 'no-store') @Header('X-Robots-Tag', 'noindex')
  page(@Param('id') id: string) {
    return page(String(id).replace(/[^a-z0-9]/gi, '').slice(0, 40)); // ids are cuids; never echo anything else into the page
  }
}
