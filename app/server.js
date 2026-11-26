// OnSpot prototype server — zero dependencies (Node >= 18)
// REST API + Server-Sent Events + static files + dispatch engine + simulated providers.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 4000;
const PUBLIC = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data.json');

// ---------------------------------------------------------------- config
const PLATFORM_FEE = 19;
const COMMISSION = 0.10;
const NIGHT_PCT = 0.20;
const NIGHT_CAP = 150;
const ROAD_FACTOR = 1.35;
const AVG_KMPH = 32;
const RADIUS_STEPS = [ // [secondsElapsed, radiusKm]
  [0, 8], [12, 15], [25, 30], [40, 50],
];
const SEARCH_TIMEOUT_S = 120;
const ACTIVE_STATES = ['SEARCHING', 'ASSIGNED', 'ARRIVED', 'IN_PROGRESS'];
const DEFAULT_CENTER = { lat: 18.7546, lng: 73.4062 }; // Lonavala, Mumbai–Pune Expressway

const SERVICES = [
  { code: 'tow',        name: 'Towing',           icon: '🚛', group: 'Roadside', base: 799, perKm: 25, includedKm: 5, towPerKm: 35, desc: 'Flatbed / wheel-lift to a garage' },
  { code: 'puncture',   name: 'Flat tyre',        icon: '🛞', group: 'Roadside', base: 199, perKm: 12, includedKm: 3, desc: 'Puncture repair or stepney change' },
  { code: 'fuel',       name: 'Fuel delivery',    icon: '⛽', group: 'Roadside', base: 149, perKm: 12, includedKm: 3, fuelLitres: 5, fuelPrice: 105, desc: '5 L petrol/diesel at pump price' },
  { code: 'battery',    name: 'Battery jump',     icon: '🔋', group: 'Roadside', base: 299, perKm: 12, includedKm: 3, desc: 'Jump-start or battery check' },
  { code: 'mechanic',   name: 'Mechanic',         icon: '🔧', group: 'Roadside', base: 349, perKm: 15, includedKm: 3, desc: 'On-spot diagnosis & minor repair' },
  { code: 'plumber',    name: 'Plumber',          icon: '🚰', group: 'Home',     base: 249, perKm: 10, includedKm: 3, desc: 'Leaks, bursts, blockages' },
  { code: 'electrician',name: 'Electrician',      icon: '💡', group: 'Home',     base: 249, perKm: 10, includedKm: 3, desc: 'Power trips, wiring, MCB' },
  { code: 'locksmith',  name: 'Locksmith',        icon: '🔑', group: 'Home',     base: 399, perKm: 12, includedKm: 3, desc: 'Locked out of home or car' },
];
const SERVICE = Object.fromEntries(SERVICES.map(s => [s.code, s]));

const BOT_NAMES = ['Sanjay Patil', 'Imran Shaikh', 'Ravi Jadhav', 'Prakash More', 'Amit Kulkarni', 'Salim Khan', 'Vikas Pawar', 'Ganesh Shinde', 'Arjun Nair', 'Deepak Yadav', 'Manoj Gupta', 'Faizal Ansari'];
const ADDON_IDEAS = {
  tow: { label: 'Expressway toll', amount: 80, reason: 'Toll plaza on the way to garage' },
  puncture: { label: 'New tube', amount: 250, reason: 'Tube torn, cannot be patched' },
  mechanic: { label: 'Fan belt', amount: 420, reason: 'Belt snapped, replacement needed' },
  plumber: { label: 'PVC elbow joint', amount: 60, reason: 'Cracked joint replaced' },
  electrician: { label: '32A MCB', amount: 280, reason: 'Old MCB burnt' },
};

