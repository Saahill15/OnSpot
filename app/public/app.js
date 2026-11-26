/* OnSpot prototype — Customer, Provider and Ops apps in one SPA (hash routes). */
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rupee = n => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const hhmm = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const initials = n => (n || '?').split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase();
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem('onspot.' + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('onspot.' + k, JSON.stringify(v)); } catch { } },
  del(k) { try { localStorage.removeItem('onspot.' + k); } catch { } },
};
const LOGO = '<span class="logo"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><path d="M12 7v4M12 14h.01"/></svg></span>';
const ICON_PATHS = {
  tow: '<path d="M14 17V6a1 1 0 0 0-1-1H3v12"/><path d="M14 9h4l3 4v4h-2"/><circle cx="7" cy="17.5" r="2"/><circle cx="17" cy="17.5" r="2"/><path d="M9 17.5h6"/>',
  puncture: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M12 3v5.5M12 15.5V21M3 12h5.5M15.5 12H21"/>',
  fuel: '<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16"/><path d="M3 21h12"/><path d="M14 10h2a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V8l-3-3"/><path d="M7 8h4"/>',
  battery: '<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2"/><path d="m11 9-2 3h3l-2 3"/>',
  mechanic: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
  plumber: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  electrician: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  locksmith: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  pin: '<path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  phone: '<path d="M5 3h3l2 5-2.5 1.5a11 11 0 0 0 7 7L16 14l5 2v3a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  share: '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 3v12M7 8l5-5 5 5"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  nav: '<path d="m3 11 18-8-8 18-2-8z"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  upi: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
  id: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="12" r="2"/><path d="M14 10h4M14 14h4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  tool: '<path d="M3 7h18v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M8 7V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M3 12h18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  car: '<path d="M5 17h14v-5l-2-5H7l-2 5z"/><path d="M3 12h18"/><circle cx="8" cy="17" r="1.5"/><circle cx="16" cy="17" r="1.5"/>',
  send: '<path d="m4 12 16-8-6 16-2-6z"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  home: '<path d="m3 11 9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
};
const ic = (n, sz = 20) => `<svg class="i" width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[n] || ''}</svg>`;
const ACTIVE = ['SEARCHING', 'ASSIGNED', 'ARRIVED', 'IN_PROGRESS'];
const STEP = { SEARCHING: 1, ASSIGNED: 2, ARRIVED: 3, IN_PROGRESS: 4, COMPLETED: 5, PAID: 5 };

const S = { cfg: null, services: [], svc: {}, map: null, layers: {}, es: null, timer: null };

async function api(path, body) {
  const r = await fetch('/api' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Something went wrong');
  return d;
}
function toast(msg, kind = '') {
  $$('#toasts .toast').forEach(t => t.remove());
  const el = document.createElement('div'); el.className = 'toast ' + kind; el.textContent = msg;
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), 3800);
}
async function act(fn) { try { return await fn(); } catch (e) { toast(e.message, 'err'); } }
function connect(key, handlers) {
  S.es?.close();
  const es = new EventSource('/api/events?key=' + encodeURIComponent(key));
  for (const [ev, fn] of Object.entries(handlers)) es.addEventListener(ev, e => fn(JSON.parse(e.data)));
  S.es = es;
}
function beep() {
  try { navigator.vibrate?.([200, 100, 200]); } catch { }
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, .25].forEach(d => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(.15, ctx.currentTime + d); o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + .15); });
  } catch { }
}
function locate(ok, fail) {
  if (!navigator.geolocation) return fail?.();
  navigator.geolocation.getCurrentPosition(p => ok({ lat: p.coords.latitude, lng: p.coords.longitude }), () => fail?.(), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
}
function offsetPoint(c, km, deg) {
  const b = deg * Math.PI / 180;
  return { lat: c.lat + (km / 111) * Math.cos(b), lng: c.lng + (km / (111 * Math.cos(c.lat * Math.PI / 180))) * Math.sin(b) };
}
function kmBetween(a, b) {
  const R = 6371, r = d => d * Math.PI / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2)) * 1.35;
}

