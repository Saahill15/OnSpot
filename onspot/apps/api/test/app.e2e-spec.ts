// End-to-end: real Nest app, real Postgres (onspot_test), real Redis (db 1), real Socket.IO clients.
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { EVENTS } from '@onspot/shared';
import { createApp } from '../src/main';
import { PushService } from '../src/infra';

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
  await http().post('/v1/provider/status').set(auth(p.token)).send({ online: true, lat: at.lat + 0.005, lng: at.lng + 0.005 }).expect(200);
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