// ---------------------------------------------------------------- store
let db = { users: {}, providers: {}, jobs: {} };
try { if (fs.existsSync(DATA_FILE)) db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { console.warn('data.json unreadable, starting fresh'); }
let dirty = false;
const markDirty = () => { dirty = true; };
setInterval(() => { if (dirty) { dirty = false; fs.writeFile(DATA_FILE, JSON.stringify(db), () => {}); } }, 2000);

const id = (p) => p + '_' + crypto.randomBytes(4).toString('hex');
const now = () => Date.now();

// ---------------------------------------------------------------- geo / pricing
function haversineKm(a, b) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const roadKm = (a, b) => haversineKm(a, b) * ROAD_FACTOR;
const etaMin = (km) => Math.max(2, Math.round(km / AVG_KMPH * 60));
function isNight(d = new Date()) { const h = d.getHours(); return h >= 22 || h < 6; }
function offsetPoint(c, km, bearingDeg) {
  const b = bearingDeg * Math.PI / 180;
  return { lat: c.lat + (km / 111) * Math.cos(b), lng: c.lng + (km / (111 * Math.cos(c.lat * Math.PI / 180))) * Math.sin(b) };
}

function quote(serviceCode, pickup, drop, approachKm, forceNight, shield) {
  const s = SERVICE[serviceCode];
  const items = [{ label: 'Base charge', amount: s.base }];
  const extraKm = Math.max(0, approachKm - s.includedKm);
  if (extraKm > 0) items.push({ label: `Travel: extra ${extraKm.toFixed(1)} km (first ${s.includedKm} km free)`, amount: Math.round(extraKm * s.perKm) });
  let towKm = 0;
  if (s.code === 'tow' && drop) {
    towKm = roadKm(pickup, drop);
    items.push({ label: `Tow distance (${towKm.toFixed(1)} km × ₹${s.towPerKm})`, amount: Math.round(towKm * s.towPerKm) });
  }
  if (s.fuelLitres) items.push({ label: `Fuel ${s.fuelLitres} L @ ₹${s.fuelPrice} (pump price)`, amount: s.fuelLitres * s.fuelPrice });
  const subtotal = items.reduce((a, i) => a + i.amount, 0);
  const night = forceNight ?? isNight();
  if (night) items.push({ label: `Night surcharge (20%, capped ₹${NIGHT_CAP})`, amount: Math.min(Math.round(subtotal * NIGHT_PCT), NIGHT_CAP) });
  const platformFee = shield ? 0 : PLATFORM_FEE;
  items.push({ label: shield ? 'Platform fee (waived, Shield member)' : 'Platform fee', amount: platformFee, platform: true });
  const total = items.reduce((a, i) => a + i.amount, 0);
  return { service: s.code, items, total, platformFee, shield: !!shield, night, approachKm: +approachKm.toFixed(1), towKm: +towKm.toFixed(1), etaMin: etaMin(approachKm), lockedAt: now() };
}

// ---------------------------------------------------------------- providers
function availableProviders(serviceCode, point, radiusKm) {
  return Object.values(db.providers)
    .filter(p => p.online && !p.activeJobId && p.services.includes(serviceCode))
    .map(p => ({ p, km: roadKm(p, point) }))
    .filter(x => x.km <= radiusKm)
    .sort((a, b) => (a.km - b.km) - (b.p.rating - a.p.rating) * 0.5);
}

function ensureBotsNear(point) {
  const near = Object.values(db.providers).filter(p => p.bot && haversineKm(p, point) < 25);
  if (near.length >= 6) return;
  const servicesCycle = [['tow'], ['puncture', 'battery', 'fuel'], ['mechanic', 'battery', 'puncture'], ['tow', 'mechanic'], ['plumber', 'electrician'], ['locksmith', 'electrician'], ['fuel', 'puncture'], ['plumber']];
  servicesCycle.forEach((services, i) => {
    const pos = offsetPoint(point, 1.5 + Math.random() * 6, Math.random() * 360);
    const pid = id('prov');
    const name = BOT_NAMES[(Object.keys(db.providers).length + i) % BOT_NAMES.length];
    db.providers[pid] = {
      id: pid, name, phone: '98' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0'),
      services, online: true, lat: pos.lat, lng: pos.lng,
      rating: +(4.3 + Math.random() * 0.7).toFixed(1), ratingCount: 20 + Math.floor(Math.random() * 300),
      vehicle: 'MH ' + (12 + i) + ' ' + ['AB', 'CK', 'TX', 'PL'][i % 4] + ' ' + (1000 + Math.floor(Math.random() * 8999)),
      kyc: 'verified', bot: true, earnings: 0, jobsDone: 0, activeJobId: null,
    };
  });
  markDirty();
}
if (!Object.keys(db.providers).length) ensureBotsNear(DEFAULT_CENTER);

// ---------------------------------------------------------------- SSE
const clients = new Map(); // key -> Set(res)
function send(key, type, data) {
  const set = clients.get(key); if (!set) return;
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) res.write(msg);
}
function publicJob(j, forRole) {
  const p = j.providerId ? db.providers[j.providerId] : null;
  const out = { ...j, provider: p && { id: p.id, name: p.name, phone: maskPhone(p.phone), rating: p.rating, ratingCount: p.ratingCount, vehicle: p.vehicle, lat: p.lat, lng: p.lng, kyc: p.kyc, services: p.services } };
  out.offeredCount = j.offered.length;
  delete out.botState; delete out.offered;
  if (forRole === 'provider') delete out.otp; // provider must get OTP from customer in person
  if (forRole === 'public') { delete out.otp; delete out.customerPhone; delete out.messages; delete out.notes; if (out.provider) delete out.provider.phone; }
  return out;
}
const maskPhone = ph => ph ? ph.slice(0, 2) + 'XXXXXX' + ph.slice(-2) : '';
function pushJob(j) {
  send(j.customerId, 'job', publicJob(j, 'customer'));
  if (j.providerId) send(j.providerId, 'job', publicJob(j, 'provider'));
  send('admin', 'job', publicJob(j, 'admin'));
  markDirty();
}
function addEvent(j, text) { j.events.push({ t: now(), text }); }
function addMsg(j, from, text) {
  (j.messages ||= []).push({ id: id('m'), from, text: String(text).slice(0, 500), t: now() });
}
const BOT_REPLIES = ['Okay, noted.', 'Reaching soon. Please stay in a safe spot.', 'Got it, I will call if I cannot find you.', 'Yes, I have the tools for this.'];