const STATUS_TEXT = { SEARCHING: 'Finding a provider', ASSIGNED: 'Provider on the way', ARRIVED: 'Provider has arrived', IN_PROGRESS: 'Work in progress', COMPLETED: 'Job completed', PAID: 'Completed and paid', CANCELLED: 'Cancelled', NO_PROVIDER: 'No provider found' };
function chatPanel(j, me) {
  const msgs = j.messages || [];
  const quick = me === 'customer' ? ['Where are you now?', "I'm next to the signboard", 'Please call me', 'Thank you'] : ['On my way', 'Reached, where exactly?', '5 more minutes', 'Please share a landmark'];
  return `<div class="card" id="chatcard">
    <div class="row" style="margin-bottom:10px"><b class="grow">Messages</b><span class="muted xs">${ic('lock', 12)}</span><span class="muted xs">Numbers stay private</span></div>
    <div class="chat" id="chatlog">${msgs.length ? msgs.map(m => `<div class="msg ${m.from === me ? 'me' : 'them'}">${esc(m.text)}<time>${hhmm(m.t)}</time></div>`).join('') : '<p class="muted sm center" style="padding:8px 0">No messages yet</p>'}</div>
    <div class="quick">${quick.map(q => `<button class="chip" data-quick="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    <form class="chat-form" id="chatform"><input class="input" id="chatinput" placeholder="Message" autocomplete="off" maxlength="500"><button class="iconbtn" type="submit" aria-label="Send" style="background:var(--ink);color:#fff;border-color:var(--ink)">${ic('send', 16)}</button></form>
  </div>`;
}
function bindChat(el, state, sendFn) {
  const log = $('#chatlog', el); if (log) log.scrollTop = log.scrollHeight;
  const inp = $('#chatinput', el); if (!inp) return;
  inp.value = state.draft || '';
  if (state.chatFocus) { inp.focus({ preventScroll: true }); inp.setSelectionRange(inp.value.length, inp.value.length); }
  inp.oninput = () => { state.draft = inp.value; };
  const go = text => { text = text.trim(); if (!text) return; state.draft = ''; inp.value = ''; act(() => sendFn(text)); };
  $('#chatform', el).onsubmit = e => { e.preventDefault(); state.chatFocus = true; go(inp.value); };
  $$('[data-quick]', el).forEach(b => b.onclick = () => go(b.dataset.quick));
}
const CANCEL_REASONS = ['Fixed it myself', 'Found help elsewhere', 'Taking too long', 'Wrong location or service', 'Price concern', 'Other'];

// ------------------------------------------------------------------ map helpers
function initMap(center, zoom = 14) {
  S.map = L.map('map', { zoomControl: false }).setView([center.lat, center.lng], zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(S.map);
  setTimeout(() => S.map?.invalidateSize(), 50);
}
const icon = (cls, html = '') => L.divIcon({ className: '', html: `<div class="mk ${cls}">${html}</div>`, iconSize: [0, 0] });
function setMarker(key, ll, ic, opts = {}) {
  if (!ll || ll.lat == null) { S.layers[key]?.remove(); delete S.layers[key]; return null; }
  if (S.layers[key]) { S.layers[key].setLatLng([ll.lat, ll.lng]); if (ic) S.layers[key].setIcon(ic); }
  else S.layers[key] = L.marker([ll.lat, ll.lng], { icon: ic, ...opts }).addTo(S.map);
  return S.layers[key];
}
function setLine(key, a, b) {
  if (!a || !b || a.lat == null) { S.layers[key]?.remove(); delete S.layers[key]; return; }
  if (S.layers[key]) S.layers[key].setLatLngs([[a.lat, a.lng], [b.lat, b.lng]]);
  else S.layers[key] = L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color: '#FF5A1F', weight: 4, dashArray: '6 8', opacity: .9 }).addTo(S.map);
}
function setGroup(key, items) {
  S.layers[key]?.remove();
  S.layers[key] = L.layerGroup(items).addTo(S.map);
}
function fit(points) {
  const pts = points.filter(p => p && p.lat != null).map(p => [p.lat, p.lng]);
  if (pts.length > 1) S.map.fitBounds(pts, { padding: [50, 50], maxZoom: 15 });
  else if (pts.length === 1) S.map.setView(pts[0], 15);
}

// ------------------------------------------------------------------ router
function teardown() {
  S.es?.close(); S.es = null;
  if (S.map) { S.map.remove(); S.map = null; }
  S.layers = {}; clearInterval(S.timer); S.timer = null;
}
async function router() {
  teardown();
  if (!S.cfg) { S.cfg = await api('/services'); S.services = S.cfg.services; S.services.forEach(s => { s.icon = ic(s.code); }); S.svc = Object.fromEntries(S.services.map(s => [s.code, s])); }
  const h = location.hash.replace(/^#\/?/, '');
  if (h === 'customer') customerApp();
  else if (h === 'provider') providerApp();
  else if (h === 'admin') adminApp();
  else if (h.startsWith('track/')) trackApp(h.slice(6));
  else landing();
}
window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', router);

// ================================================================== LANDING
function landing() {
  const svcCards = S.services.map(s => `<a class="svc-card" href="#/customer" data-pre="${s.code}"><span class="svc-ic lg">${s.icon}</span><span class="svc-name">${s.name}</span><span class="svc-from">from ${rupee(s.base)}</span></a>`).join('');
  $('#root').innerHTML = `
  <div class="landing">
    <nav class="l-nav"><a class="brand" href="#/">${LOGO}OnSpot</a><div class="row"><a class="link hide-sm" href="#/provider">Become a partner</a><a class="link hide-sm" href="#/admin">Ops</a><a class="btn dark sm" href="#/customer">Get help</a></div></nav>
    <section class="hero2">
      <div class="hero-copy">
        <span class="eyebrow"><span class="dot"></span>Live in Pune and the Mumbai–Pune Expressway</span>
        <h1>Stuck? Help is <span class="accent">on the spot.</span></h1>
        <p class="lead">Towing, flat tyres, fuel, battery, mechanics, plumbers and electricians. Verified pros near you, at a price that's locked before they leave.</p>
        <a class="searchbar" href="#/customer"><span class="sb-ic">${ic('search', 18)}</span><span class="grow"><b>What do you need?</b><span>Towing, flat tyre, fuel, plumber…</span></span><span class="sb-go">${ic('arrow', 18)}</span></a>
        <div class="trust"><div><b>24×7</b><span>day and night</span></div><div><b>₹0</b><span>hidden charges</span></div><div><b>100%</b><span>KYC-verified pros</span></div></div>
      </div>
      <div class="phone" aria-hidden="true">
        <div class="phone-map"><span class="pm-route"></span><span class="pm-me"></span><span class="pm-pro">${ic('tow', 16)}</span></div>
        <div class="phone-card">
          <div class="label">Provider on the way</div>
          <div class="pc-eta">7 min</div>
          <div class="row" style="margin-top:12px"><div class="avatar sm">SP</div><div class="grow"><b class="sm">Sanjay Patil</b><div class="muted xs">★ 4.9 · Towing · MH 14 TX 4821</div></div><span class="badge">${ic('check', 11)}Verified</span></div>
          <div class="pc-fare"><span>${ic('lock', 14)} Locked fare</span><b>₹1,192</b></div>
          <div class="pc-actions">${['chat', 'phone', 'share', 'alert'].map(i => `<span>${ic(i, 16)}</span>`).join('')}</div>
        </div>
      </div>
    </section>
    <section class="section"><h2 class="sec-title">What do you need help with?</h2><div class="svc-row">${svcCards}</div></section>
    <section class="section values">
      <div><span class="v-ic">${ic('lock', 22)}</span><h3>Fair Price Lock</h3><p>The fare you see is the most you pay. Parts or tolls need your approval in the app.</p></div>
      <div><span class="v-ic">${ic('shield', 22)}</span><h3>Verified pros</h3><p>KYC-checked providers. The job only starts when you share your code in person.</p></div>
      <div><span class="v-ic">${ic('pin', 22)}</span><h3>Live tracking and SOS</h3><p>Watch them arrive, share the trip with family, reach help in one tap.</p></div>
    </section>
    <section class="section how">
      <h2 class="sec-title">How it works</h2>
      <ol><li><b>Pin your spot</b><span>GPS, or a highway km stone.</span></li><li><b>See the locked fare</b><span>Full breakdown before you book.</span></li><li><b>Track your pro</b><span>The nearest verified provider accepts.</span></li><li><b>Approve and pay</b><span>Code to start, pay in the app, rate.</span></li></ol>
    </section>
    <section class="section"><div class="partner-band">
      <div><h2>Own a tow truck, a puncture shop or a toolkit?</h2><p>List yourself on OnSpot. Go online when you want, accept jobs near you, get paid the next day. No haggling, no unpaid jobs.</p><a class="btn lg" href="#/provider" style="background:#fff;color:#222;border-color:#fff">Become a partner</a></div>
      <ul><li>${ic('check', 18)}Low commission, 0% for your first 3 months</li><li>${ic('check', 18)}Guaranteed payment for every job</li><li>${ic('check', 18)}Steady demand from your own area</li></ul>
    </div></section>
    <footer class="l-foot2">
      <div><a class="brand" href="#/">${LOGO}OnSpot</a><p class="muted sm" style="margin-top:10px;max-width:260px">Help, on the spot. Roadside and home emergencies, 24×7.</p></div>
      <div><b>Customers</b><a href="#/customer">Get help</a><a href="#/customer">Shield plan</a><a href="tel:112">Emergency 112</a></div>
      <div><b>Partners</b><a href="#/provider">Become a partner</a><a href="#/provider">Partner app</a></div>
      <div><b>Company</b><a href="#/admin">Ops console</a><span class="muted sm">Prototype build</span></div>
    </footer>
  </div>`;
  $$('[data-pre]').forEach(el => el.onclick = () => { C.sel = el.dataset.pre; C.quote = null; });
}

// ================================================================== LOGIN
function loginView(role) {
  const isC = role === 'customer';
  $('#root').innerHTML = `
  <div class="app">
    <header class="topbar"><a class="brand" href="#/">${LOGO}OnSpot</a><span class="tb-sub">${isC ? 'Customer' : 'Partner'}</span></header>
    <div class="pad">
      <div class="hero-ic">${ic(isC ? 'pin' : 'tool', 24)}</div>
      <h1 class="h2" style="font-size:26px">${isC ? 'Get help in minutes' : 'Earn on your own schedule'}</h1>
      <p class="muted">${isC ? 'Sign in with your phone number. We only share a masked number with providers.' : 'List yourself, go online when you want, accept jobs near you. You are your own boss — OnSpot just brings the customers.'}</p>
      <form id="login" style="margin-top:20px">
        <label class="field"><span class="label">Your name</span><input class="input" name="name" required maxlength="40" placeholder="${isC ? 'Rahul Sharma' : 'Sanjay Patil'}" autocomplete="name"></label>
        <label class="field"><span class="label">Phone</span><input class="input" name="phone" required inputmode="numeric" pattern="[0-9]{10}" maxlength="10" placeholder="10-digit mobile" autocomplete="tel"></label>
        <button class="btn primary block lg" type="submit">Continue</button>
        <p class="muted xs center" style="margin-top:12px">Prototype: no real OTP is sent.</p>
      </form>
    </div>
  </div>`;
  $('#login').onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    act(async () => {
      const d = await api('/login', { name: f.get('name').trim(), phone: f.get('phone').trim(), role });
      store.set(isC ? 'cust' : 'prov', d.user); router();
    });
  };
}
function appShell(sub, short, tabs) {
  $('#root').innerHTML = `
  <div class="app">
    <header class="topbar"><a class="brand" href="#/">${LOGO}OnSpot</a><span class="tb-sub">${sub}</span><span class="spacer"></span>
      <button class="iconbtn" id="logout" title="Sign out" aria-label="Sign out"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg></button></header>
    <div id="map" class="map ${short ? 'short' : ''}"></div>
    <section id="sheet" class="sheet"></section>
    ${tabs ? `<nav class="tabbar">${tabs.map(([k, l, i]) => `<button data-tab="${k}" class="${k === 'home' ? 'on' : ''}">${ic(i, 22)}<span>${l}</span></button>`).join('')}</nav>` : ''}
  </div>`;
}

// ================================================================== CUSTOMER
const C = { editWhere: false, tab: 'home', profile: null, history: [], chatOpen: false, seen: 0, draft: '', chatFocus: false, cancelOpen: false, cancelReason: '', user: null, job: null, pickup: null, drop: null, dropIdx: 0, sel: null, quote: null, nearbyCount: 0, nearby: [], notes: '', landmark: '', night: false, pickDrop: false, stars: 5, payMethod: 'upi', locLabel: 'Detecting your location…' };

async function customerApp() {
  C.user = store.get('cust');
  if (!C.user) return loginView('customer');
  appShell('Customer', false, [['home', 'Help', 'home'], ['activity', 'Activity', 'list'], ['account', 'Account', 'user']]);
  const lo = $('#logout'); lo.innerHTML = `<span class="avatar xs">${initials(C.user.name)}</span>`; lo.classList.add('avatar-btn'); lo.title = 'Account'; lo.onclick = () => setTab('account');
  $('#map').insertAdjacentHTML('afterend', `<button class="map-fab" id="fabgps" aria-label="Use my location">${ic('nav', 18)}</button>`);
  $('#fabgps').onclick = () => locate(ll => { C.pickup = ll; C.locLabel = 'Your current location'; S.map.setView([ll.lat, ll.lng], 14); onPickupChange(); }, () => toast('Location is blocked. Tap the map to set your spot.', 'err'));
  $$('[data-tab]').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  api(`/users/${C.user.id}`).then(d => { C.profile = d.user; if (C.tab === 'account') renderCustomer(); }).catch(() => { store.del('cust'); router(); });
  if (!C.pickup) C.pickup = { ...S.cfg.center };
  initMap(C.pickup);
  S.map.on('click', e => {
    if (C.job && ACTIVE.includes(C.job.status)) return;
    const ll = { lat: e.latlng.lat, lng: e.latlng.lng };
    if (C.pickDrop) { C.drop = ll; C.dropIdx = -1; C.pickDrop = false; refreshQuote(); }
    else { C.pickup = ll; C.locLabel = 'Pinned on map'; onPickupChange(); }
  });
  connect(C.user.id, {
    job: j => {
      if (C.job && j.id !== C.job.id) return;
      const prev = C.job?.status, prevMsgs = (C.job?.messages || []).length; C.job = j;
      if (prev !== j.status) { notifyStatus(j); C.cancelOpen = false; }
      const msgs = j.messages || [];
      if (msgs.length > prevMsgs && msgs[msgs.length - 1].from === 'provider') { if (!C.chatOpen) toast(`${j.provider?.name}: ${msgs[msgs.length - 1].text}`); beep(); }
      if (C.chatOpen) C.seen = msgs.length;
      if (C.tab !== 'home' && prev !== j.status) setTab('home'); else renderCustomer();
    },
    loc: l => {
      if (!C.job || l.jobId !== C.job.id || !C.job.provider) return;
      C.job.provider.lat = l.lat; C.job.provider.lng = l.lng; C.job.eta = l.eta;
      drawCustomerMap(); const el = $('#eta'); if (el) el.textContent = l.eta + ' min';
    },
  });
  // restore an unfinished job (e.g. after refresh)
  await act(async () => {
    const { jobs } = await api(`/users/${C.user.id}/jobs`);
    const j = jobs.find(j => ACTIVE.includes(j.status) || j.status === 'COMPLETED' || (j.status === 'PAID' && !j.ratings.customer && Date.now() - j.createdAt < 3600e3));
    if (j) { C.job = j; C.pickup = j.pickup; C.locLabel = j.pickup.label || 'Pinned on map'; }
  });
  renderCustomer();
  if (!C.job) {
    if (C.locLabel.startsWith('Detecting')) locate(ll => { C.pickup = ll; C.locLabel = 'Your current location (GPS)'; S.map?.setView([ll.lat, ll.lng], 14); onPickupChange(); },
      () => { C.locLabel = 'Demo spot · Lonavala, Mumbai–Pune Expy'; onPickupChange(); });
    else onPickupChange();
  } else fitJob();
}
function notifyStatus(j) {
  const m = { ASSIGNED: `${j.provider?.name} accepted · arriving in ${j.eta} min`, ARRIVED: `${j.provider?.name} has arrived. Share your start code.`, IN_PROGRESS: 'Job started', COMPLETED: 'Job completed — please review the bill', NO_PROVIDER: 'No provider available right now' };
  if (m[j.status]) { toast(m[j.status], j.status === 'NO_PROVIDER' ? 'err' : 'ok'); if (j.status !== 'IN_PROGRESS') beep(); }
  if (j.status === 'ASSIGNED') fitJob();
}
function fitJob() { if (C.job?.provider) fit([C.job.pickup, C.job.provider]); }
async function onPickupChange() {
  drawCustomerMap(); renderCustomer();
  await act(async () => { const d = await api(`/nearby?lat=${C.pickup.lat}&lng=${C.pickup.lng}`); C.nearby = d.providers; });
  drawCustomerMap(); renderCustomer();
  if (C.sel) refreshQuote();
}
function garages() {
  const names = ['OnSpot partner garage · Shree Auto Works', 'Highway Motors (24×7)', 'Authorised service centre'];
  return names.map((n, i) => { const p = offsetPoint(C.pickup, [4, 7.5, 12][i], [40, 160, 290][i]); return { name: n, ...p, km: kmBetween(C.pickup, p) }; });
}
async function refreshQuote() {
  if (!C.sel) return;
  if (C.sel === 'tow' && !C.drop) { const g = garages()[0]; C.drop = { lat: g.lat, lng: g.lng }; C.dropIdx = 0; }
  await act(async () => {
    const d = await api('/quote', { customerId: C.user.id, service: C.sel, pickup: C.pickup, drop: C.sel === 'tow' ? C.drop : null, night: C.night || undefined });
    C.quote = d.quote; C.nearbyCount = d.nearby;
  });
  drawCustomerMap(); renderCustomer();
}
function drawCustomerMap() {
  if (!S.map) return;
  const j = C.job, active = j && ACTIVE.includes(j.status);
  const pickup = j ? j.pickup : C.pickup;
  const m = setMarker('me', pickup, icon('me'), { draggable: !j, zIndexOffset: 500 });
  if (m && !m._bound) { m._bound = true; m.on('dragend', e => { const p = e.target.getLatLng(); C.pickup = { lat: p.lat, lng: p.lng }; C.locLabel = 'Pinned on map'; onPickupChange(); }); }
  if (m) j ? m.dragging?.disable() : m.dragging?.enable();
  const drop = j ? j.drop : (C.sel === 'tow' ? C.drop : null);
  setMarker('drop', drop, icon('drop', ic('flag', 14)));
  if (!j && C.nearby.length) {
    setGroup('nearby', C.nearby.filter(p => !C.sel || p.services.includes(C.sel)).map(p => L.marker([p.lat, p.lng], { icon: icon('pro' + (p.busy ? ' busy' : ''), S.svc[p.services[0]]?.icon || ic('mechanic')), interactive: false })));
  } else setGroup('nearby', []);
  if (active && j.provider) {
    setMarker('prov', j.provider, icon('assigned', S.svc[j.service].icon), { zIndexOffset: 1000 });
    setLine('route', j.provider, j.status === 'ASSIGNED' ? j.pickup : null);
  } else { setMarker('prov', null); setLine('route', null); }
}

function setTab(t) {
  C.tab = t;
  $$('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  const map = $('#map'); map.style.display = t === 'home' ? '' : 'none'; const fab = $('#fabgps'); if (fab) fab.style.display = t === 'home' && !(C.job && ACTIVE.includes(C.job.status)) ? '' : 'none';
  $('#sheet').classList.toggle('flat', t !== 'home');
  if (t === 'home') setTimeout(() => S.map?.invalidateSize(), 30);
  if (t === 'activity') api(`/users/${C.user.id}/jobs`).then(d => { C.history = d.jobs; renderCustomer(); });
  if (t === 'account') api(`/users/${C.user.id}`).then(d => { C.profile = d.user; renderCustomer(); });
  renderCustomer();
}
function renderCustomer() {
  const el = $('#sheet'); if (!el) return;
  C.chatFocus = document.activeElement?.id === 'chatinput';
  const j = C.job;
  let html;
  if (C.tab === 'activity') html = cActivity();
  else if (C.tab === 'account') html = cAccount();
  else if (j && j.status === 'SEARCHING') html = cSearching(j);
  else if (j && ACTIVE.includes(j.status)) html = cActive(j);
  else if (j && j.status === 'COMPLETED') html = cBill(j);
  else if (j && j.status === 'PAID') html = j.ratings.customer ? cDone(j) : cRate(j);
  else if (j && ['NO_PROVIDER', 'CANCELLED'].includes(j.status)) html = cEnded(j);
  else if (C.sel) html = cQuote();
  else html = cHome();
  el.innerHTML = (C.tab === 'home' ? '<div class="grab"></div>' : '') + html;
  bindCustomer(el); const fab = $('#fabgps'); if (fab) fab.style.display = C.tab === 'home' && !C.job ? '' : 'none';
  drawCustomerMap();
}

const SYMPTOMS = [["Won't start", 'battery', 'battery'], ['Flat tyre', 'puncture', 'puncture'], ['Out of fuel', 'fuel', 'fuel'], ["Can't drive it", 'tow', 'tow'], ['Noise or smoke', 'mechanic', 'mechanic'], ['Locked out', 'locksmith', 'locksmith'], ['Water leak', 'plumber', 'plumber'], ['No power', 'electrician', 'electrician']];
function etaFor(code) {
  const ps = C.nearby.filter(p => !p.busy && p.services.includes(code));
  if (!ps.length) return null;
  const km = Math.min(...ps.map(p => kmBetween(C.pickup, p)));
  return Math.max(3, Math.round(km / 32 * 60));
}
function cHome() {
  const online = C.nearby.filter(p => !p.busy).length;
  const card = s => { const e = etaFor(s.code); return `<button class="svc-card2" data-svc="${s.code}"><span class="svc-ic">${s.icon}</span><b>${s.name}</b><span class="muted xs">From ${rupee(s.base)}</span><span class="eta-tag ${e ? '' : 'off'}">${e ? `${ic('clock', 12)}~${e} min` : 'Unavailable'}</span></button>`; };
  return `
    <button class="where" id="where"><span class="where-ic">${ic('pin', 18)}</span><span class="grow"><b>${esc(C.landmark || C.locLabel)}</b><span>${online ? `${online} pros available nearby` : 'Looking for pros nearby…'}</span></span><span class="where-edit">${C.editWhere ? 'Done' : 'Edit'}</span></button>
    ${C.editWhere ? `<div class="where-box"><input class="input" id="landmark" value="${esc(C.landmark)}" placeholder="Landmark or km stone, e.g. Km 62 near Lonavala exit"><div class="row" style="margin-top:10px"><button class="btn sm soft" id="gps">${ic('nav', 14)} Use my GPS</button><span class="muted xs grow">Or tap the map, or drag the pin.</span></div></div>` : ''}
    <h2 class="title">What happened?</h2>
    <div class="symptoms">${SYMPTOMS.map(([t, code, i]) => `<button class="symptom" data-svc="${code}"><span>${ic(i, 22)}</span>${t}</button>`).join('')}</div>
    <h3 class="sec">Roadside</h3><div class="svc-grid">${S.services.filter(x => x.group === 'Roadside').map(card).join('')}</div>
    <h3 class="sec">At home</h3><div class="svc-grid">${S.services.filter(x => x.group === 'Home').map(card).join('')}</div>
    <div class="promise"><span>${ic('lock', 18)}</span><span><b>Fair Price Lock.</b> The price you see before booking is the most you pay. Extras need your approval.</span></div>
    <p class="muted sm center" style="margin-top:18px">Medical emergency? Call <a href="tel:112">112</a></p>`;
}

function cQuote() {
  const s = S.svc[C.sel], q = C.quote;
  const tow = C.sel === 'tow' ? `
    <h3 class="sec" style="margin-top:6px">Tow to</h3>
    ${garages().map((g, i) => `<label class="opt ${C.dropIdx === i ? 'on' : ''}"><input type="radio" name="drop" value="${i}" ${C.dropIdx === i ? 'checked' : ''}><span class="grow"><b class="sm">${esc(g.name)}</b><div class="muted xs">${g.km.toFixed(1)} km away</div></span></label>`).join('')}
    <button class="btn ghost sm" id="pickdrop">${C.dropIdx === -1 ? 'Custom drop point set · change' : C.pickDrop ? 'Tap the map to set the drop point…' : 'Choose a different drop point on the map'}</button>` : '';
  const bill = q ? `
    <div class="kpis"><div class="kpi"><b>${q.etaMin} min</b><span>arrival</span></div><div class="kpi"><b>${C.nearbyCount}</b><span>pros nearby</span></div><div class="kpi"><b>★ 4.7+</b><span>avg rating</span></div></div>
    <h3 class="sec">Price details</h3>
    <div class="bill">${q.items.map(i => `<div class="li"><span>${esc(i.label)}</span><span>${rupee(i.amount)}</span></div>`).join('')}<div class="li total"><span>Total (INR)</span><span>${rupee(q.total)}</span></div></div>
    <div class="lock">${ic('lock', 18)}<span><b>This price is locked.</b> The provider can't charge more. Any parts or tolls appear in your app for you to approve or reject.</span></div>` : '<div class="skeleton"></div><div class="skeleton short"></div>';
  return `
    <div class="row-head"><button class="iconbtn" id="back" aria-label="Back">${ic('back', 18)}</button><span class="svc-ic">${s.icon}</span><div class="grow"><div class="h2">${s.name}</div><div class="muted sm">${esc(s.desc)}</div></div></div>
    ${tow}${bill}
    <label class="check"><input type="checkbox" id="night" ${C.night || S.cfg.night ? 'checked' : ''} ${S.cfg.night ? 'disabled' : ''}> ${S.cfg.night ? 'Night rates apply (10 PM–6 AM, capped)' : 'Simulate night time (demo)'}</label>
    ${C.profile?.vehicle?.model ? `<div class="row muted sm" style="margin-bottom:10px">${ic('car', 16)}<span>${esc(C.profile.vehicle.model)} · ${esc(C.profile.vehicle.plate)} · ${C.profile.vehicle.fuel.toUpperCase()}</span></div>` : ''}
    <textarea class="input" id="notes" rows="2" placeholder="Anything the provider should know? e.g. white Swift, front-left tyre, parked on the shoulder">${esc(C.notes)}</textarea>
    ${q && !q.shield ? `<button class="btn ghost sm" id="gotoshield" style="margin-top:8px">Save ${rupee(S.cfg.platformFee)} on every request with Shield</button>` : ''}
    <div class="bookbar">
      <div class="grow"><div class="bb-price">${q ? rupee(q.total) : '—'} <span>total</span></div><div class="bb-sub">${ic('lock', 12)} Price locked${q ? ` · ~${q.etaMin} min` : ''}</div></div>
      <button class="btn primary lg" id="request" ${q && C.nearbyCount ? '' : 'disabled'}>${q && !C.nearbyCount ? 'No pros nearby' : 'Request'}</button>
    </div>`;
}

