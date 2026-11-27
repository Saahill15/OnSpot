// End-to-end: real Nest app, real Postgres (onspot_test), real Redis (db 1), real Socket.IO clients.
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { EVENTS } from '@onspot/shared';
import { createApp } from '../src/main';
import { config, PushService } from '../src/infra';
import { JobsService, localHour } from '../src/jobs.service';

let app: INestApplication;
let base: string;
const db = new PrismaClient();
const sockets: Socket[] = [];
const PICKUP = { lat: 18.7546, lng: 73.4062, label: 'Km 62, Mumbai–Pune Expressway' };
const http = () => request(app.getHttpServer());
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function login(phone: string, role: 'CUSTOMER' | 'PROVIDER' | 'ADMIN', name?: string) {
  const r1 = await http().post('/v1/auth/otp/request').send({ phone }).expect(200);
  const r2 = await http().post('/v1/auth/otp/verify').send({ phone, role, code: r1.body.devCode, name }).expect(200);
  return { token: r2.body.token as string, id: r2.body.user.id as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
function connect(token: string) {
  const s = io(base, { auth: { token }, transports: ['websocket'], forceNew: true });
  sockets.push(s);
  return new Promise<Socket>((res, rej) => { s.on('ready', () => res(s)); s.on('connect_error', rej); });
}
const waitFor = <T = any>(s: Socket, ev: string, pred: (d: T) => boolean = () => true, ms = 8000) =>
  new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout waiting for ${ev}`)), ms);
    const h = (d: T) => { if (pred(d)) { clearTimeout(t); s.off(ev, h); res(d); } };
    s.on(ev, h);
  });

async function makeProvider(phone: string, name: string, services: string[], at = PICKUP, admin?: string) {
  const p = await login(phone, 'PROVIDER', name);
  await http().patch('/v1/provider/me').set(auth(p.token)).send({ services, vehicleNo: 'mh 12 ab 1234' }).expect(200);
  await http().post('/v1/provider/kyc').set(auth(p.token)).send({ idType: 'AADHAAR', idLast4: '1234', dlNumber: 'MH1220190001', upiId: 'test@okbank' }).expect(200);
  await http().post(`/v1/admin/providers/${p.id}/kyc`).set(auth(admin!)).send({ approve: true }).expect(200);
  await http().post('/v1/provider/status').set(auth(p.token)).send({ online: true, lat: at.lat + 0.002, lng: at.lng + 0.002 }).expect(200);
  return p;
}

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "Rating","Payment","Message","Addon","JobEvent","Job","Provider","OtpCode","User" CASCADE');
  const r = new Redis(process.env.REDIS_URL!); await r.flushdb(); await r.quit();
  await db.user.create({ data: { phone: '9999999999', role: 'ADMIN', name: 'Ops' } });
  app = await createApp();
  await app.listen(0);
  base = await app.getUrl();
  base = base.replace('[::1]', 'localhost');
});
afterAll(async () => { sockets.forEach(s => s.close()); await app.close(); await db.$disconnect(); });

describe('auth', () => {
  it('rejects bad phone numbers and wrong codes, asks new users for a name', async () => {
    await http().post('/v1/auth/otp/request').send({ phone: '12345' }).expect(400);
    const r = await http().post('/v1/auth/otp/request').send({ phone: '9876500001' }).expect(200);
    await http().post('/v1/auth/otp/verify').send({ phone: '9876500001', role: 'CUSTOMER', code: r.body.devCode === '000000' ? '111111' : '000000' }).expect(400);
    const v = await http().post('/v1/auth/otp/verify').send({ phone: '9876500001', role: 'CUSTOMER', code: r.body.devCode }).expect(200);
    expect(v.body.needsName).toBe(true);
  });
  it('blocks unauthenticated calls and wrong roles', async () => {
    await http().get('/v1/me').expect(401);
    const c = await login('9876500002', 'CUSTOMER', 'Role Test');
    await http().post('/v1/provider/status').set(auth(c.token)).send({ online: true }).expect(403);
  });
});

describe('full job lifecycle', () => {
  let admin: string, cust: { token: string; id: string }, p1: { token: string; id: string }, p2: { token: string; id: string };
  let jobId: string;

  beforeAll(async () => {
    admin = (await login('9999999999', 'ADMIN')).token;
    cust = await login('9876500010', 'CUSTOMER', 'Rahul Sharma');
  });

  it('keeps unverified providers offline (KYC gate)', async () => {
    const p = await login('9800000099', 'PROVIDER', 'Unverified');
    await http().patch('/v1/provider/me').set(auth(p.token)).send({ services: ['tow'] }).expect(200);
    const r = await http().post('/v1/provider/status').set(auth(p.token)).send({ online: true, lat: PICKUP.lat, lng: PICKUP.lng }).expect(403);
    expect(r.body.message).toMatch(/KYC/);
  });

  it('quotes a locked fare with nearby providers', async () => {
    p1 = await makeProvider('9800000011', 'Sanjay Patil', ['tow', 'puncture'], PICKUP, admin);
    p2 = await makeProvider('9800000012', 'Prakash More', ['tow'], PICKUP, admin);
    const q = await http().post('/v1/jobs/quote').set(auth(cust.token)).send({ service: 'puncture', pickup: PICKUP, night: false }).expect(200);
    expect(q.body.nearby).toBe(1);
    expect(q.body.quote.total).toBe(199 + 19); // base + platform fee, provider within free km
  });

  it('dispatches over Socket.IO and only one provider can accept', async () => {
    const [s1, s2, sc] = await Promise.all([connect(p1.token), connect(p2.token), connect(cust.token)]);
    const offer1 = waitFor<any>(s1, EVENTS.JOB_OFFER);
    const offer2 = waitFor<any>(s2, EVENTS.JOB_OFFER);
    const created = await http().post('/v1/jobs').set(auth(cust.token)).send({ service: 'tow', pickup: PICKUP, drop: { lat: 18.79, lng: 73.43 }, night: false }).expect(201);
    jobId = created.body.id;
    expect(created.body.startCode).toMatch(/^\d{4}$/);
    const [o1, o2] = await Promise.all([offer1, offer2]);
    expect(o1.jobId).toBe(jobId);
    expect(o2.payout).toBe(Math.round((created.body.total - 19) * 0.9));

    const assigned = waitFor<any>(sc, EVENTS.JOB_UPDATED, j => j.status === 'ASSIGNED');
    const revoked = waitFor<any>(s2, EVENTS.JOB_OFFER_REVOKED);
    const [a, b] = await Promise.all([
      http().post(`/v1/jobs/${jobId}/accept`).set(auth(p1.token)),
      http().post(`/v1/jobs/${jobId}/accept`).set(auth(p2.token)),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? p1 : p2;
    if (winner !== p1) [p1, p2] = [p2, p1]; // p1 = winner from here on
    const j = await assigned;
    expect(j.provider.verified).toBe(true);
    revoked.catch(() => undefined); // only the loser's socket gets a revoke; don't block on it
  });

  it('never shows the start code to the provider, and rejects a wrong code', async () => {
    const pv = await http().get(`/v1/jobs/${jobId}`).set(auth(p1.token)).expect(200);
    expect(pv.body.startCode).toBeUndefined();
    await http().post(`/v1/jobs/${jobId}/start`).set(auth(p1.token)).send({ code: '0000' }).expect(409); // must arrive first
    await http().post(`/v1/jobs/${jobId}/arrived`).set(auth(p1.token)).expect(200);
    const code = (await http().get(`/v1/jobs/${jobId}`).set(auth(cust.token))).body.startCode;
    const wrong = code === '1111' ? '2222' : '1111';
    await http().post(`/v1/jobs/${jobId}/start`).set(auth(p1.token)).send({ code: wrong }).expect(400);
    await http().post(`/v1/jobs/${jobId}/start`).set(auth(p1.token)).send({ code }).expect(200);
  });

  it('chat works and the public tracking link leaks nothing private', async () => {
    await http().post(`/v1/jobs/${jobId}/messages`).set(auth(cust.token)).send({ text: 'Where are you?' }).expect(200);
    const r = await http().post(`/v1/jobs/${jobId}/messages`).set(auth(p1.token)).send({ text: 'Reached, white truck' }).expect(200);
    expect(r.body.messages.map((m: any) => m.from)).toEqual(['CUSTOMER', 'PROVIDER']);
    const pub = await http().get(`/v1/track/${jobId}`).expect(200);
    expect(pub.body.startCode).toBeUndefined();
    expect(pub.body.messages).toBeUndefined();
    expect(pub.body.provider.phone).toBeUndefined();
    expect(pub.body.customer.phone).toBeUndefined();
  });

  it('enforces Fair Price Lock: extras need approval, declined extras are not charged', async () => {
    const before = (await http().get(`/v1/jobs/${jobId}`).set(auth(cust.token))).body.total;
    await http().post(`/v1/jobs/${jobId}/addons`).set(auth(p1.token)).send({ label: 'Expressway toll', amount: 80 }).expect(200);
    await http().post(`/v1/jobs/${jobId}/addons`).set(auth(p1.token)).send({ label: 'Premium strap', amount: 500 }).expect(200);
    await http().post(`/v1/jobs/${jobId}/complete`).set(auth(p1.token)).expect(409); // pending extras block completion
    const addons = (await http().get(`/v1/jobs/${jobId}`).set(auth(cust.token))).body.addons;
    await http().post(`/v1/jobs/${jobId}/addons/${addons[0].id}/decision`).set(auth(p1.token)).send({ approve: true }).expect(403); // provider can't approve own extras
    await http().post(`/v1/jobs/${jobId}/addons/${addons[0].id}/decision`).set(auth(cust.token)).send({ approve: true }).expect(200);
    await http().post(`/v1/jobs/${jobId}/addons/${addons[1].id}/decision`).set(auth(cust.token)).send({ approve: false }).expect(200);
    const done = await http().post(`/v1/jobs/${jobId}/complete`).set(auth(p1.token)).expect(200);
    expect(done.body.finalAmount).toBe(before + 80);
    expect(done.body.providerPayout).toBe(Math.round((before + 80 - 19) * 0.9));
  });

  it('takes payment and updates the provider rating', async () => {
    const paid = await http().post(`/v1/jobs/${jobId}/pay`).set(auth(cust.token)).send({ method: 'upi' }).expect(200);
    expect(paid.body.status).toBe('PAID');
    expect(paid.body.payment.status).toBe('CAPTURED');
    await http().post(`/v1/jobs/${jobId}/rate`).set(auth(cust.token)).send({ stars: 4, comment: 'Fair and fast' }).expect(200);
    await http().post(`/v1/jobs/${jobId}/rate`).set(auth(cust.token)).send({ stars: 5 }).expect(409); // only once
    const me = await http().get('/v1/provider/me').set(auth(p1.token)).expect(200);
    expect(me.body.provider.rating).toBe(4);
    expect(me.body.provider.jobsDone).toBe(1);
    expect(me.body.provider.activeJobId).toBeNull();
  });

  it('re-dispatches when a provider releases a job, and charges a visit fee only after arrival', async () => {
    const j = (await http().post('/v1/jobs').set(auth(cust.token)).send({ service: 'tow', pickup: PICKUP, drop: { lat: 18.79, lng: 73.43 }, night: false }).expect(201)).body;
    await sleep(700);
    const accepted = await http().post(`/v1/jobs/${j.id}/accept`).set(auth(p2.token));
    const holder = accepted.status === 200 ? p2 : p1;
    if (accepted.status !== 200) await http().post(`/v1/jobs/${j.id}/accept`).set(auth(p1.token)).expect(200);
    await http().post(`/v1/jobs/${j.id}/cancel`).set(auth(holder.token)).send({}).expect(200);
    const again = (await http().get(`/v1/jobs/${j.id}`).set(auth(cust.token))).body;
    expect(again.status).toBe('SEARCHING');
    expect(again.provider).toBeNull();
    const other = holder === p1 ? p2 : p1;
    await sleep(700);
    await http().post(`/v1/jobs/${j.id}/accept`).set(auth(other.token)).expect(200);
    await http().post(`/v1/jobs/${j.id}/arrived`).set(auth(other.token)).expect(200);
    const c = await http().post(`/v1/jobs/${j.id}/cancel`).set(auth(cust.token)).send({ reason: 'Fixed it myself' }).expect(200);
    expect(c.body.status).toBe('CANCELLED');
    expect(c.body.cancelFee).toBe(99);
  });

  it('SOS notifies emergency contacts; Shield waives the platform fee', async () => {
    await http().patch('/v1/me').set(auth(cust.token)).send({ contacts: [{ name: 'Mom', phone: '9876543210' }], shield: true }).expect(200);
    const q = await http().post('/v1/jobs/quote').set(auth(cust.token)).send({ service: 'tow', pickup: PICKUP, drop: { lat: 18.79, lng: 73.43 }, night: false }).expect(200);
    expect(q.body.quote.platformFee).toBe(0);
    const j = (await http().post('/v1/jobs').set(auth(cust.token)).send({ service: 'tow', pickup: PICKUP, drop: { lat: 18.79, lng: 73.43 }, night: false }).expect(201)).body;
    const s = await http().post(`/v1/jobs/${j.id}/sos`).set(auth(cust.token)).expect(200);
    expect(s.body.notified).toBe(1);
    await http().post(`/v1/jobs/${j.id}/cancel`).set(auth(cust.token)).send({}).expect(200);
  });

  it('sends push notifications for every key moment', async () => {
    await http().post('/v1/me/push-tokens').set(auth(cust.token)).send({ token: 'not-a-token' }).expect(400);
    await http().post('/v1/me/push-tokens').set(auth(cust.token)).send({ token: 'ExponentPushToken[abc123]', platform: 'android' }).expect(200);
    const sent = app.get(PushService).sent;
    const to = (userId: string) => sent.filter(m => m.userId === userId);
    // partners got offers that expire with the offer window
    const offer = to(p1.id).find(m => m.data?.type === 'offer')!;
    expect(offer.title).toBe('New towing request');
    expect(offer.ttl).toBe(20);
    expect(offer.channelId).toBe('offers');
    // the customer heard about every step of the first job
    const titles = to(cust.id).map(m => m.title);
    expect(titles).toEqual(expect.arrayContaining(['Your pro has arrived', 'Approve an extra item?', 'Job done', 'Finding you another pro']));
    expect(titles.some(t => t.endsWith('is on the way'))).toBe(true);
    // chat → push to the other side; SOS → ops
    expect(to(cust.id).some(m => m.data?.type === 'message' && m.body === 'Reached, white truck')).toBe(true);
    expect(sent.some(m => m.data?.type === 'sos' && m.title === 'SOS: Rahul Sharma')).toBe(true);
    expect(to(p1.id).some(m => m.data?.type === 'kyc')).toBe(true);
  });

  it('lets ops inspect jobs, see the live map and suspend a partner', async () => {
    const live = await http().get('/v1/admin/live').set(auth(admin)).expect(200);
    expect(live.body.providers.map((p: any) => p.id)).toEqual(expect.arrayContaining([p1.id, p2.id]));
    const detail = await http().get(`/v1/admin/jobs/${jobId}`).set(auth(admin)).expect(200);
    expect(detail.body.status).toBe('PAID');
    expect(detail.body.startCode).toBeUndefined();
    await http().get('/v1/admin/live').set(auth(cust.token)).expect(403);

    await http().post(`/v1/admin/providers/${p2.id}/suspend`).set(auth(admin)).send({ suspended: true, reason: 'Overcharging complaint' }).expect(200);
    const after = await http().get('/v1/admin/live').set(auth(admin)).expect(200);
    expect(after.body.providers.map((p: any) => p.id)).not.toContain(p2.id);
    const blocked = await http().post('/v1/provider/status').set(auth(p2.token)).send({ online: true, lat: PICKUP.lat, lng: PICKUP.lng }).expect(403);
    expect(blocked.body.message).toMatch(/suspended/);
    const q = await http().post('/v1/jobs/quote').set(auth(cust.token)).send({ service: 'tow', pickup: PICKUP, drop: { lat: 18.79, lng: 73.43 } }).expect(200);
    expect(q.body.nearby).toBe(1); // only p1 is dispatchable now
    expect(app.get(PushService).sent.some(m => m.userId === p2.id && m.title === 'Account suspended')).toBe(true);
    await http().post(`/v1/admin/providers/${p2.id}/suspend`).set(auth(admin)).send({ suspended: false }).expect(200);
    await http().post('/v1/provider/status').set(auth(p2.token)).send({ online: true, lat: PICKUP.lat, lng: PICKUP.lng }).expect(200);
  });

  it('reports ops metrics', async () => {
    const o = await http().get('/v1/admin/overview').set(auth(admin)).expect(200);
    expect(o.body.geoIndex).toBe('redis');
    expect(o.body.completed).toBe(1);
    expect(o.body.gmv).toBeGreaterThan(0);
    expect(o.body.matchRate).toBe(100);
  });
});

describe('review fixes and new features', () => {
  // Far from Lonavala (Nashik) so the partners from the earlier suite are out of range.
  const SPOT = { lat: 20.0059, lng: 73.7897, label: 'Nashik Highway, near Dwarka circle' };
  const DROP = { lat: 20.03, lng: 73.80 };
  let admin: string, cust: { token: string; id: string }, a: { token: string; id: string }, b: { token: string; id: string };
  const svc = () => app.get(JobsService) as any;

  async function runToCompleted(service = 'puncture') {
    const j = (await http().post('/v1/jobs').set(auth(cust.token)).send({ service, pickup: SPOT, ...(service === 'tow' ? { drop: DROP } : {}), night: false }).expect(201)).body;
    await sleep(400);
    let holder = a;
    if ((await http().post(`/v1/jobs/${j.id}/accept`).set(auth(a.token))).status !== 200) { holder = b; await http().post(`/v1/jobs/${j.id}/accept`).set(auth(b.token)).expect(200); }
    await http().post(`/v1/jobs/${j.id}/arrived`).set(auth(holder.token)).expect(200);
    const code = (await http().get(`/v1/jobs/${j.id}`).set(auth(cust.token))).body.startCode;
    await http().post(`/v1/jobs/${j.id}/start`).set(auth(holder.token)).send({ code }).expect(200);
    await http().post(`/v1/jobs/${j.id}/complete`).set(auth(holder.token)).expect(200);
    return { id: j.id as string, holder };
  }

  beforeAll(async () => {
    admin = (await login('9999999999', 'ADMIN')).token;
    cust = await login('9876500050', 'CUSTOMER', 'Neha Joshi');
    a = await makeProvider('9800000051', 'Arjun Nair', ['puncture', 'tow', 'battery'], SPOT, admin);
    b = await makeProvider('9800000052', 'Deepak Yadav', ['puncture', 'tow', 'battery'], SPOT, admin);
  });

  it('cash is only "paid" after the partner confirms receiving it', async () => {
    const { id, holder } = await runToCompleted();
    const r = await http().post(`/v1/jobs/${id}/pay`).set(auth(cust.token)).send({ method: 'cash' }).expect(200);
    expect(r.body.status).toBe('COMPLETED');
    expect(r.body.payment.status).toBe('PENDING_CASH');
    // Reopening the partner app must bring back the "collect cash" job, not just the dashboard.
    const reopened = (await http().get('/v1/provider/me').set(auth(holder.token)).expect(200)).body;
    expect(reopened.activeJob?.id).toBe(id);
    expect(reopened.activeJob.payment.status).toBe('PENDING_CASH');
    await http().post(`/v1/jobs/${id}/cash-received`).set(auth(cust.token)).expect(403); // the customer cannot confirm their own cash
    const other = holder === a ? b : a;
    await http().post(`/v1/jobs/${id}/cash-received`).set(auth(other.token)).expect(403);
    const done = await http().post(`/v1/jobs/${id}/cash-received`).set(auth(holder.token)).expect(200);
    expect(done.body.status).toBe('PAID');
    expect(done.body.startCode).toBeUndefined();
    expect(app.get(PushService).sent.some(m => m.userId === holder.id && m.title.startsWith('Collect ₹'))).toBe(true);
  });

  it('tips go 100% to the partner, once, within limits', async () => {
    const { id, holder } = await runToCompleted();
    await http().post(`/v1/jobs/${id}/tip`).set(auth(cust.token)).send({ amount: 50 }).expect(409); // not paid yet
    await http().post(`/v1/jobs/${id}/pay`).set(auth(cust.token)).send({ method: 'upi' }).expect(200);
    const before = (await http().get('/v1/provider/me').set(auth(holder.token))).body.provider.earnings;
    await http().post(`/v1/jobs/${id}/tip`).set(auth(cust.token)).send({ amount: 5 }).expect(400);
    const t = await http().post(`/v1/jobs/${id}/tip`).set(auth(cust.token)).send({ amount: 50 }).expect(200);
    expect(t.body.tip).toBe(50);
    await http().post(`/v1/jobs/${id}/tip`).set(auth(cust.token)).send({ amount: 50 }).expect(409);
    const after = (await http().get('/v1/provider/me').set(auth(holder.token))).body.provider.earnings;
    expect(after - before).toBe(50);
  });

  it('"report a problem" creates a dispute that ops can resolve with a capped refund', async () => {
    const { id } = await runToCompleted();
    await http().post(`/v1/jobs/${id}/pay`).set(auth(cust.token)).send({ method: 'upi' }).expect(200);
    await http().post(`/v1/jobs/${id}/dispute`).set(auth(cust.token)).send({ reason: 'NOT_A_REASON' }).expect(400);
    const r = await http().post(`/v1/jobs/${id}/dispute`).set(auth(cust.token)).send({ reason: 'OVERCHARGED', details: 'Asked for 200 extra in cash' }).expect(200);
    expect(r.body.dispute.status).toBe('OPEN');
    await http().post(`/v1/jobs/${id}/dispute`).set(auth(cust.token)).send({ reason: 'OTHER' }).expect(409);
    const list = (await http().get('/v1/admin/disputes').set(auth(admin)).expect(200)).body;
    const d = list.find((x: any) => x.job.id === id);
    expect(d.reason).toBe('OVERCHARGED');
    expect((await http().get('/v1/admin/overview').set(auth(admin))).body.openDisputes).toBeGreaterThanOrEqual(1);
    await http().post(`/v1/admin/disputes/${d.id}/resolve`).set(auth(admin)).send({ resolution: 'Too much', refundAmount: d.job.maxRefund + 1 }).expect(400);
    const res = await http().post(`/v1/admin/disputes/${d.id}/resolve`).set(auth(admin)).send({ resolution: 'Partner warned. Refunding 100.', refundAmount: 100 }).expect(200);
    expect(res.body.dispute.status).toBe('RESOLVED');
    expect(res.body.dispute.refundAmount).toBe(100);
    expect(app.get(PushService).sent.some(m => m.userId === cust.id && m.title === '₹100 refund approved')).toBe(true);
  });

  it('late-arrival guard: free switch, and every other nearby partner is re-offered', async () => {
    const [sa, sb] = await Promise.all([connect(a.token), connect(b.token)]);
    const firstOfferB = waitFor<any>(sb, EVENTS.JOB_OFFER);
    const j = (await http().post('/v1/jobs').set(auth(cust.token)).send({ service: 'battery', pickup: SPOT, night: false }).expect(201)).body;
    await firstOfferB;
    await http().post(`/v1/jobs/${j.id}/accept`).set(auth(a.token)).expect(200);
    await http().post(`/v1/jobs/${j.id}/switch`).set(auth(cust.token)).expect(409); // not late yet
    // Pretend the promised arrival time passed long ago; the dispatcher flags it on its next tick.
    await db.job.update({ where: { id: j.id }, data: { promisedBy: new Date(Date.now() - 60 * 60_000) } });
    await waitFor<any>(sa, EVENTS.JOB_UPDATED, x => x.id === j.id && x.late === true);
    expect(app.get(PushService).sent.some(m => m.userId === cust.id && m.title.endsWith('is running late'))).toBe(true);
    const reoffer = waitFor<any>(sb, EVENTS.JOB_OFFER, o => o.jobId === j.id);
    const s = await http().post(`/v1/jobs/${j.id}/switch`).set(auth(cust.token)).expect(200);
    expect(s.body.status).toBe('SEARCHING');
    expect(s.body.late).toBe(false);
    await reoffer; // B was offered before; the release must offer it again
    await http().post(`/v1/jobs/${j.id}/accept`).set(auth(a.token)).expect(403); // the late partner cannot take it back
    await http().post(`/v1/jobs/${j.id}/accept`).set(auth(b.token)).expect(200);
    await http().post(`/v1/jobs/${j.id}/cancel`).set(auth(cust.token)).send({}).expect(200);
  });

  it('expired offers disappear on reopen and cannot be accepted', async () => {
    const j = (await http().post('/v1/jobs').set(auth(cust.token)).send({ service: 'battery', pickup: SPOT, night: false }).expect(201)).body;
    const me = (await http().get('/v1/provider/me').set(auth(a.token)).expect(200)).body;
    const o = me.offers.find((x: any) => x.jobId === j.id);
    expect(new Date(o.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(20_000);
    svc().offerAt.get(j.id).set(a.id, Date.now() - 60_000); // the offer to A was sent a minute ago
    expect((await http().get('/v1/provider/me').set(auth(a.token))).body.offers.some((x: any) => x.jobId === j.id)).toBe(false);
    const r = await http().post(`/v1/jobs/${j.id}/accept`).set(auth(a.token)).expect(409);
    expect(r.body.message).toMatch(/expired/);
    await http().post(`/v1/jobs/${j.id}/cancel`).set(auth(cust.token)).send({}).expect(200);
  });

  it('"top-rated pros only" skips partners below 4.5 stars', async () => {
    await db.provider.update({ where: { userId: b.id }, data: { rating: 4.1 } });
    const j = (await http().post('/v1/jobs').set(auth(cust.token)).send({ service: 'battery', pickup: SPOT, night: false, topRatedOnly: true }).expect(201)).body;
    expect(j.topRatedOnly).toBe(true);
    const offeredTo = (await db.job.findUnique({ where: { id: j.id } }))!.offeredIds;
    expect(offeredTo).toContain(a.id);
    expect(offeredTo).not.toContain(b.id);
    await http().post(`/v1/jobs/${j.id}/accept`).set(auth(b.token)).expect(403);
    await http().post(`/v1/jobs/${j.id}/cancel`).set(auth(cust.token)).send({}).expect(200);
    await db.provider.update({ where: { userId: b.id }, data: { rating: 4.8 } });
  });

  it('shows partners where and when demand happens', async () => {
    const h = (await http().get('/v1/provider/hotspots').set(auth(a.token)).expect(200)).body;
    expect(h.total).toBeGreaterThanOrEqual(5);
    expect(h.hours).toHaveLength(24);
    expect(h.hotspots[0].label).toBe(SPOT.label);
    expect(h.hotspots[0].requests).toBeGreaterThanOrEqual(5);
    await http().get('/v1/provider/hotspots').set(auth(cust.token)).expect(403);
  });

  it('limits login-code requests per network and serves garages without crashing offline', async () => {
    expect((await http().get(`/v1/places/garages?lat=${SPOT.lat}&lng=${SPOT.lng}`).set(auth(cust.token)).expect(200)).body).toEqual([]);
    const prev = config.otpPerIpPer15Min;
    config.otpPerIpPer15Min = 0;
    await http().post('/v1/auth/otp/request').send({ phone: '9876500099' }).expect(429);
    config.otpPerIpPer15Min = prev;
  });
});

describe('nearby garages (Google Places)', () => {
  it('asks Google for car repair shops nearby, lists open ones first, and falls back when Google fails', async () => {
    const cust = await login('9876500077', 'CUSTOMER', 'Garage Tester');
    const prev = { driver: config.placesDriver, key: config.googlePlacesKey };
    const realFetch = global.fetch;
    const seen: { url: string; headers: any; body: any }[] = [];
    let googleDown = false;
    global.fetch = (async (url: any, init: any) => {
      const u = String(url);
      if (u.startsWith('https://places.googleapis.com/')) {
        seen.push({ url: u, headers: init.headers, body: JSON.parse(init.body) });
        if (googleDown) return new Response('quota exceeded', { status: 429 });
        return new Response(JSON.stringify({ places: [
          { displayName: { text: 'Closed Motors' }, location: { latitude: 18.756, longitude: 73.407 }, currentOpeningHours: { openNow: false }, businessStatus: 'OPERATIONAL' },
          { displayName: { text: 'Shut For Good Garage' }, location: { latitude: 18.755, longitude: 73.406 }, businessStatus: 'CLOSED_PERMANENTLY' },
          { displayName: { text: 'Highway Auto Works' }, location: { latitude: 18.79, longitude: 73.43 }, nationalPhoneNumber: '098230 12345', currentOpeningHours: { openNow: true }, rating: 4.4, businessStatus: 'OPERATIONAL' },
        ] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (u.includes('overpass')) return new Response(JSON.stringify({ elements: [{ lat: 18.76, lon: 73.41, tags: { name: 'OSM Garage' } }] }), { status: 200 });
      return realFetch(url, init);
    }) as any;
    try {
      config.placesDriver = 'on'; config.googlePlacesKey = 'test-key';
      const g = (await http().get('/v1/places/garages?lat=18.7546&lng=73.4062').set(auth(cust.token)).expect(200)).body;
      expect(seen[0].headers['X-Goog-Api-Key']).toBe('test-key');
      expect(seen[0].headers['X-Goog-FieldMask']).toContain('places.currentOpeningHours.openNow');
      expect(seen[0].body).toMatchObject({ includedTypes: ['car_repair'], rankPreference: 'DISTANCE', locationRestriction: { circle: { radius: 20000 } } });
      expect(g.map((x: any) => x.name)).toEqual(['Highway Auto Works', 'Closed Motors']); // open first; permanently closed dropped
      expect(g[0]).toMatchObject({ openNow: true, rating: 4.4, phone: '098230 12345', source: 'google' });
      expect(g[0].km).toBeGreaterThan(g[1].km); // ordering is by open-now, not distance
      googleDown = true; // different cell, so not served from cache
      const fb = (await http().get('/v1/places/garages?lat=18.80&lng=73.45').set(auth(cust.token)).expect(200)).body;
      expect(fb.map((x: any) => [x.name, x.source])).toEqual([['OSM Garage', 'osm']]);
    } finally {
      global.fetch = realFetch; config.placesDriver = prev.driver; config.googlePlacesKey = prev.key;
    }
  });
});

describe('family tracking page', () => {
  it('serves the share page at /t/:id, keeps it safe, and expires links 2 h after the trip', async () => {
    const page = await http().get('/t/abc123').expect(200);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    expect(page.headers['x-robots-tag']).toBe('noindex');
    expect(page.text).toContain('/v1/track/');
    const evil = await http().get('/t/' + encodeURIComponent('x"</script><script>alert(1)</script>')).expect(200);
    expect(evil.text).not.toContain('<script>alert(1)');
    // An old finished job: link expired.
    const done = await db.job.findFirst({ where: { status: 'PAID' } });
    await db.job.update({ where: { id: done!.id }, data: { paidAt: new Date(Date.now() - 3 * 3600_000) } });
    await http().get(`/v1/track/${done!.id}`).expect(410);
    await http().get('/v1/track/does-not-exist').expect(404);
  });
});

describe('proof of work, automatic arrival, trust score, IST', () => {
  // Hyderabad, far from the other suites' partners.
  const SPOT = { lat: 17.385, lng: 78.4867, label: 'Banjara Hills Rd 12' };
  let admin: string, cust: { token: string; id: string }, pro: { token: string; id: string };
  // Smallest valid JPEG-looking payload: JPEG magic bytes + padding (the API checks real file type, not the mime).
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7), Buffer.from([0xff, 0xd9])]).toString('base64');

  beforeAll(async () => {
    admin = (await login('9999999999', 'ADMIN')).token;
    cust = await login('9876500088', 'CUSTOMER', 'Kavya Rao');
    pro = await makeProvider('9800000088', 'Vikram Singh', ['battery'], SPOT, admin);
  });
  const newJob = async () => {
    const j = (await http().post('/v1/jobs').set(auth(cust.token)).send({ service: 'battery', pickup: SPOT, night: false }).expect(201)).body;
    await http().post(`/v1/jobs/${j.id}/accept`).set(auth(pro.token)).expect(200);
    return j.id as string;
  };

  it('rejects "arrived" taps from far away and auto-arrives inside the geofence', async () => {
    const id = await newJob();
    await http().post('/v1/provider/location').set(auth(pro.token)).send({ lat: SPOT.lat + 0.02, lng: SPOT.lng }).expect(200); // ~2.2 km away
    const far = await http().post(`/v1/jobs/${id}/arrived`).set(auth(pro.token)).expect(409);
    expect(far.body.message).toMatch(/km from the customer/);
    const r = await http().post('/v1/provider/location').set(auth(pro.token)).send({ lat: SPOT.lat + 0.0005, lng: SPOT.lng }).expect(200); // ~55 m
    expect(r.body.arrived).toBe(true);
    const j = (await http().get(`/v1/jobs/${id}`).set(auth(cust.token))).body;
    expect(j.status).toBe('ARRIVED');
    expect(j.arrivedAuto).toBe(true);
    expect(j.events.some((e: any) => e.text.includes('location confirmed'))).toBe(true);
    await http().post(`/v1/jobs/${id}/cancel`).set(auth(cust.token)).send({}).expect(200);
  });

  it('stores before/after photos, shows them to the customer via signed links, and hides them publicly', async () => {
    const id = await newJob();
    await http().post('/v1/provider/location').set(auth(pro.token)).send({ lat: SPOT.lat, lng: SPOT.lng }).expect(200); // arrives
    await http().post(`/v1/jobs/${id}/photos`).set(auth(pro.token)).send({ kind: 'AFTER', mime: 'image/jpeg', data: jpeg }).expect(409); // not started yet
    await http().post(`/v1/jobs/${id}/photos`).set(auth(pro.token)).send({ kind: 'BEFORE', mime: 'image/jpeg', data: Buffer.from('x'.repeat(300)).toString('base64') }).expect(400); // not an image
    await http().post(`/v1/jobs/${id}/photos`).set(auth(cust.token)).send({ kind: 'BEFORE', mime: 'image/jpeg', data: jpeg }).expect(403);
    await http().post(`/v1/jobs/${id}/photos`).set(auth(pro.token)).send({ kind: 'BEFORE', mime: 'image/jpeg', data: jpeg }).expect(200);
    const code = (await http().get(`/v1/jobs/${id}`).set(auth(cust.token))).body.startCode;
    await http().post(`/v1/jobs/${id}/start`).set(auth(pro.token)).send({ code }).expect(200);
    await http().post(`/v1/jobs/${id}/photos`).set(auth(pro.token)).send({ kind: 'AFTER', mime: 'image/jpeg', data: jpeg }).expect(200);
    const j = (await http().get(`/v1/jobs/${id}`).set(auth(cust.token))).body;
    expect(j.photos.map((p: any) => p.kind)).toEqual(['BEFORE', 'AFTER']);
    const path = new URL(j.photos[0].url).pathname + new URL(j.photos[0].url).search;
    const img = await http().get(path).expect(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    await http().get(path.replace(/sig=[0-9a-f]+/, 'sig=' + '0'.repeat(32))).expect(403); // tampered link
    expect((await http().get(`/v1/track/${id}`)).body.photos).toBeUndefined(); // not on the family page
    await http().post(`/v1/jobs/${id}/complete`).set(auth(pro.token)).expect(200);
  });

  it('builds a trust score from on-time arrivals, releases and refunded overcharges', async () => {
    // Two more on-time arrivals → enough history for a score.
    for (let i = 0; i < 2; i++) {
      const id = await newJob();
      await http().post('/v1/provider/location').set(auth(pro.token)).send({ lat: SPOT.lat, lng: SPOT.lng }).expect(200);
      const code = (await http().get(`/v1/jobs/${id}`).set(auth(cust.token))).body.startCode;
      await http().post(`/v1/jobs/${id}/start`).set(auth(pro.token)).send({ code }).expect(200);
      await http().post(`/v1/jobs/${id}/complete`).set(auth(pro.token)).expect(200);
      await http().post(`/v1/jobs/${id}/pay`).set(auth(cust.token)).send({ method: 'upi' }).expect(200);
      if (i === 1) await http().post(`/v1/jobs/${id}/dispute`).set(auth(cust.token)).send({ reason: 'OVERCHARGED', details: 'Asked for extra cash' }).expect(200);
    }
    let t = (await http().get('/v1/provider/me').set(auth(pro.token))).body.provider.trust;
    expect(t.onTimePct).toBe(100);
    expect(t.cleanStreak).toBe(3);
    expect(t.score).toBe(100); // 0.6×100 + 0.25×100 + 15
    const d = (await http().get('/v1/admin/disputes').set(auth(admin))).body.find((x: any) => x.provider?.id === pro.id && x.status === 'OPEN');
    await http().post(`/v1/admin/disputes/${d.id}/resolve`).set(auth(admin)).send({ resolution: 'Refunding the extra charge', refundAmount: 50 }).expect(200);
    t = (await http().get('/v1/provider/me').set(auth(pro.token))).body.provider.trust;
    expect(t.overchargeRefunds).toBe(1);
    expect(t.cleanStreak).toBe(0);
    expect(t.score).toBe(95);
    // Customers see it on the job.
    const id = await newJob();
    const view = (await http().get(`/v1/jobs/${id}`).set(auth(cust.token))).body;
    expect(view.provider.trust.score).toBe(95);
    await http().post(`/v1/jobs/${id}/cancel`).set(auth(cust.token)).send({}).expect(200);
  });

  it('judges night pricing in IST, whatever the server clock zone', () => {
    expect(localHour(new Date('2026-11-27T16:45:00Z'))).toBe(22); // 22:15 IST
    expect(localHour(new Date('2026-11-27T00:15:00Z'))).toBe(5);  // 05:45 IST
    expect(localHour(new Date('2026-11-27T01:00:00Z'))).toBe(6);  // 06:30 IST
  });
});