// ---------------------------------------------------------------- job actions
function assign(j, p) {
  if (j.status !== 'SEARCHING' || p.activeJobId) return false; // "first accept wins" lock
  j.status = 'ASSIGNED'; j.providerId = p.id; j.assignedAt = now();
  p.activeJobId = j.id;
  j.eta = etaMin(roadKm(p, j.pickup));
  j.moveStep = Math.max(haversineKm(p, j.pickup) / 20, 0.05); // simulated drive ≈ 20 s
  addEvent(j, `${p.name} accepted · ETA ${j.eta} min`);
  if (p.bot) addMsg(j, 'provider', `Hi ${j.customerName.split(' ')[0]}, I'm on my way, about ${j.eta} min. Please keep hazard lights on and stay off the road.`);
  for (const pid of j.offered) if (pid !== p.id) send(pid, 'offer_revoked', { jobId: j.id });
  pushJob(j);
  return true;
}
function release(j) {
  const p = j.providerId && db.providers[j.providerId];
  if (p && p.activeJobId === j.id) p.activeJobId = null;
}
const feeOf = j => j.quote.platformFee ?? PLATFORM_FEE;
const payoutOf = (j, amount) => Math.round((amount - feeOf(j)) * (1 - COMMISSION));
function finalAmount(j) {
  return j.quote.total + j.addons.filter(a => a.status === 'approved').reduce((s, a) => s + a.amount, 0);
}