function cSearching(j) {
  const s = S.svc[j.service];
  return `
    <div class="radar"><span></span><span></span><div class="radar-core">${s.icon}</div></div>
    <div class="center"><div class="h2">Finding your ${s.name.toLowerCase()} pro</div>
    <p class="muted sm" style="margin-top:6px">Searching within ${j.radiusKm || 8} km · sent to ${j.offeredCount} nearby pro${j.offeredCount === 1 ? '' : 's'}</p></div>
    <div class="fare-row">${ic('lock', 16)}<span class="grow">Fare locked</span><b>${rupee(j.quote.total)}</b></div>
    ${C.cancelOpen ? cancelPanel(j) : '<button class="btn ghost block" id="cancel" style="margin-top:8px">Cancel request · free</button>'}`;
}

function cActive(j) {
  const s = S.svc[j.service], p = j.provider;
  const title = { ASSIGNED: 'Your pro is on the way', ARRIVED: 'Your pro has arrived', IN_PROGRESS: 'Work in progress' }[j.status];
  const pending = j.addons.filter(a => a.status === 'pending');
  const decided = j.addons.filter(a => a.status !== 'pending');
  const unread = (j.messages || []).length - C.seen;
  const extras = decided.filter(a => a.status === 'approved').reduce((t, a) => t + a.amount, 0);
  return `
    <div class="trip-head">
      <div class="grow"><div class="label">${title}</div>
      <div class="trip-big">${j.status === 'ASSIGNED' ? `<span id="eta">${j.eta} min</span>` : j.status === 'ARRIVED' ? 'Share your code' : `Since ${hhmm(j.startedAt)}`}</div></div>
      <span class="svc-ic lg">${s.icon}</span>
    </div>
    <div class="steps">${[1, 2, 3, 4, 5].map(i => `<div class="${i <= STEP[j.status] ? 'on' : ''}"></div>`).join('')}</div>
    ${pending.map(a => `
      <div class="addon"><div class="label">Approval needed</div>
        <div class="row" style="margin:6px 0 12px"><div class="grow"><b>${esc(a.label)}</b><div class="muted sm">${esc(a.reason)}</div></div><div class="amt">${rupee(a.amount)}</div></div>
        <div class="row"><button class="btn dark grow" data-addon="${a.id}" data-ok="1">Approve</button><button class="btn grow" data-addon="${a.id}" data-ok="0">Decline</button></div>
        <div class="muted xs" style="margin-top:10px">If you decline, you are not charged. New total if approved: ${rupee(j.quote.total + extras + a.amount)}</div>
      </div>`).join('')}
    <div class="pro-row">
      <div class="avatar">${initials(p.name)}</div>
      <div class="grow"><div class="h3">${esc(p.name)} ${p.kyc === 'verified' ? `<span class="badge">${ic('check', 11)}Verified</span>` : ''}</div>
      <div class="muted sm">★ ${p.rating} · ${p.ratingCount} jobs</div></div>
      ${p.vehicle ? `<span class="plate">${esc(p.vehicle)}</span>` : ''}
    </div>
    ${j.status !== 'IN_PROGRESS' ? `<div class="code-row"><div class="grow"><b>Start code</b><div class="muted xs">Share only when your pro is with you</div></div><div class="otp">${j.otp.split('').map(d => `<span>${d}</span>`).join('')}</div></div>` : ''}
    <div class="icon-actions">
      <button id="chat" class="${C.chatOpen ? 'on' : ''}"><span>${ic('chat', 20)}${unread > 0 && !C.chatOpen ? `<i class="unread">${unread}</i>` : ''}</span>Message</button>
      <a href="tel:0000000000" title="Masked number ${esc(p.phone)}"><span>${ic('phone', 20)}</span>Call</a>
      <button id="share"><span>${ic('share', 20)}</span>Share trip</button>
      <button id="sos" class="danger"><span>${ic('alert', 20)}</span>SOS</button>
    </div>
    ${C.chatOpen ? chatPanel(j, 'customer') : ''}
    ${C.cancelOpen ? cancelPanel(j) : ''}
    <div class="fare-row">${ic('lock', 16)}<span class="grow">Locked fare${extras ? ` + approved extras` : ''}</span><b>${rupee(j.quote.total + extras)}</b></div>
    ${decided.length ? `<div class="bill" style="margin:4px 0 12px">${decided.map(a => `<div class="li"><span>${esc(a.label)} · ${a.status === 'approved' ? 'approved' : 'declined'}</span><span>${a.status === 'approved' ? rupee(a.amount) : '—'}</span></div>`).join('')}</div>` : ''}
    <details class="trip-details"><summary>Trip details</summary>${timeline(j)}</details>
    ${j.status !== 'IN_PROGRESS' && !C.cancelOpen ? '<button class="btn ghost block" id="cancel">Cancel request</button>' : ''}`;
}