// ---------------------------------------------------------------- engine tick (1s)
setInterval(() => {
  const t = now();
  for (const j of Object.values(db.jobs)) {
    if (j.status === 'SEARCHING') {
      const elapsed = (t - j.createdAt) / 1000;
      if (elapsed > SEARCH_TIMEOUT_S) { j.status = 'NO_PROVIDER'; addEvent(j, 'No provider found nearby'); pushJob(j); continue; }
      const radius = RADIUS_STEPS.filter(([s]) => elapsed + (j.quote.shield ? 12 : 0) >= s).pop()[1];
      if (radius !== j.radiusKm) { j.radiusKm = radius; addEvent(j, `Searching within ${radius} km`); pushJob(j); }
      const humanOffered = j.offered.some(pid => !db.providers[pid]?.bot);
      for (const { p, km } of availableProviders(j.service, j.pickup, radius)) {
        if (j.declined.includes(p.id)) continue;
        if (!j.offered.includes(p.id)) {
          j.offered.push(p.id);
          send(p.id, 'offer', { jobId: j.id, service: j.service, km: +km.toFixed(1), payout: payoutOf(j, j.quote.total), fare: j.quote.total, pickup: j.pickup, customerName: j.customerName, expiresIn: 20 });
          if (p.bot) j.botState[p.id] = t + (humanOffered ? 18000 : 4000) + Math.random() * 5000 + km * 300;
        }
        if (p.bot && j.botState[p.id] && t >= j.botState[p.id]) { assign(j, p); break; }
      }
    }
    else if (j.status === 'ASSIGNED') {
      const p = db.providers[j.providerId];
      if (!p) continue;
      if (p.bot || j.simulate) {
        const d = haversineKm(p, j.pickup);
        if (d < 0.05) {
          p.lat = j.pickup.lat; p.lng = j.pickup.lng;
          j.status = 'ARRIVED'; j.arrivedAt = t; j.eta = 0; addEvent(j, `${p.name} has arrived`);
          pushJob(j);
        } else {
          const step = j.moveStep || Math.max(d / 20, 0.05); const f = Math.min(1, step / d);
          p.lat += (j.pickup.lat - p.lat) * f; p.lng += (j.pickup.lng - p.lng) * f;
          j.eta = etaMin(roadKm(p, j.pickup));
          const loc = { jobId: j.id, lat: p.lat, lng: p.lng, eta: j.eta };
          send(j.customerId, 'loc', loc); send(p.id, 'loc', loc); send('admin', 'loc', { providerId: p.id, ...loc });
        }
      }
    }
    else if (j.status === 'ARRIVED') {
      const p = db.providers[j.providerId];
      if (p?.bot && t - j.arrivedAt > 5000) { j.status = 'IN_PROGRESS'; j.startedAt = t; addEvent(j, 'OTP verified · job started'); pushJob(j); }
    }
    else if (j.status === 'IN_PROGRESS') {
      const p = db.providers[j.providerId];
      if (!p?.bot) continue;
      const since = t - j.startedAt;
      const idea = ADDON_IDEAS[j.service];
      if (idea && !j.botState.addonDone && since > 5000) {
        j.botState.addonDone = true;
        j.addons.push({ id: id('add'), ...idea, status: 'pending', at: t });
        addEvent(j, `Extra item proposed: ${idea.label} ₹${idea.amount} — awaiting your approval`);
        pushJob(j);
      }
      const pending = j.addons.some(a => a.status === 'pending');
      if (!pending && since > (idea ? 12000 : 9000)) completeJob(j);
    }
  }
}, 1000);

function completeJob(j) {
  const p = db.providers[j.providerId];
  j.status = 'COMPLETED'; j.completedAt = now();
  j.finalAmount = finalAmount(j);
  j.providerPayout = payoutOf(j, j.finalAmount);
  addEvent(j, `Job completed · Final ₹${j.finalAmount} (quote ₹${j.quote.total} + approved extras)`);
  if (p) { p.jobsDone++; p.earnings += j.providerPayout; }
  release(j);
  pushJob(j);
}

// ---------------------------------------------------------------- HTTP
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }
function body(req) {
  return new Promise((resolve) => {
    let b = ''; req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
  });
}
const err = (res, code, msg) => json(res, code, { error: msg });
const shieldActive = uid => { const u = db.users[uid]; return !!(u && u.shieldUntil && u.shieldUntil > now()); };

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler });

route('GET', '/api/services', (req, res) => json(res, 200, { services: SERVICES, platformFee: PLATFORM_FEE, nightCap: NIGHT_CAP, night: isNight(), center: DEFAULT_CENTER }));

route('POST', '/api/login', async (req, res) => {
  const { name, phone, role } = await body(req);
  if (!name || !/^\d{10}$/.test(phone || '') || !['customer', 'provider'].includes(role)) return err(res, 400, 'Enter name and a 10-digit phone number');
  let user = Object.values(db.users).find(u => u.phone === phone && u.role === role);
  if (!user) {
    user = { id: role === 'provider' ? id('prov') : id('cust'), name, phone, role, createdAt: now() };
    db.users[user.id] = user;
    if (role === 'provider') db.providers[user.id] = { id: user.id, name, phone, services: ['puncture', 'battery'], online: false, lat: null, lng: null, rating: 5.0, ratingCount: 0, vehicle: '', kyc: 'pending', bot: false, earnings: 0, jobsDone: 0, activeJobId: null };
    markDirty();
  }
  json(res, 200, { user, provider: db.providers[user.id] || null });
});

route('POST', '/api/quote', async (req, res) => {
  const { service, pickup, drop, night, customerId } = await body(req);
  if (!SERVICE[service] || !pickup) return err(res, 400, 'service and pickup required');
  ensureBotsNear(pickup);
  const avail = availableProviders(service, pickup, 50);
  const approachKm = avail[0]?.km ?? 4;
  json(res, 200, { quote: quote(service, pickup, drop, approachKm, night, shieldActive(customerId)), nearby: avail.length, nearest: avail.slice(0, 8).map(x => ({ lat: x.p.lat, lng: x.p.lng, km: +x.km.toFixed(1) })) });
});

route('GET', '/api/nearby', (req, res, q) => {
  const pickup = { lat: +q.get('lat'), lng: +q.get('lng') };
  if (!isFinite(pickup.lat)) return err(res, 400, 'lat/lng');
  ensureBotsNear(pickup);
  const list = Object.values(db.providers).filter(p => p.online && p.lat != null && haversineKm(p, pickup) < 25).map(p => ({ id: p.id, lat: p.lat, lng: p.lng, services: p.services, busy: !!p.activeJobId }));
  json(res, 200, { providers: list });
});

route('POST', '/api/jobs', async (req, res) => {
  const { customerId, service, pickup, drop, notes, vehicle, night } = await body(req);
  const user = db.users[customerId];
  if (!user || !SERVICE[service] || !pickup) return err(res, 400, 'invalid request');
  const active = Object.values(db.jobs).find(j => j.customerId === customerId && ['SEARCHING', 'ASSIGNED', 'ARRIVED', 'IN_PROGRESS'].includes(j.status));
  if (active) return err(res, 409, 'You already have an active request');
  ensureBotsNear(pickup);
  const avail = availableProviders(service, pickup, 50);
  const j = {
    id: id('job'), customerId, customerName: user.name, customerPhone: maskPhone(user.phone), service, pickup, drop: drop || null, notes: notes || '', vehicle: vehicle || '',
    quote: quote(service, pickup, drop, avail[0]?.km ?? 4, night, shieldActive(customerId)), status: 'SEARCHING', otp: String(Math.floor(1000 + Math.random() * 9000)),
    messages: [], providerId: null, offered: [], declined: [], radiusKm: 0, createdAt: now(), events: [], addons: [], payment: null, ratings: {}, botState: {}, simulate: false, eta: null,
  };
  addEvent(j, `Request created · Fare locked at ₹${j.quote.total}`);
  db.jobs[j.id] = j;
  pushJob(j);
  json(res, 200, { job: publicJob(j, 'customer') });
});

route('GET', '/api/jobs/:id', (req, res, q, { id: jid }) => {
  const j = db.jobs[jid]; if (!j) return err(res, 404, 'not found');
  json(res, 200, { job: publicJob(j, q.get('role') || 'customer') });
});

route('GET', '/api/users/:id/jobs', (req, res, q, { id: uid }) => {
  const list = Object.values(db.jobs).filter(j => j.customerId === uid || j.providerId === uid).sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
  const role = db.users[uid]?.role || 'customer';
  json(res, 200, { jobs: list.map(j => publicJob(j, role)) });
});