function cancelPanel(j) {
  const fee = j.status === 'ARRIVED';
  return `<div class="card" id="cancelcard"><b>Why are you cancelling?</b><p class="muted sm">${fee ? 'The provider has arrived, so a ₹99 visit fee applies.' : 'There is no charge.'}</p>
    <div class="chips" style="margin:14px 0">${CANCEL_REASONS.map(r => `<button class="chip ${C.cancelReason === r ? 'on' : ''}" data-reason="${r}">${r}</button>`).join('')}</div>
    <div class="row"><button class="btn dark grow" id="cancelgo" ${C.cancelReason ? '' : 'disabled'}>Cancel request</button><button class="btn grow" id="cancelkeep">Keep it</button></div></div>`;
}
function cActivity() {
  const h = C.history;
  return `<div class="h2" style="margin:18px 0 6px">Activity</div><p class="muted sm" style="margin-bottom:12px">Your past requests and receipts.</p>
    ${h.length ? h.map(j => `<div class="list-row"><span class="svc-ic sm">${S.svc[j.service].icon}</span><div class="grow"><b>${S.svc[j.service].name}</b><div class="muted xs">${new Date(j.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · ${hhmm(j.createdAt)}${j.provider ? ' · ' + esc(j.provider.name) : ''}</div></div><div style="text-align:right"><b class="sm">${rupee(j.finalAmount || j.quote.total)}</b><div><span class="st ${j.status}">${STATUS_TEXT[j.status]}</span></div></div></div>`).join('') : '<div class="card soft center"><p class="muted">No requests yet. We hope you never need us, but we are here.</p></div>'}`;
}
function cAccount() {
  const u = C.profile || C.user, v = u.vehicle || {}, cs = u.contacts || [];
  return `<div class="row" style="margin:18px 0 22px"><div class="avatar">${initials(u.name)}</div><div class="grow"><div class="h2">${esc(u.name)}</div><div class="muted sm">+91 ${esc(u.phone)}</div></div></div>
    <div class="shield"><div class="row">${ic('shield', 22)}<b class="grow">OnSpot Shield${u.shield ? ' · Active' : ''}</b>${u.shield ? '' : '<b>₹99<span class="muted sm"> / month</span></b>'}</div>
      <p class="muted sm" style="margin:8px 0 14px">${u.shield ? `No platform fee and priority dispatch on every request. Renews ${new Date(u.shieldUntil).toLocaleDateString()}.` : 'No platform fee on any request, and priority dispatch with a wider search from the first second.'}</p>
      ${u.shield ? '<button class="btn sm" style="background:transparent;color:#fff" id="shieldoff">Cancel plan</button>' : '<button class="btn sm" style="background:#fff;color:#222" id="shieldon">Activate (demo, no charge)</button>'}</div>
    <h3 class="sec">My vehicle</h3>
    <label class="field"><span class="label">Make and model</span><input class="input" id="vmodel" value="${esc(v.model)}" placeholder="Maruti Swift"></label>
    <div class="row" style="align-items:flex-start"><label class="field grow"><span class="label">Number plate</span><input class="input" id="vplate" value="${esc(v.plate)}" placeholder="MH 12 AB 1234"></label><label class="field" style="width:110px"><span class="label">Fuel</span><select class="input" id="vfuel">${['petrol', 'diesel', 'cng', 'ev'].map(f => `<option value="${f}" ${v.fuel === f ? 'selected' : ''}>${f.toUpperCase()}</option>`).join('')}</select></label></div>
    <button class="btn soft block" id="savevehicle">Save vehicle</button>
    <h3 class="sec">Emergency contacts</h3><p class="muted sm" style="margin:-6px 0 12px">They receive your live location when you press SOS.</p>
    ${[0, 1, 2].map(i => `<div class="row" style="margin-bottom:8px"><input class="input" data-cn="${i}" value="${esc(cs[i]?.name)}" placeholder="Name"><input class="input" data-cp="${i}" value="${esc(cs[i]?.phone)}" placeholder="Phone" inputmode="numeric" maxlength="10"></div>`).join('')}
    <button class="btn soft block" id="savecontacts">Save contacts</button>
    <div class="divider"></div>
    <button class="btn danger block" id="signout">Sign out</button>`;
}
function billLines(j) {
  return j.quote.items.map(i => `<div class="li"><span>${esc(i.label)}</span><span>${rupee(i.amount)}</span></div>`).join('')
    + j.addons.filter(a => a.status === 'approved').map(a => `<div class="li extra"><span>${esc(a.label)} (approved)</span><span>${rupee(a.amount)}</span></div>`).join('');
}
function cBill(j) {
  const extras = j.finalAmount - j.quote.total;
  return `
    <div class="steps">${[1, 2, 3, 4, 5].map(() => '<div class="on"></div>').join('')}</div>
    <div class="h2">Job done — review & pay</div>
    <p class="muted sm">${esc(j.provider?.name)} completed ${S.svc[j.service].name.toLowerCase()} at ${hhmm(j.completedAt)}.</p>
    <div class="card"><div class="bill">${billLines(j)}<div class="li total"><span>Total payable</span><span>${rupee(j.finalAmount)}</span></div></div></div>
    <div class="lock">${ic('check', 18)}<span><b>${extras ? `Locked fare ${rupee(j.quote.total)} + ${rupee(extras)} extras you approved.` : 'Matches your locked fare exactly.'}</b> Nothing else can be added.</span></div>
    <div class="label" style="margin:14px 0 8px">Pay with</div>
    ${[['upi', 'UPI (GPay / PhonePe / Paytm)', 'upi'], ['card', 'Debit / credit card', 'card'], ['cash', 'Cash to provider', 'cash']].map(([v, l, i]) => `<label class="opt ${C.payMethod === v ? 'on' : ''}"><input type="radio" name="pay" value="${v}" ${C.payMethod === v ? 'checked' : ''}><span class="opt-ic">${ic(i, 18)}</span><span class="grow sm"><b>${l}</b></span></label>`).join('')}
    <div class="sticky-cta"><button class="btn primary block lg" id="pay">Pay ${rupee(j.finalAmount)}</button></div>`;
}
function cRate(j) {
  return `
    <div class="big-ok">${ic('check', 30)}</div>
    <div class="center"><div class="h2">Paid ${rupee(j.payment.amount)}</div><p class="muted sm">Ref ${j.payment.ref} · ${j.payment.method.toUpperCase()}</p></div>
    <div class="card center"><div class="h3">How was ${esc(j.provider?.name)}?</div>
      <div class="stars">${[1, 2, 3, 4, 5].map(i => `<button data-star="${i}" class="${i <= C.stars ? 'on' : ''}" aria-label="${i} stars">★</button>`).join('')}</div>
      <textarea class="input" id="comment" rows="2" placeholder="Anything to share? (optional)"></textarea>
      <div class="chips" style="justify-content:center;margin-top:10px">${['Arrived fast', 'Fair & honest', 'Polite', 'Skilled'].map(t => `<button class="chip" data-tag="${t}">${t}</button>`).join('')}</div>
    </div>
    <button class="btn primary block lg" id="rate">Submit rating</button>`;
}
function cDone(j) {
  return `
    <div class="big-ok">${ic('check', 30)}</div>
    <div class="center"><div class="h2">Thanks — you're good to go!</div><p class="muted sm">Receipt sent · Ref ${j.payment.ref}</p></div>
    <div class="card"><div class="bill">${billLines(j)}<div class="li total"><span>Paid via ${j.payment.method.toUpperCase()}</span><span>${rupee(j.finalAmount)}</span></div></div></div>
    <button class="btn primary block lg" id="newreq">Done</button>`;
}
function cEnded(j) {
  const np = j.status === 'NO_PROVIDER';
  return `
    <div class="big-ok" style="background:var(--danger-soft);color:var(--danger)">${ic('x', 30)}</div>
    <div class="center"><div class="h2">${np ? 'No provider available right now' : 'Request cancelled'}</div>
    <p class="muted sm">${np ? 'We searched up to 50 km. Try again in a minute — or use these helplines:' : (j.cancelFee ? `A visit fee of ${rupee(j.cancelFee)} applies as the provider had arrived.` : 'No charge was applied.')}</p></div>
    ${np ? `<div class="card"><div class="bill"><div class="li"><span>National emergency</span><a href="tel:112"><b>112</b></a></div><div class="li"><span>NHAI highway helpline</span><a href="tel:1033"><b>1033</b></a></div></div></div>` : ''}
    <div class="row"><button class="btn primary grow" id="retry">Try again</button><button class="btn grow" id="newreq">Home</button></div>`;
}
function timeline(j) {
  return `<div class="label" style="margin:16px 0 10px">Timeline</div><ul class="timeline">${j.events.slice().reverse().map(e => `<li><time>${hhmm(e.t)}</time><span>${esc(e.text)}</span></li>`).join('')}</ul>`;
}

function bindCustomer(el) {
  const on = (id, fn) => { const b = $('#' + id, el); if (b) b.onclick = fn; };
  $$('[data-svc]', el).forEach(b => b.onclick = () => { C.sel = b.dataset.svc; C.quote = null; C.drop = null; C.dropIdx = 0; renderCustomer(); refreshQuote(); });
  on('gps', () => locate(ll => { C.pickup = ll; C.locLabel = 'Your current location (GPS)'; S.map.setView([ll.lat, ll.lng], 14); onPickupChange(); }, () => toast('Location blocked — tap the map to set your spot', 'err')));
  const lm = $('#landmark', el); if (lm) { lm.oninput = () => { C.landmark = lm.value; }; lm.onkeydown = e => { if (e.key === 'Enter') { C.editWhere = false; renderCustomer(); } }; }
  on('where', () => { C.editWhere = !C.editWhere; renderCustomer(); if (C.editWhere) $('#landmark')?.focus({ preventScroll: true }); });
  const saveProfile = async (patch, msg) => { const d = await api(`/users/${C.user.id}/profile`, patch); C.profile = d.user; toast(msg, 'ok'); renderCustomer(); };
  on('shieldon', () => act(() => saveProfile({ shield: true }, 'Shield is active. Platform fee waived.')));
  on('shieldoff', () => act(() => saveProfile({ shield: false }, 'Shield cancelled')));
  on('gotoshield', () => setTab('account'));
  on('savevehicle', () => act(() => saveProfile({ vehicle: { model: $('#vmodel').value.trim(), plate: $('#vplate').value.trim(), fuel: $('#vfuel').value } }, 'Vehicle saved')));
  on('savecontacts', () => act(() => saveProfile({ contacts: [0, 1, 2].map(i => ({ name: $(`[data-cn="${i}"]`).value, phone: $(`[data-cp="${i}"]`).value })).filter(c => c.name.trim() || c.phone.trim()) }, 'Emergency contacts saved')));
  on('signout', () => { store.del('cust'); C.profile = null; C.job = null; C.tab = 'home'; router(); });
  on('chat', () => { C.chatOpen = !C.chatOpen; C.seen = (C.job.messages || []).length; renderCustomer(); if (C.chatOpen) $('#chatinput')?.focus({ preventScroll: true }); });
  if (C.chatOpen && C.job) bindChat(el, C, text => api(`/jobs/${C.job.id}/message`, { customerId: C.user.id, text }));
  $$('[data-reason]', el).forEach(b => b.onclick = () => { C.cancelReason = b.dataset.reason; renderCustomer(); });
  on('cancelkeep', () => { C.cancelOpen = false; C.cancelReason = ''; renderCustomer(); });
  on('cancelgo', () => act(async () => { await api(`/jobs/${C.job.id}/cancel`, { customerId: C.user.id, reason: C.cancelReason }); C.cancelOpen = false; C.cancelReason = ''; }));
  on('history', async () => {
    const { jobs } = await api(`/users/${C.user.id}/jobs`);
    $('#hist').innerHTML = jobs.length ? `<div class="card" style="margin-top:10px">${jobs.map(j => `<div class="row" style="padding:6px 0"><span>${S.svc[j.service].icon}</span><div class="grow sm"><b>${S.svc[j.service].name}</b> · ${new Date(j.createdAt).toLocaleDateString()} ${hhmm(j.createdAt)}</div><span class="st ${j.status}">${j.status.replace('_', ' ')}</span><b class="sm">${rupee(j.finalAmount || j.quote.total)}</b></div>`).join('')}</div>` : '<p class="muted sm">No requests yet.</p>';
  });
  on('back', () => { C.sel = null; C.quote = null; C.pickDrop = false; renderCustomer(); });
  $$('input[name=drop]', el).forEach(r => r.onchange = () => { const g = garages()[+r.value]; C.drop = { lat: g.lat, lng: g.lng }; C.dropIdx = +r.value; refreshQuote(); });
  on('pickdrop', () => { C.pickDrop = !C.pickDrop; renderCustomer(); if (C.pickDrop) toast('Tap the map where the vehicle should be towed'); });
  const n = $('#night', el); if (n) n.onchange = () => { C.night = n.checked; refreshQuote(); };
  const notes = $('#notes', el); if (notes) notes.oninput = () => { C.notes = notes.value; };
  on('request', () => act(async () => {
    $('#request').disabled = true;
    const pickup = { ...C.pickup, label: C.landmark || C.locLabel };
    const v = C.profile?.vehicle;
    const d = await api('/jobs', { customerId: C.user.id, service: C.sel, pickup, drop: C.sel === 'tow' ? C.drop : null, notes: C.notes, vehicle: v ? `${v.model} ${v.plate}`.trim() : '', night: C.night || undefined });
    C.job = d.job; renderCustomer();
  }).finally(() => { const b = $('#request'); if (b) b.disabled = false; }));
  on('cancel', () => { C.cancelOpen = true; renderCustomer(); $('#cancelcard')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  $$('[data-addon]', el).forEach(b => b.onclick = () => act(() => api(`/jobs/${C.job.id}/addon-decision`, { customerId: C.user.id, addonId: b.dataset.addon, approve: b.dataset.ok === '1' })));
  on('sos', () => { if (confirm('Raise SOS? Ops team and your emergency contacts will be alerted with your live location.')) act(async () => { const r = await api(`/jobs/${C.job.id}/sos`, { customerId: C.user.id }); toast(r.notified ? `SOS sent. Ops alerted and ${r.notified} contact(s) notified.` : 'SOS sent. Ops will call you. Add emergency contacts in Account.', 'err'); }); });
  on('share', async () => {
    const j = C.job, p = j.provider;
    const text = `I'm getting ${S.svc[j.service].name} help via OnSpot from ${p.name} (${p.vehicle || 'verified provider'}). Track live: ${location.origin}/#/track/${j.id}`;
    try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); toast('Trip details copied — paste to family/friends', 'ok'); } } catch { }
  });
  $$('input[name=pay]', el).forEach(r => r.onchange = () => { C.payMethod = r.value; renderCustomer(); });
  on('pay', () => act(async () => { $('#pay').disabled = true; await new Promise(r => setTimeout(r, 700)); await api(`/jobs/${C.job.id}/pay`, { customerId: C.user.id, method: C.payMethod }); }));
  $$('[data-star]', el).forEach(b => b.onclick = () => { C.stars = +b.dataset.star; $$('[data-star]', el).forEach(x => x.classList.toggle('on', +x.dataset.star <= C.stars)); });
  $$('[data-tag]', el).forEach(b => b.onclick = () => b.classList.toggle('on'));
  on('rate', () => act(() => api(`/jobs/${C.job.id}/rate`, { customerId: C.user.id, stars: C.stars, comment: [$('#comment').value, ...$$('.chip.on', el).map(c => c.dataset.tag)].filter(Boolean).join(' · ') })));
  on('newreq', () => { C.chatOpen = false; C.seen = 0; C.draft = ''; C.job = null; C.sel = null; C.quote = null; C.notes = ''; C.stars = 5; renderCustomer(); onPickupChange(); });
  on('retry', () => { const s = C.job.service; C.job = null; C.sel = s; renderCustomer(); refreshQuote(); });
}

// ================================================================== PROVIDER
const P = { user: null, me: null, job: null, offers: [], addonOpen: false, stars: 5, history: [], draft: '', chatFocus: false };
const loadProviderHistory = () => api(`/users/${P.user.id}/jobs`).then(d => { P.history = d.jobs.filter(j => ['PAID', 'COMPLETED'].includes(j.status)); renderProvider(); }).catch(() => { });

async function providerApp() {
  P.user = store.get('prov');
  if (!P.user) return loginView('provider');
  appShell('Partner', true);
  $('#logout').onclick = () => { store.del('prov'); router(); };
  const ok = await act(async () => {
    const d = await api(`/providers/${P.user.id}`);
    P.me = d.provider; P.job = d.activeJob; P.offers = d.offers.map(o => ({ ...o, at: Date.now() }));
    return true;
  });
  if (!ok) { store.del('prov'); return loginView('provider'); }
  initMap(P.me.lat != null ? P.me : S.cfg.center, 13);
  connect(P.user.id, {
    offer: o => { if (P.job && ACTIVE.includes(P.job.status)) return; P.offers = P.offers.filter(x => x.jobId !== o.jobId).concat({ ...o, at: Date.now() }); beep(); renderProvider(); },
    offer_revoked: ({ jobId }) => { if (P.offers.some(o => o.jobId === jobId)) { P.offers = P.offers.filter(o => o.jobId !== jobId); toast('Job was taken by another provider'); renderProvider(); } },
    job: j => {
      if (P.job && P.job.id !== j.id && ACTIVE.includes(P.job.status)) return;
      const prev = P.job?.status, prevMsgs = (P.job?.messages || []).length; P.job = j;
      const msgs = j.messages || []; if (msgs.length > prevMsgs && msgs[msgs.length - 1].from === 'customer') beep();
      if (prev && prev !== j.status) {
        if (j.status === 'CANCELLED') toast('Job cancelled', 'err');
        if (j.status === 'PAID') toast(`Payment received · ${rupee(j.finalAmount)}`, 'ok');
      }
      const ad = j.addons.filter(a => a.status !== 'pending').length;
      if (P._ad != null && ad > P._ad) { const last = j.addons.filter(a => a.status !== 'pending').pop(); toast(`Customer ${last.status} ${last.label}`, last.status === 'approved' ? 'ok' : 'err'); }
      P._ad = ad;
      renderProvider();
    },
    kyc: k => { P.me.kyc = k.kyc; toast(k.kyc === 'verified' ? 'KYC approved. You can go online now.' : 'KYC rejected. Please resubmit.', k.kyc === 'verified' ? 'ok' : 'err'); renderProvider(); },
    loc: l => { if (P.job && l.jobId === P.job.id) { P.me.lat = l.lat; P.me.lng = l.lng; P.job.eta = l.eta; drawProviderMap(); const e = $('#peta'); if (e) e.textContent = l.eta + ' min away'; } },
  });
  S.timer = setInterval(tickOffers, 1000);
  renderProvider(); loadProviderHistory();
  if (P.me.lat == null) locate(ll => saveStatus({ lat: ll.lat, lng: ll.lng }), () => saveStatus({ lat: S.cfg.center.lat, lng: S.cfg.center.lng }));
  else fit([P.me, P.job?.pickup]);
}
function tickOffers() {
  let changed = false;
  for (const o of P.offers) {
    const left = Math.max(0, o.expiresIn - Math.floor((Date.now() - o.at) / 1000));
    const t = $(`[data-cd="${o.jobId}"]`); if (t) t.textContent = left + 's';
    const bar = $(`[data-bar="${o.jobId}"]`); if (bar) bar.style.width = (left / o.expiresIn * 100) + '%';
    if (left <= 0) { o.expired = true; changed = true; api(`/jobs/${o.jobId}/decline`, { providerId: P.me.id }).catch(() => { }); }
  }
  if (changed) { P.offers = P.offers.filter(o => !o.expired); renderProvider(); }
}
async function saveStatus(patch) {
  return act(async () => { const d = await api(`/providers/${P.me.id}/status`, patch); P.me = d.provider; renderProvider(); if (patch.lat != null) S.map?.setView([P.me.lat, P.me.lng], 13); return true; });
}
function drawProviderMap() {
  if (!S.map || !P.me) return;
  const j = P.job && ACTIVE.includes(P.job.status) ? P.job : null;
  const svcIcon = S.svc[(j?.service) || P.me.services[0]]?.icon || ic('mechanic');
  const m = setMarker('me', P.me, icon('assigned', svcIcon), { draggable: !j, zIndexOffset: 1000 });
  if (m && !m._bound) { m._bound = true; m.on('dragend', e => { const p = e.target.getLatLng(); saveStatus({ lat: p.lat, lng: p.lng }); }); }
  if (m) j ? m.dragging?.disable() : m.dragging?.enable();
  setMarker('cust', j?.pickup, icon('me'));
  setLine('route', j && j.status === 'ASSIGNED' ? P.me : null, j?.pickup);
  setGroup('offers', P.offers.map(o => L.marker([o.pickup.lat, o.pickup.lng], { icon: icon('job', S.svc[o.service].icon), interactive: false })));
}
function renderProvider() {
  const el = $('#sheet'); if (!el || !P.me) return;
  P.chatFocus = document.activeElement?.id === 'chatinput';
  const j = P.job;
  let html = '';
  if (P.offers.length && !(j && ACTIVE.includes(j.status))) html += P.offers.map(pOffer).join('');
  if (j && (ACTIVE.includes(j.status) || ['COMPLETED', 'PAID', 'CANCELLED'].includes(j.status) && !j._dismissed)) html += pJob(j) + (ACTIVE.includes(j.status) ? chatPanel(j, 'provider') : '');
  else html += pDashboard();
  el.innerHTML = '<div class="grab"></div>' + html;
  bindProvider(el);
  drawProviderMap();
}
function pOffer(o) {
  const s = S.svc[o.service], left = Math.max(0, o.expiresIn - Math.floor((Date.now() - o.at) / 1000));
  return `
    <div class="offer">
      <div class="row"><span class="svc-ic">${s.icon}</span><div class="grow"><div class="label" style="color:var(--accent)">New request · ${s.name}</div><div class="h3">${esc(o.customerName)} · ${o.km} km away</div><div class="muted xs">${esc(o.pickup.label || '')}</div></div><span class="pill accent" data-cd="${o.jobId}">${left}s</span></div>
      <div class="row" style="margin-top:10px"><div class="grow"><div class="muted xs">You earn (after 10% commission)</div><div class="earn">${rupee(o.payout)}</div></div><div class="muted xs" style="text-align:right">Customer pays<br><b>${rupee(o.fare)}</b> (locked)</div></div>
      <div class="bar"><i data-bar="${o.jobId}" style="width:${left / o.expiresIn * 100}%"></i></div>
      <div class="row"><button class="btn ok grow lg" data-accept="${o.jobId}">Accept</button><button class="btn lg" data-decline="${o.jobId}">Decline</button></div>
    </div>`;
}
function pDashboard() {
  const m = P.me;
  const today = new Date().toDateString();
  const todays = P.history.filter(j => new Date(j.completedAt || j.createdAt).toDateString() === today);
  return `
    <div class="earn-hero">
      <div class="label" style="color:rgba(255,255,255,.7)">Today's earnings</div>
      <div class="eh-big">${rupee(todays.reduce((t, j) => t + (j.providerPayout || 0), 0))}</div>
      <div class="eh-stats"><div><b>${todays.length}</b><span>jobs today</span></div><div><b>★ ${(+m.rating).toFixed(1)}</b><span>rating</span></div><div><b>${rupee(m.earnings)}</b><span>all time</span></div></div>
    </div>
    <button class="go-online ${m.online ? 'on' : ''}" id="online"><span class="dot"></span>${m.online ? "You're online · tap to go offline" : 'Go online'}</button>
    ${pKyc(m)}
    ${pEarnings()}
    <h3 class="sec">Services I offer</h3>
    <div class="chips">${S.services.map(s => `<button class="chip ${m.services.includes(s.code) ? 'on' : ''}" data-svc="${s.code}">${s.name}</button>`).join('')}</div>
    <h3 class="sec">Vehicle or shop</h3>
    <input class="input" id="vehicle" value="${esc(m.vehicle)}" placeholder="Vehicle number, e.g. MH 12 AB 1234" maxlength="20">
    <h3 class="sec">My location</h3>
    <div class="row"><button class="btn sm soft grow" id="gps">${ic('nav', 15)} Use my GPS</button><button class="btn sm soft grow" id="demo">Demo area (Lonavala)</button></div>
    <p class="muted xs" style="margin-top:10px">You can also drag your marker on the map. Be close to the customer's pin to get offers before the simulated pros.</p>`;
}

function pKyc(m) {
  if (m.kyc === 'verified') return '';
  if (m.kyc === 'submitted') return `<div class="banner warn">${ic('clock', 18)}<span class="grow sm"><b>KYC under review.</b> Usually within 24 hours. In this demo, approve it from the <a href="#/admin" target="_blank">Ops console</a>.</span></div>`;
  return `<div class="card">
    <div class="row" style="margin-bottom:12px">${ic('id', 20)}<div class="grow"><b>${m.kyc === 'rejected' ? 'KYC rejected. Please resubmit.' : 'Verify your identity to go online'}</b><div class="muted xs">Required before you can receive jobs. Earns you the Verified badge.</div></div></div>
    <div class="row"><label class="field" style="width:120px"><span class="label">ID type</span><select class="input" id="kid"><option value="aadhaar">Aadhaar</option><option value="pan">PAN</option></select></label><label class="field grow"><span class="label">Last 4 digits</span><input class="input" id="klast4" inputmode="numeric" maxlength="4" placeholder="1234"></label></div>
    <label class="field"><span class="label">Driving licence number</span><input class="input" id="kdl" maxlength="20" placeholder="MH12 20190001234"></label>
    <label class="field"><span class="label">UPI ID for payouts</span><input class="input" id="kupi" maxlength="50" placeholder="name@okbank"></label>
    <button class="btn dark block" id="kycsubmit">Submit for verification</button>
  </div>`;
}
function pEarnings() {
  return `<h3 class="sec">Recent jobs</h3>
    ${P.history.length ? P.history.slice(0, 5).map(j => `<div class="list-row"><span class="svc-ic sm">${S.svc[j.service].icon}</span><div class="grow"><b class="sm">${esc(j.customerName)}</b><div class="muted xs">${S.svc[j.service].name} · ${hhmm(j.completedAt || j.createdAt)}${j.ratings?.customer ? ' · ★ ' + j.ratings.customer.stars : ''}</div></div><b class="sm">${rupee(j.providerPayout)}</b></div>`).join('') + '<p class="muted xs" style="margin-top:8px">Payouts go to your UPI ID the next day.</p>' : '<div class="card soft center"><p class="muted sm">Your completed jobs and payouts will show here.</p></div>'}`;
}

function pJob(j) {
  const s = S.svc[j.service];
  const head = `<div class="row" style="margin-bottom:12px"><span class="svc-ic">${s.icon}</span><div class="grow"><div class="label">${s.name} · ${j.id}</div><div class="h3">${esc(j.customerName)} <span class="muted sm">${esc(j.customerPhone)}</span></div><div class="muted xs">${esc(j.pickup.label || '')}${j.notes ? ' · “' + esc(j.notes) + '”' : ''}</div></div><a class="iconbtn" href="tel:0000000000" title="Call customer (masked)">${ic('phone', 18)}</a></div>`;
  const nav = `https://www.google.com/maps/dir/?api=1&destination=${j.pickup.lat},${j.pickup.lng}`;
  const pending = j.addons.some(a => a.status === 'pending');
  const addons = j.addons.length ? `<div class="card"><div class="label" style="margin-bottom:8px">Extra items</div><div class="bill">${j.addons.map(a => `<div class="li"><span>${esc(a.label)} <span class="st ${a.status === 'approved' ? 'PAID' : a.status === 'rejected' ? 'CANCELLED' : 'SEARCHING'}">${a.status}</span></span><span>${rupee(a.amount)}</span></div>`).join('')}</div></div>` : '';
  switch (j.status) {
    case 'ASSIGNED': return head + `
      <div class="status-line"><div class="h2">Head to customer</div><div class="h3" style="color:var(--accent)" id="peta">${j.eta} min away</div></div>
      <div class="card soft"><div class="row"><div class="grow sm">Locked fare <b>${rupee(j.quote.total)}</b>${j.drop ? ` · tow ${j.quote.towKm} km` : ''}</div></div></div>
      <div class="stack"><a class="btn dark block" href="${nav}" target="_blank" rel="noopener">${ic('nav', 16)} Navigate in Google Maps</a>
      <button class="btn block" id="simulate" ${j.simulate ? 'disabled' : ''}>${j.simulate ? 'Driving (simulated)…' : 'Simulate drive to customer'}</button>
      <button class="btn primary block lg" id="arrived">I've arrived</button>
      <button class="btn danger block sm" id="pcancel">Can't make it — release job</button></div>`;
    case 'ARRIVED': return head + `
      <div class="h2">Ask customer for the 4-digit OTP</div><p class="muted sm">The job can only start once you enter the code shown in the customer's app.</p>
      <input class="input" id="otp" inputmode="numeric" maxlength="4" placeholder="• • • •" style="font-size:28px;text-align:center;letter-spacing:.5em;font-weight:800">
      <button class="btn primary block lg" id="start" style="margin-top:12px">Verify & start job</button>`;
    case 'IN_PROGRESS': return head + `
      <div class="status-line"><div class="h2">Job in progress</div><span class="pill">since ${hhmm(j.startedAt)}</span></div>
      ${addons}
      <div class="card soft">
        <div class="row"><div class="grow"><b class="sm">Need parts / tolls / extra work?</b><div class="muted xs">Customer must approve in their app before it's billed.</div></div><button class="btn sm" id="addontoggle">${P.addonOpen ? 'Close' : '+ Add item'}</button></div>
        ${P.addonOpen ? `<div style="margin-top:12px"><input class="input" id="al" placeholder="Item e.g. New tube" maxlength="60" style="margin-bottom:8px"><div class="row"><input class="input" id="aa" inputmode="numeric" placeholder="Amount ₹"><input class="input" id="ar" placeholder="Reason" maxlength="120"></div><button class="btn dark block" id="addonsend" style="margin-top:8px">Send for approval</button></div>` : ''}
      </div>
      <button class="btn ok block lg" id="complete" ${pending ? 'disabled' : ''}>${pending ? 'Waiting for customer approval…' : 'Mark job complete'}</button>`;
    case 'COMPLETED': return head + `
      <div class="big-ok">${ic('check', 30)}</div><div class="center"><div class="h2">Job complete</div><p class="muted">Customer is paying <b>${rupee(j.finalAmount)}</b> in the app.</p></div>
      <div class="card"><div class="bill"><div class="li"><span>Customer total</span><span>${rupee(j.finalAmount)}</span></div><div class="li"><span>Platform fee + 10% commission</span><span>− ${rupee(j.finalAmount - j.providerPayout)}</span></div><div class="li total"><span>You earn</span><span>${rupee(j.providerPayout)}</span></div></div></div>`;
    case 'PAID': return head + `
      <div class="big-ok">${ic('check', 30)}</div><div class="center"><div class="h2">Payment received</div><p class="muted">${rupee(j.finalAmount)} via ${j.payment.method.toUpperCase()} · you earn <b>${rupee(j.providerPayout)}</b> (payout T+1)</p></div>
      ${j.ratings.provider ? '' : `<div class="card center"><div class="h3">Rate ${esc(j.customerName)}</div><div class="stars">${[1, 2, 3, 4, 5].map(i => `<button data-star="${i}" class="${i <= P.stars ? 'on' : ''}">★</button>`).join('')}</div></div>`}
      <button class="btn primary block lg" id="dismiss">${j.ratings.provider ? 'Back to dashboard' : 'Submit & back to dashboard'}</button>`;
    case 'CANCELLED': return head + `<div class="big-ok" style="background:var(--danger-soft);color:var(--danger)">${ic('x', 30)}</div><div class="center"><div class="h2">Job cancelled</div><p class="muted">${j.cancelFee ? `Customer cancelled after arrival — you receive the ${rupee(j.cancelFee)} visit fee.` : 'No action needed.'}</p></div><button class="btn primary block" id="dismiss">Back to dashboard</button>`;
  }
  return '';
}
function bindProvider(el) {
  const on = (id, fn) => { const b = $('#' + id, el); if (b) b.onclick = fn; };
  const jid = P.job?.id, pid = P.me.id;
  on('online', () => saveStatus({ online: !P.me.online }).then(ok => { if (ok) toast(P.me.online ? "You're online. Keep this screen open." : 'You are offline', P.me.online ? 'ok' : ''); }));
  on('kycsubmit', () => saveStatus({ kyc: { idType: $('#kid').value, idLast4: $('#klast4').value.trim(), dl: $('#kdl').value.trim(), upi: $('#kupi').value.trim() } }).then(ok => { if (ok) toast('KYC submitted for review', 'ok'); }));
  if (P.job && ACTIVE.includes(P.job.status)) bindChat(el, P, text => api(`/jobs/${jid}/message`, { providerId: pid, text }));
  const o = $('#online', el); if (o) o.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); o.click(); } };
  $$('[data-svc]', el).forEach(b => b.onclick = () => { const s = b.dataset.svc, list = P.me.services.includes(s) ? P.me.services.filter(x => x !== s) : [...P.me.services, s]; saveStatus({ services: list }); });
  const v = $('#vehicle', el); if (v) v.onchange = () => saveStatus({ vehicle: v.value.toUpperCase() });
  on('gps', () => locate(ll => saveStatus({ lat: ll.lat, lng: ll.lng }), () => toast('Location blocked — drag your marker instead', 'err')));
  on('demo', () => saveStatus({ lat: S.cfg.center.lat + 0.01, lng: S.cfg.center.lng + 0.01 }));
  $$('[data-accept]', el).forEach(b => b.onclick = () => act(async () => {
    const d = await api(`/jobs/${b.dataset.accept}/accept`, { providerId: pid });
    P.job = d.job; P.offers = []; P._ad = 0; fit([P.me, P.job.pickup]); renderProvider(); toast('Job accepted — head to the customer', 'ok');
  }).then(r => { if (!r) { P.offers = P.offers.filter(x => x.jobId !== b.dataset.accept); renderProvider(); } }));
  $$('[data-decline]', el).forEach(b => b.onclick = () => { api(`/jobs/${b.dataset.decline}/decline`, { providerId: pid }).catch(() => { }); P.offers = P.offers.filter(x => x.jobId !== b.dataset.decline); renderProvider(); });
  on('simulate', () => act(async () => { await api(`/jobs/${jid}/simulate`, { providerId: pid }); P.job.simulate = true; renderProvider(); }));
  on('arrived', () => act(() => api(`/jobs/${jid}/arrived`, { providerId: pid })));
  on('pcancel', () => { if (confirm('Release this job? It will be re-assigned and may affect your acceptance score.')) act(() => api(`/jobs/${jid}/cancel`, { providerId: pid })); });
  on('start', () => act(() => api(`/jobs/${jid}/start`, { providerId: pid, otp: $('#otp').value.trim() })));
  const otp = $('#otp', el); if (otp) { if (!P.chatFocus) otp.focus({ preventScroll: true }); otp.onkeydown = e => { if (e.key === 'Enter') $('#start').click(); }; }
  on('addontoggle', () => { P.addonOpen = !P.addonOpen; renderProvider(); });
  on('addonsend', () => act(async () => { await api(`/jobs/${jid}/addon`, { providerId: pid, label: $('#al').value.trim(), amount: $('#aa').value, reason: $('#ar').value.trim() }); P.addonOpen = false; toast('Sent to customer for approval'); }));
  on('complete', () => act(() => api(`/jobs/${jid}/complete`, { providerId: pid })));
  $$('[data-star]', el).forEach(b => b.onclick = () => { P.stars = +b.dataset.star; $$('[data-star]', el).forEach(x => x.classList.toggle('on', +x.dataset.star <= P.stars)); });
  on('dismiss', async () => {
    if (P.job.status === 'PAID' && !P.job.ratings.provider) await api(`/jobs/${jid}/rate`, { providerId: pid, stars: P.stars }).catch(() => { });
    const d = await api(`/providers/${pid}`); P.me = d.provider; P.job = null; P.stars = 5; P.draft = ''; renderProvider(); loadProviderHistory();
  });
}