route('POST', '/api/jobs/:id/:action', async (req, res, q, { id: jid, action }) => {
  const j = db.jobs[jid]; if (!j) return err(res, 404, 'not found');
  const b = await body(req);
  const p = b.providerId && db.providers[b.providerId];
  const isProv = p && j.providerId === p.id;
  switch (action) {
    case 'accept':
      if (!p) return err(res, 400, 'provider required');
      if (!assign(j, p)) return err(res, 409, 'Job already taken or you are busy');
      return json(res, 200, { job: publicJob(j, 'provider') });
    case 'decline':
      if (p && !j.declined.includes(p.id)) j.declined.push(p.id);
      return json(res, 200, { ok: true });
    case 'simulate':
      if (!isProv) return err(res, 403, 'not your job');
      j.simulate = true; j.moveStep = Math.max(haversineKm(p, j.pickup) / 20, 0.05); return json(res, 200, { ok: true });
    case 'arrived':
      if (!isProv || j.status !== 'ASSIGNED') return err(res, 409, 'invalid state');
      j.status = 'ARRIVED'; j.arrivedAt = now(); j.eta = 0; addEvent(j, `${p.name} has arrived`); pushJob(j);
      return json(res, 200, { ok: true });
    case 'start':
      if (!isProv || j.status !== 'ARRIVED') return err(res, 409, 'Mark arrived first');
      j.otpTries = (j.otpTries || 0) + 1;
      if (j.otpTries > 5) return err(res, 429, 'Too many attempts — contact support');
      if (String(b.otp) !== j.otp) return err(res, 400, 'Wrong OTP — ask the customer for the 4-digit code');
      j.status = 'IN_PROGRESS'; j.startedAt = now(); addEvent(j, 'OTP verified · job started'); pushJob(j);
      return json(res, 200, { ok: true });
    case 'addon': {
      if (!isProv || j.status !== 'IN_PROGRESS') return err(res, 409, 'Only during an active job');
      const amount = Math.round(+b.amount);
      if (!b.label || !(amount > 0 && amount <= 20000)) return err(res, 400, 'Enter item and amount');
      const a = { id: id('add'), label: String(b.label).slice(0, 60), amount, reason: String(b.reason || '').slice(0, 120), status: 'pending', at: now() };
      j.addons.push(a); addEvent(j, `Extra item proposed: ${a.label} ₹${a.amount} — awaiting approval`); pushJob(j);
      return json(res, 200, { ok: true });
    }
    case 'addon-decision': {
      if (b.customerId !== j.customerId) return err(res, 403, 'not your job');
      const a = j.addons.find(x => x.id === b.addonId);
      if (!a || a.status !== 'pending') return err(res, 409, 'already decided');
      a.status = b.approve ? 'approved' : 'rejected';
      addEvent(j, `${a.label} ₹${a.amount} ${a.status} by customer`); pushJob(j);
      return json(res, 200, { ok: true });
    }
    case 'complete':
      if (!isProv || j.status !== 'IN_PROGRESS') return err(res, 409, 'invalid state');
      if (j.addons.some(a => a.status === 'pending')) return err(res, 409, 'Wait for the customer to approve/reject extra items');
      completeJob(j); return json(res, 200, { ok: true });
    case 'pay':
      if (b.customerId !== j.customerId || j.status !== 'COMPLETED') return err(res, 409, 'invalid state');
      j.status = 'PAID'; j.payment = { method: b.method || 'upi', amount: j.finalAmount, at: now(), ref: 'PAY' + crypto.randomBytes(3).toString('hex').toUpperCase() };
      addEvent(j, `Paid ₹${j.finalAmount} via ${j.payment.method.toUpperCase()}`); pushJob(j);
      return json(res, 200, { ok: true });
    case 'rate': {
      const stars = Math.max(1, Math.min(5, Math.round(+b.stars)));
      if (b.customerId === j.customerId && !j.ratings.customer) {
        j.ratings.customer = { stars, comment: String(b.comment || '').slice(0, 300) };
        const pr = db.providers[j.providerId];
        if (pr) { pr.rating = +((pr.rating * pr.ratingCount + stars) / (pr.ratingCount + 1)).toFixed(2); pr.ratingCount++; }
      } else if (isProv && !j.ratings.provider) j.ratings.provider = { stars };
      pushJob(j); return json(res, 200, { ok: true });
    }
    case 'cancel': {
      const byCustomer = b.customerId === j.customerId;
      if (!byCustomer && !isProv) return err(res, 403, 'not allowed');
      if (!['SEARCHING', 'ASSIGNED', 'ARRIVED'].includes(j.status)) return err(res, 409, 'Cannot cancel now');
      const fee = byCustomer && j.status === 'ARRIVED' ? 99 : 0;
      if (isProv) { // provider backs out → re-dispatch instead of killing the job
        release(j); j.declined.push(p.id); j.providerId = null; j.status = 'SEARCHING'; j.createdAt = now(); j.radiusKm = 0;
        addEvent(j, 'Provider cancelled · finding you another provider'); pushJob(j); send(p.id, 'job', { ...publicJob(j, 'provider'), status: 'CANCELLED' });
        return json(res, 200, { ok: true });
      }
      j.status = 'CANCELLED'; j.cancelFee = fee; j.cancelReason = String(b.reason || '').slice(0, 80); addEvent(j, (j.cancelReason ? `Reason: ${j.cancelReason} · ` : '') + (fee ? `Cancelled by customer · ₹${fee} visit fee` : 'Cancelled by customer · no charge'));
      const prev = j.providerId; release(j); pushJob(j);
      if (!prev) for (const pid of j.offered) send(pid, 'offer_revoked', { jobId: j.id });
      return json(res, 200, { ok: true });
    }
    case 'message': {
      const fromCustomer = b.customerId === j.customerId;
      if (!fromCustomer && !isProv) return err(res, 403, 'not allowed');
      const text = String(b.text || '').trim(); if (!text) return err(res, 400, 'Empty message');
      addMsg(j, fromCustomer ? 'customer' : 'provider', text); pushJob(j);
      const pr = db.providers[j.providerId];
      if (fromCustomer && pr?.bot && ACTIVE_STATES.includes(j.status)) setTimeout(() => { addMsg(j, 'provider', BOT_REPLIES[j.messages.length % BOT_REPLIES.length]); pushJob(j); }, 2500);
      return json(res, 200, { ok: true });
    }
    case 'sos': {
      const u = db.users[j.customerId];
      const names = (u?.contacts || []).map(c => c.name).join(', ');
      addEvent(j, 'SOS raised · ops alerted' + (names ? ` · live location sent to ${names}` : ''));
      send('admin', 'sos', { jobId: j.id, customerName: j.customerName, pickup: j.pickup }); pushJob(j);
      return json(res, 200, { ok: true, notified: (u?.contacts || []).length });
    }
  }
  err(res, 404, 'unknown action');
});

route('GET', '/api/users/:id', (req, res, q, { id: uid }) => {
  const u = db.users[uid]; if (!u) return err(res, 404, 'not found');
  json(res, 200, { user: { ...u, shield: shieldActive(uid) } });
});

route('POST', '/api/users/:id/profile', async (req, res, q, { id: uid }) => {
  const u = db.users[uid]; if (!u) return err(res, 404, 'not found');
  const b = await body(req);
  if (Array.isArray(b.contacts)) {
    const c = b.contacts.slice(0, 3).map(x => ({ name: String(x.name || '').trim().slice(0, 40), phone: String(x.phone || '').replace(/\D/g, '').slice(0, 10) }));
    if (c.some(x => !x.name || x.phone.length !== 10)) return err(res, 400, 'Each contact needs a name and 10-digit phone');
    u.contacts = c;
  }
  if (b.vehicle) u.vehicle = { model: String(b.vehicle.model || '').slice(0, 40), plate: String(b.vehicle.plate || '').toUpperCase().slice(0, 15), fuel: ['petrol', 'diesel', 'cng', 'ev'].includes(b.vehicle.fuel) ? b.vehicle.fuel : 'petrol' };
  if (b.shield === true) { u.shieldUntil = now() + 30 * 864e5; u.shieldSince = now(); }
  if (b.shield === false) u.shieldUntil = null;
  markDirty();
  json(res, 200, { user: { ...u, shield: shieldActive(uid) } });
});

route('POST', '/api/admin/providers/:id/kyc', async (req, res, q, { id: pid }) => {
  const p = db.providers[pid]; if (!p) return err(res, 404, 'not found');
  const { approve } = await body(req);
  p.kyc = approve ? 'verified' : 'rejected'; markDirty();
  send(pid, 'kyc', { kyc: p.kyc }); send('admin', 'provider', p);
  json(res, 200, { provider: p });
});

route('POST', '/api/providers/:id/status', async (req, res, q, { id: pid }) => {
  const p = db.providers[pid]; if (!p) return err(res, 404, 'not found');
  const b = await body(req);
  if (b.online === true && p.kyc !== 'verified') return err(res, 403, p.kyc === 'submitted' ? 'KYC under review. Ops must approve it first (Ops console).' : 'Complete KYC before going online.');
  if (typeof b.online === 'boolean') p.online = b.online;
  if (Array.isArray(b.services)) p.services = b.services.filter(s => SERVICE[s]);
  if (b.vehicle != null) p.vehicle = String(b.vehicle).slice(0, 20);
  if (isFinite(b.lat) && isFinite(b.lng)) { p.lat = +b.lat; p.lng = +b.lng; }
  if (p.online && p.lat == null) { p.lat = DEFAULT_CENTER.lat; p.lng = DEFAULT_CENTER.lng; }
  if (b.kyc && ['pending', 'rejected'].includes(p.kyc)) {
    const k = b.kyc;
    if (!/^\d{4}$/.test(k.idLast4 || '') || !k.dl || !k.upi) return err(res, 400, 'Fill in all KYC fields');
    p.kycDocs = { idType: k.idType === 'pan' ? 'PAN' : 'Aadhaar', idLast4: k.idLast4, dl: String(k.dl).slice(0, 20).toUpperCase(), upi: String(k.upi).slice(0, 50), submittedAt: now() };
    p.kyc = 'submitted';
  }
  markDirty();
  send('admin', 'provider', p);
  json(res, 200, { provider: p });
});