// ================================================================== ADMIN
async function adminApp() {
  $('#root').innerHTML = `
  <div class="admin">
    <header class="topbar"><a class="brand" href="#/">${LOGO}OnSpot</a><span class="tb-sub">Ops console</span><span class="spacer"></span><span class="pill" id="live"><span class="dot"></span>Live</span><button class="btn sm" id="reset">Reset demo</button></header>
    <div class="admin-wrap">
      <div class="stats" id="stats"></div>
      <div class="admin-grid"><div class="panel"><h3>Live map</h3><div id="map" class="admin-map"></div></div><div class="panel"><h3>Recent jobs</h3><div class="jobs-list" id="jobs"></div></div></div>
      <div class="panel" id="kycpanel"></div>
      <div class="panel"><h3>Providers</h3><div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Status</th><th>Services</th><th>Rating</th><th>Jobs</th><th>Earnings</th><th>KYC</th><th>Type</th></tr></thead><tbody id="provs"></tbody></table></div></div>
    </div>
  </div>`;
  initMap(S.cfg.center, 12);
  let first = true, t = null;
  const load = async () => {
    const d = await api('/admin/overview').catch(() => null); if (!d) return;
    const s = d.stats;
    $('#stats').innerHTML = [['Online providers', `${s.online}/${s.providers}`], ['Active jobs', s.active], ['Completed', s.completed], ['Match rate', s.matchRate + '%'], ['Avg time to match', s.avgMatchSec + 's'], ['GMV', rupee(s.gmv)], ['Platform revenue', rupee(s.revenue)], ['No provider', s.noProvider]]
      .map(([l, v]) => `<div class="stat"><span>${l}</span><b>${v}</b></div>`).join('');
    $('#jobs').innerHTML = d.jobs.length ? d.jobs.map(j => `<div class="job-row"><span class="svc-ic sm">${S.svc[j.service].icon}</span><div><b>${esc(j.customerName)}</b> · ${S.svc[j.service].name}<div class="muted xs">${hhmm(j.createdAt)} · ${j.provider ? esc(j.provider.name) : '—'} · ${rupee(j.finalAmount || j.quote.total)}${j.events.some(e => e.text.includes('SOS')) ? ' · <b style="color:var(--danger)">SOS</b>' : ''}</div></div><span class="st ${j.status}">${j.status.replace('_', ' ')}</span></div>`).join('') : '<p class="muted sm">No jobs yet. Create one from the customer app.</p>';
    const q = d.providers.filter(p => p.kyc === 'submitted');
    $('#kycpanel').innerHTML = `<h3>KYC queue${q.length ? ` <span class="unread">${q.length}</span>` : ''}</h3>` + (q.length ? q.map(p => `<div class="list-row"><div class="avatar" style="width:40px;height:40px;font-size:13px">${initials(p.name)}</div><div class="grow"><b>${esc(p.name)}</b><div class="muted xs">${p.kycDocs.idType} ••••${esc(p.kycDocs.idLast4)} · DL ${esc(p.kycDocs.dl)} · UPI ${esc(p.kycDocs.upi)} · ${p.services.map(s => S.svc[s]?.name).join(', ')}</div></div><button class="btn sm dark" data-kyc="${p.id}" data-ok="1">Approve</button><button class="btn sm" data-kyc="${p.id}" data-ok="0">Reject</button></div>`).join('') : '<p class="muted sm">No pending verifications.</p>');
    $('#provs').innerHTML = d.providers.map(p => `<tr><td><b>${esc(p.name)}</b><div class="muted xs">${esc(p.vehicle)}</div></td><td><span class="st ${p.activeJobId ? 'ASSIGNED' : p.online ? 'PAID' : ''}">${p.activeJobId ? 'On job' : p.online ? 'Online' : 'Offline'}</span></td><td>${p.services.map(s => S.svc[s]?.name).join(', ')}</td><td>★ ${(+p.rating).toFixed(1)}</td><td>${p.jobsDone}</td><td>${rupee(p.earnings)}</td><td>${p.kyc}</td><td>${p.bot ? 'Simulated' : 'Real'}</td></tr>`).join('');
    setGroup('provs', d.providers.filter(p => p.lat != null).map(p => L.marker([p.lat, p.lng], { icon: icon('pro' + (p.activeJobId ? '' : p.online ? '' : ' off'), S.svc[p.services[0]]?.icon || ic('mechanic')) }).bindTooltip(`${p.name} · ${p.online ? (p.activeJobId ? 'on job' : 'online') : 'offline'}`)));
    S.layers.provIndex = Object.fromEntries(S.layers.provs.getLayers().map((m, i) => [d.providers.filter(p => p.lat != null)[i].id, m]));
    setGroup('jobs', d.jobs.filter(j => ACTIVE.includes(j.status)).map(j => L.marker([j.pickup.lat, j.pickup.lng], { icon: icon('job', S.svc[j.service].icon) }).bindTooltip(`${j.customerName} · ${j.status}`)));
    if (first) { first = false; fit(d.providers.filter(p => p.online && p.lat != null)); }
  };
  const soon = () => { clearTimeout(t); t = setTimeout(load, 300); };
  connect('admin', {
    job: soon, provider: soon,
    loc: l => { const m = S.layers.provIndex?.[l.providerId]; if (m) m.setLatLng([l.lat, l.lng]); },
    sos: s => { toast(`SOS from ${s.customerName} — call them now`, 'err'); beep(); soon(); },
  });
  S.timer = setInterval(load, 8000);
  $('#kycpanel').onclick = e => { const b = e.target.closest('[data-kyc]'); if (b) act(async () => { await api(`/admin/providers/${b.dataset.kyc}/kyc`, { approve: b.dataset.ok === '1' }); toast(b.dataset.ok === '1' ? 'Provider verified' : 'KYC rejected', 'ok'); load(); }); };
  $('#reset').onclick = () => { if (confirm('Clear all jobs and reseed simulated providers?')) act(async () => { await api('/admin/reset', {}); first = true; load(); toast('Demo reset', 'ok'); }); };
  load();
}