route('GET', '/api/providers/:id', (req, res, q, { id: pid }) => {
  const p = db.providers[pid]; if (!p) return err(res, 404, 'not found');
  const active = p.activeJobId && db.jobs[p.activeJobId];
  // pending offers this provider could still accept (e.g. after page reload)
  const offers = Object.values(db.jobs).filter(j => j.status === 'SEARCHING' && j.offered.includes(pid) && !j.declined.includes(pid))
    .map(j => ({ jobId: j.id, service: j.service, km: +roadKm(p, j.pickup).toFixed(1), payout: payoutOf(j, j.quote.total), fare: j.quote.total, pickup: j.pickup, customerName: j.customerName, expiresIn: 20 }));
  json(res, 200, { provider: p, activeJob: active ? publicJob(active, 'provider') : null, offers });
});

route('GET', '/api/admin/overview', (req, res) => {
  const jobs = Object.values(db.jobs).sort((a, b) => b.createdAt - a.createdAt);
  const by = s => jobs.filter(j => j.status === s).length;
  const paid = jobs.filter(j => j.status === 'PAID');
  const gmv = paid.reduce((s, j) => s + j.finalAmount, 0);
  const matched = jobs.filter(j => j.assignedAt);
  const avgMatch = matched.length ? Math.round(matched.reduce((s, j) => s + (j.assignedAt - j.createdAt), 0) / matched.length / 1000) : 0;
  const finished = jobs.filter(j => j.assignedAt || j.status === 'NO_PROVIDER'); // outcome known: matched or failed
  json(res, 200, {
    stats: {
      online: Object.values(db.providers).filter(p => p.online).length, providers: Object.keys(db.providers).length,
      active: by('SEARCHING') + by('ASSIGNED') + by('ARRIVED') + by('IN_PROGRESS'), completed: paid.length + by('COMPLETED'),
      noProvider: by('NO_PROVIDER'), gmv, revenue: Math.round(paid.reduce((s, j) => s + feeOf(j) + (j.finalAmount - feeOf(j)) * COMMISSION, 0)),
      avgMatchSec: avgMatch, matchRate: finished.length ? Math.round(matched.length / finished.length * 100) : 0,
    },
    jobs: jobs.slice(0, 40).map(j => publicJob(j, 'admin')),
    providers: Object.values(db.providers),
  });
});

route('POST', '/api/admin/reset', (req, res) => {
  db = { users: db.users, providers: {}, jobs: {} };
  for (const u of Object.values(db.users)) if (u.role === 'provider') db.providers[u.id] = { id: u.id, name: u.name, phone: u.phone, services: ['puncture', 'battery'], online: false, lat: null, lng: null, rating: 5, ratingCount: 0, vehicle: '', kyc: 'pending', bot: false, earnings: 0, jobsDone: 0, activeJobId: null };
  ensureBotsNear(DEFAULT_CENTER); markDirty();
  json(res, 200, { ok: true });
});

route('GET', '/api/events', (req, res, q) => {
  const key = q.get('key'); if (!key) return err(res, 400, 'key');
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('event: hello\ndata: {}\n\n');
  if (!clients.has(key)) clients.set(key, new Set());
  clients.get(key).add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => { clearInterval(ping); clients.get(key)?.delete(res); });
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (m) {
        try { return await r.handler(req, res, url.searchParams, m.groups || {}); }
        catch (e) { console.error(e); return err(res, 500, 'server error'); }
      }
    }
    return err(res, 404, 'no route');
  }
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  if (url.pathname === '/' || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => console.log(`OnSpot prototype running →  http://localhost:${PORT}`));