// ================================================================== PUBLIC TRACKING (shared with family)
async function trackApp(id) {
  $('#root').innerHTML = `<div class="app"><header class="topbar"><a class="brand" href="#/">${LOGO}OnSpot</a><span class="tb-sub">Live trip</span></header><div id="map" class="map"></div><section id="sheet" class="sheet"></section></div>`;
  let first = true;
  const load = async () => {
    const d = await api(`/jobs/${id}?role=public`).catch(() => null);
    if (!d) { $('#sheet').innerHTML = '<div class="pad center"><div class="h2">Trip not found</div><p class="muted">The link may be wrong or expired.</p></div>'; return; }
    const j = d.job, s = S.svc[j.service], p = j.provider;
    if (!S.map) initMap(j.pickup);
    setMarker('me', j.pickup, icon('me'));
    setMarker('prov', p && ACTIVE.includes(j.status) ? p : null, icon('assigned', s.icon));
    setLine('route', p && j.status === 'ASSIGNED' ? p : null, j.pickup);
    if (first) { first = false; fit([j.pickup, p]); }
    $('#sheet').innerHTML = `<div class="grab"></div>
      <div class="label">${esc(j.customerName.split(' ')[0])} is getting help</div>
      <div class="h2" style="margin:4px 0 16px">${s.name} · ${STATUS_TEXT[j.status]}</div>
      ${j.status === 'ASSIGNED' ? `<div class="kpis"><div class="kpi"><b>${j.eta} min</b><span>arriving in</span></div><div class="kpi"><b>★ ${p.rating}</b><span>rating</span></div><div class="kpi"><b>${p.kyc === 'verified' ? 'Yes' : 'No'}</b><span>verified</span></div></div>` : ''}
      ${p ? `<div class="card"><div class="prov"><div class="avatar">${initials(p.name)}</div><div class="grow"><div class="h3">${esc(p.name)} ${p.kyc === 'verified' ? `<span class="badge">${ic('check', 12)}Verified</span>` : ''}</div>${p.vehicle ? `<span class="plate">${esc(p.vehicle)}</span>` : ''}</div></div></div>` : ''}
      <a class="btn danger block" href="tel:112">${ic('phone', 16)} Call 112 if something is wrong</a>
      ${timeline(j)}`;
  };
  await load();
  S.timer = setInterval(load, 3000);
}
