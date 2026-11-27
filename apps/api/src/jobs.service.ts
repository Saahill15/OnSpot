// Job lifecycle (state machine), dispatch loop, payments. The single place that mutates jobs.
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { createHmac, randomBytes, randomInt } from 'crypto';
import {
  ACTIVE_STATUSES, computeQuote, EVENTS, etaMinutes, isNightHour, isServiceCode, JobOffer, LatLng, PRICING, providerPayout, roadKm, ServiceCode, SERVICE_BY_CODE,
} from '@onspot/shared';
import { config, GeoService, PrismaService, PushService, RealtimeService, SmsService } from './infra';
import type { AuthUser } from './auth';

const FULL = { events: { orderBy: { at: 'asc' } }, addons: { orderBy: { createdAt: 'asc' } }, messages: { orderBy: { at: 'asc' } }, payment: true, ratings: true, dispute: true, customer: true, provider: { include: { user: true } } } satisfies Prisma.JobInclude;
type FullJob = Prisma.JobGetPayload<{ include: typeof FULL }>;
type Viewer = 'customer' | 'provider' | 'admin' | 'public';

const mask = (p?: string | null) => (p ? `${p.slice(0, 2)}XXXXXX${p.slice(-2)}` : '');

/** What each party may see. The start code never reaches the provider. */
export function jobView(j: FullJob, viewer: Viewer) {
  const p = j.provider;
  return {
    id: j.id, status: j.status, service: j.service,
    pickup: { lat: j.pickupLat, lng: j.pickupLng, label: j.pickupLabel },
    drop: j.dropLat != null ? { lat: j.dropLat, lng: j.dropLng } : null,
    quote: j.quote, total: j.total, platformFee: j.platformFee,
    finalAmount: j.finalAmount, providerPayout: viewer === 'customer' ? undefined : j.providerPayout,
    eta: j.eta, radiusKm: j.radiusKm, offeredCount: j.offeredIds.length,
    startCode: viewer === 'customer' ? j.startCode : undefined,
    notes: viewer === 'public' ? undefined : j.notes, vehicle: j.vehicle,
    customer: { name: viewer === 'public' ? j.customer.name.split(' ')[0] : j.customer.name, phone: viewer === 'public' ? undefined : mask(j.customer.phone) },
    provider: p && { id: p.userId, name: p.user.name, phone: viewer === 'public' ? undefined : mask(p.user.phone), rating: +p.rating.toFixed(2), ratingCount: p.ratingCount, vehicleNo: p.vehicleNo, verified: p.kycStatus === 'VERIFIED', lat: p.lat, lng: p.lng },
    addons: j.addons.map(a => ({ id: a.id, label: a.label, amount: a.amount, reason: a.reason, status: a.status })),
    messages: viewer === 'public' ? undefined : j.messages.map(m => ({ id: m.id, from: m.from, text: m.text, at: m.at })),
    events: j.events.map(e => ({ text: e.text, at: e.at })),
    payment: j.payment && { method: j.payment.method, amount: j.payment.amount, status: j.payment.status, ref: j.payment.ref },
    ratings: Object.fromEntries(j.ratings.map(r => [r.by, { stars: r.stars, comment: r.comment }])),
    cancelReason: j.cancelReason, cancelFee: j.cancelFee, tip: j.tip,
    topRatedOnly: j.minRating != null, promisedBy: j.promisedBy, late: !!j.lateAt,
    dispute: viewer === 'customer' || viewer === 'admin' ? (j.dispute && { id: j.dispute.id, reason: j.dispute.reason, details: j.dispute.details, status: j.dispute.status, resolution: j.dispute.resolution, refundAmount: j.dispute.refundAmount, createdAt: j.dispute.createdAt }) : undefined,
    createdAt: j.createdAt, assignedAt: j.assignedAt, arrivedAt: j.arrivedAt, startedAt: j.startedAt, completedAt: j.completedAt, paidAt: j.paidAt,
  };
}
export type JobView = ReturnType<typeof jobView>;

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger('Jobs');
  private timer?: NodeJS.Timeout;
  private ticking = false;
  /** jobId → providerId → when the offer was sent. Offers expire after `offerTtlSec`. (Per-instance; move to Redis with BullMQ.) */
  private offerAt = new Map<string, Map<string, number>>();
  private offerExpired(jobId: string, providerId: string) {
    const at = this.offerAt.get(jobId)?.get(providerId);
    return at != null && Date.now() - at > (config.offerTtlSec + 5) * 1000; // 5 s grace for slow networks
  }
  constructor(private db: PrismaService, private geo: GeoService, private rt: RealtimeService, private sms: SmsService, private push: PushService) {}
  /** Push to the customer about their request; `data.jobId` lets the app open the right screen on tap. */
  private tellCustomer(j: { id: string; customerId: string }, title: string, body: string) {
    this.push.notify(j.customerId, { title, body, data: { type: 'job', jobId: j.id }, channelId: 'jobs' });
  }

  // ------------------------------------------------------------ boot: rebuild geo index, start dispatcher
  async onModuleInit() {
    const avail = await this.db.provider.findMany({ where: { online: true, kycStatus: 'VERIFIED', activeJobId: null, lat: { not: null } } });
    for (const p of avail) await this.geo.index.upsert(p.userId, p.lat!, p.lng!, p.services as ServiceCode[]);
    this.timer = setInterval(() => this.tick().catch(e => this.log.error(e)), config.dispatchTickMs);
  }
  onModuleDestroy() { clearInterval(this.timer); }

  // ------------------------------------------------------------ helpers
  async load(id: string) {
    const j = await this.db.job.findUnique({ where: { id }, include: FULL });
    if (!j) throw new NotFoundException('Request not found');
    return j;
  }
  viewerOf(j: FullJob, u: AuthUser): Viewer {
    if (u.role === 'ADMIN') return 'admin';
    if (j.customerId === u.sub) return 'customer';
    if (j.providerId === u.sub) return 'provider';
    throw new ForbiddenException('Not your request');
  }
  async event(jobId: string, text: string) { await this.db.jobEvent.create({ data: { jobId, text } }); }
  async broadcast(id: string) {
    const j = await this.load(id);
    this.rt.toUser(j.customerId, EVENTS.JOB_UPDATED, jobView(j, 'customer'));
    if (j.providerId) this.rt.toUser(j.providerId, EVENTS.JOB_UPDATED, jobView(j, 'provider'));
    this.rt.toAdmins(EVENTS.JOB_UPDATED, jobView(j, 'admin'));
    return j;
  }
  private async shieldActive(userId: string) {
    const u = await this.db.user.findUnique({ where: { id: userId } });
    return !!u?.shieldUntil && u.shieldUntil > new Date();
  }
  private async nearestAvailableKm(service: ServiceCode, at: LatLng) {
    const hits = await this.geo.index.nearby(service, at.lat, at.lng, 50);
    return { count: hits.length, km: hits[0]?.km };
  }
  private async makeAvailable(providerId: string) {
    const p = await this.db.provider.findUnique({ where: { userId: providerId } });
    if (p && p.online && p.kycStatus === 'VERIFIED' && !p.activeJobId && p.lat != null) await this.geo.index.upsert(p.userId, p.lat, p.lng!, p.services as ServiceCode[]);
  }

  /** Per-service availability at a point (counts + ETA only; provider positions stay private). */
  async availability(at: LatLng) {
    const out: Record<string, { count: number; etaMin: number | null }> = {};
    for (const s of Object.keys(SERVICE_BY_CODE) as ServiceCode[]) {
      const hits = await this.geo.index.nearby(s, at.lat, at.lng, 50);
      out[s] = { count: hits.length, etaMin: hits[0] ? etaMinutes(hits[0].km) : null };
    }
    return out;
  }

  // ------------------------------------------------------------ quote + create
  async quote(u: AuthUser, body: { service: string; pickup: LatLng; drop?: LatLng | null; night?: boolean }) {
    if (!isServiceCode(body.service)) throw new BadRequestException('Unknown service');
    const near = await this.nearestAvailableKm(body.service, body.pickup);
    const night = body.night ?? isNightHour(new Date().getHours());
    const q = computeQuote({ service: body.service, pickup: body.pickup, drop: body.service === 'tow' ? body.drop : null, approachKm: near.km ?? 4, night, shield: await this.shieldActive(u.sub) });
    return { quote: q, nearby: near.count };
  }

  async create(u: AuthUser, b: { service: string; pickup: LatLng & { label?: string }; drop?: LatLng | null; notes?: string; vehicle?: string; night?: boolean; topRatedOnly?: boolean }) {
    if (!isServiceCode(b.service)) throw new BadRequestException('Unknown service');
    if (b.service === 'tow' && !b.drop) throw new BadRequestException('Choose where to tow the vehicle');
    const active = await this.db.job.findFirst({ where: { customerId: u.sub, status: { in: ACTIVE_STATUSES } } });
    if (active) throw new ConflictException('You already have an active request');
    const { quote } = await this.quote(u, b);
    const j = await this.db.job.create({
      data: {
        customerId: u.sub, service: b.service, pickupLat: b.pickup.lat, pickupLng: b.pickup.lng, pickupLabel: (b.pickup.label || '').slice(0, 120),
        dropLat: b.drop?.lat, dropLng: b.drop?.lng, notes: (b.notes || '').slice(0, 300), vehicle: (b.vehicle || '').slice(0, 60),
        quote: quote as unknown as Prisma.InputJsonValue, total: quote.total, platformFee: quote.platformFee,
        startCode: String(randomInt(1000, 10000)), searchStartedAt: new Date(), minRating: b.topRatedOnly ? config.topRatedMin : null,
        events: { create: { text: `Request created · fare locked at ₹${quote.total}${b.topRatedOnly ? ` · top-rated pros only (${config.topRatedMin}★+)` : ''}` } },
      },
    });
    await this.tickJob(j.id); // dispatch immediately, don't wait for the next tick
    return jobView(await this.broadcast(j.id), 'customer');
  }

  // ------------------------------------------------------------ dispatch loop
  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const searching = await this.db.job.findMany({ where: { status: 'SEARCHING' }, select: { id: true } });
      for (const { id } of searching) await this.tickJob(id);
      await this.checkLate();
    } finally { this.ticking = false; }
  }

  /** Late-arrival guard: a partner well past the arrival time they accepted with gets flagged once.
   *  The customer is offered a free switch; ops see it live. */
  private async checkLate() {
    const cutoff = new Date(Date.now() - config.lateGraceMin * 60_000);
    const late = await this.db.job.findMany({ where: { status: 'ASSIGNED', lateAt: null, promisedBy: { lt: cutoff } }, include: { provider: { include: { user: true } } } });
    for (const j of late) {
      const r = await this.db.job.updateMany({ where: { id: j.id, status: 'ASSIGNED', lateAt: null }, data: { lateAt: new Date() } });
      if (!r.count) continue;
      const mins = Math.round((Date.now() - j.promisedBy!.getTime()) / 60_000);
      await this.event(j.id, `Partner is running late (${mins} min past the promised time) · customer can switch for free`);
      this.tellCustomer(j, `${j.provider?.user.name ?? 'Your pro'} is running late`, 'Want someone else? Switch to the next nearest pro for free. Your locked fare stays the same.');
      if (j.providerId) this.push.notify(j.providerId, { title: "You're running late", body: 'The customer can now switch to another pro. Message them or hurry, please.', data: { type: 'job', jobId: j.id }, channelId: 'jobs' });
      this.rt.toAdmins('job.late', { jobId: j.id, provider: j.provider?.user.name, minutesLate: mins });
      await this.broadcast(j.id);
    }
  }

  private async tickJob(id: string) {
    const j = await this.db.job.findUnique({ where: { id } });
    if (!j || j.status !== 'SEARCHING') return;
    // Clamp: DB and app clocks can differ by a few ms; negative elapsed must not break radius lookup.
    const elapsed = Math.max(0, (Date.now() - j.searchStartedAt.getTime()) / 1000);
    if (elapsed > config.searchTimeoutSec) {
      const r = await this.db.job.updateMany({ where: { id, status: 'SEARCHING' }, data: { status: 'NO_PROVIDER' } });
      if (r.count) {
        await this.event(id, 'No provider found nearby'); await this.revokeOffers(j.offeredIds, id); await this.broadcast(id);
        this.tellCustomer(j, 'No provider available right now', 'We searched up to 50 km. Try again, or call 112 / 1033 in an emergency.');
      }
      return;
    }
    const shieldBoost = (j.quote as any)?.shield ? 15 : 0; // Shield: wider search from the first second
    const radius = (config.radiusSteps.filter(([s]) => elapsed + shieldBoost >= s).pop() ?? config.radiusSteps[0])[1];
    let changed = false;
    if (radius !== j.radiusKm) { await this.db.job.update({ where: { id }, data: { radiusKm: radius } }); await this.event(id, `Searching within ${radius} km`); changed = true; }
    const hits = await this.geo.index.nearby(j.service as ServiceCode, j.pickupLat, j.pickupLng, radius);
    let fresh = hits.filter(h => !j.offeredIds.includes(h.id) && !j.declinedIds.includes(h.id) && h.id !== j.customerId);
    if (j.minRating != null && fresh.length) {
      // "Top-rated pros only": the geo index has no ratings, so filter the candidates against the DB.
      const ok = await this.db.provider.findMany({ where: { userId: { in: fresh.map(h => h.id) }, rating: { gte: j.minRating } }, select: { userId: true } });
      const set = new Set(ok.map(o => o.userId));
      fresh = fresh.filter(h => set.has(h.id));
    }
    if (fresh.length) {
      const sent = this.offerAt.get(id) ?? new Map<string, number>();
      for (const h of fresh) sent.set(h.id, Date.now());
      this.offerAt.set(id, sent);
      await this.db.job.update({ where: { id }, data: { offeredIds: { push: fresh.map(h => h.id) } } });
      const cust = await this.db.user.findUnique({ where: { id: j.customerId } });
      for (const h of fresh) {
        const offer: JobOffer = {
          jobId: id, service: j.service as ServiceCode, km: +h.km.toFixed(1), fare: j.total, payout: providerPayout(j.total, j.platformFee),
          pickup: { lat: j.pickupLat, lng: j.pickupLng, label: j.pickupLabel }, customerName: cust?.name || 'Customer',
          expiresAt: new Date(Date.now() + config.offerTtlSec * 1000).toISOString(),
        };
        this.rt.toUser(h.id, EVENTS.JOB_OFFER, offer);
        // Push reaches partners whose app is in the background or closed. Expires with the offer.
        this.push.notify(h.id, {
          title: `New ${SERVICE_BY_CODE[offer.service].name.toLowerCase()} request`,
          body: `${offer.km} km away · you earn ₹${offer.payout}. Tap to accept.`,
          data: { type: 'offer', jobId: id }, channelId: 'offers', ttl: config.offerTtlSec,
        });
      }
      changed = true;
    }
    if (changed) await this.broadcast(id);
  }
  private async revokeOffers(ids: string[], jobId: string, except?: string) {
    for (const pid of ids) if (pid !== except) this.rt.toUser(pid, EVENTS.JOB_OFFER_REVOKED, { jobId });
  }

  async offersFor(providerId: string) {
    const jobs = await this.db.job.findMany({ where: { status: 'SEARCHING', offeredIds: { has: providerId }, NOT: { declinedIds: { has: providerId } } }, include: { customer: true } });
    const p = await this.db.provider.findUnique({ where: { userId: providerId } });
    // Only offers still inside their window, with the real expiry (not a fresh 20 s on every app open).
    return jobs.filter(j => !this.offerExpired(j.id, providerId)).map(j => {
      const sentAt = this.offerAt.get(j.id)?.get(providerId) ?? Date.now();
      return {
        jobId: j.id, service: j.service, km: p?.lat != null ? +roadKm(p as LatLng, { lat: j.pickupLat, lng: j.pickupLng }).toFixed(1) : null, fare: j.total,
        payout: providerPayout(j.total, j.platformFee), pickup: { lat: j.pickupLat, lng: j.pickupLng, label: j.pickupLabel }, customerName: j.customer.name,
        expiresAt: new Date(sentAt + config.offerTtlSec * 1000).toISOString(),
        // Seconds left by the server's clock; phones' clocks can be minutes off, so apps count down from this.
        expiresInSec: Math.max(0, Math.round((sentAt + config.offerTtlSec * 1000 - Date.now()) / 1000)),
      };
    });
  }

  // ------------------------------------------------------------ provider actions
  async accept(u: AuthUser, id: string) {
    const p = await this.db.provider.findUnique({ where: { userId: u.sub } });
    if (!p || p.kycStatus !== 'VERIFIED' || !p.online) throw new ForbiddenException('Go online (with verified KYC) to accept jobs');
    const job = await this.db.job.findUnique({ where: { id } });
    if (!job?.offeredIds.includes(u.sub)) throw new ForbiddenException('This job was not offered to you');
    if (this.offerExpired(id, u.sub)) throw new ConflictException('This offer has expired');
    const eta = p.lat != null ? etaMinutes(roadKm(p as LatLng, { lat: job.pickupLat, lng: job.pickupLng })) : null;
    try {
      await this.db.$transaction(async tx => {
        // First accept wins: both conditional updates must succeed or the whole thing rolls back.
        const a = await tx.job.updateMany({ where: { id, status: 'SEARCHING' }, data: { status: 'ASSIGNED', providerId: u.sub, assignedAt: new Date(), eta, promisedBy: new Date(Date.now() + (eta ?? 15) * 60_000), lateAt: null } });
        if (!a.count) throw new ConflictException('Another provider already took this job');
        const b = await tx.provider.updateMany({ where: { userId: u.sub, activeJobId: null }, data: { activeJobId: id } });
        if (!b.count) throw new ConflictException('Finish your current job first');
      });
    } catch (e) { if (e instanceof ConflictException) throw e; throw new ConflictException('Could not accept this job'); }
    await this.geo.index.remove(u.sub);
    this.offerAt.delete(id);
    const j = await this.load(id);
    await this.event(id, `${j.provider!.user.name} accepted · arriving in about ${j.eta ?? '?'} min`);
    this.tellCustomer(j, `${j.provider!.user.name} is on the way`, `Arriving in about ${j.eta ?? 'a few'} min. Tap to track live.`);
    await this.revokeOffers(j.offeredIds, id, u.sub);
    return jobView(await this.broadcast(id), 'provider');
  }

  async decline(u: AuthUser, id: string) {
    await this.db.job.updateMany({ where: { id, status: 'SEARCHING', NOT: { declinedIds: { has: u.sub } } }, data: { declinedIds: { push: u.sub } } });
    return { ok: true };
  }

  private async mustBeProvider(u: AuthUser, id: string, status: string[]) {
    const j = await this.load(id);
    if (j.providerId !== u.sub) throw new ForbiddenException('Not your job');
    if (!status.includes(j.status)) throw new ConflictException(`Not possible while the job is ${j.status.toLowerCase().replace('_', ' ')}`);
    return j;
  }
  private async mustBeCustomer(u: AuthUser, id: string, status?: string[]) {
    const j = await this.load(id);
    if (j.customerId !== u.sub) throw new ForbiddenException('Not your request');
    if (status && !status.includes(j.status)) throw new ConflictException(`Not possible while the request is ${j.status.toLowerCase().replace('_', ' ')}`);
    return j;
  }

  async arrived(u: AuthUser, id: string) {
    await this.mustBeProvider(u, id, ['ASSIGNED']);
    await this.db.job.update({ where: { id }, data: { status: 'ARRIVED', arrivedAt: new Date(), eta: 0 } });
    await this.event(id, 'Provider has arrived');
    this.tellCustomer((await this.db.job.findUnique({ where: { id } }))!, 'Your pro has arrived', 'Share your 4-digit start code when they are with you.');
    return jobView(await this.broadcast(id), 'provider');
  }

  async start(u: AuthUser, id: string, code: string) {
    const j = await this.mustBeProvider(u, id, ['ARRIVED']);
    if (j.otpTries >= 5) throw new ForbiddenException('Too many wrong codes. Contact support.');
    if (String(code) !== j.startCode) {
      await this.db.job.update({ where: { id }, data: { otpTries: { increment: 1 } } });
      throw new BadRequestException('Wrong code. Ask the customer for the 4-digit start code.');
    }
    await this.db.job.update({ where: { id }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
    await this.event(id, 'Start code verified · work started');
    return jobView(await this.broadcast(id), 'provider');
  }

  async proposeAddon(u: AuthUser, id: string, b: { label: string; amount: number; reason?: string }) {
    await this.mustBeProvider(u, id, ['IN_PROGRESS']);
    const amount = Math.round(+b.amount);
    if (!b.label?.trim() || !(amount > 0 && amount <= 50000)) throw new BadRequestException('Enter the item and an amount up to ₹50,000');
    const a = await this.db.addon.create({ data: { jobId: id, label: b.label.trim().slice(0, 60), amount, reason: (b.reason || '').slice(0, 120) } });
    await this.event(id, `Extra item proposed: ${a.label} ₹${a.amount}, awaiting approval`);
    this.tellCustomer((await this.db.job.findUnique({ where: { id } }))!, 'Approve an extra item?', `${a.label} · ₹${a.amount}. You're only charged if you approve.`);
    return jobView(await this.broadcast(id), 'provider');
  }

  async decideAddon(u: AuthUser, id: string, addonId: string, approve: boolean) {
    await this.mustBeCustomer(u, id, ['IN_PROGRESS']);
    const r = await this.db.addon.updateMany({ where: { id: addonId, jobId: id, status: 'PENDING' }, data: { status: approve ? 'APPROVED' : 'REJECTED' } });
    if (!r.count) throw new ConflictException('Already decided');
    const a = await this.db.addon.findUnique({ where: { id: addonId } });
    await this.event(id, `${a!.label} ₹${a!.amount} ${approve ? 'approved' : 'declined'} by customer`);
    return jobView(await this.broadcast(id), 'customer');
  }

  async complete(u: AuthUser, id: string) {
    const j = await this.mustBeProvider(u, id, ['IN_PROGRESS']);
    if (j.addons.some(a => a.status === 'PENDING')) throw new ConflictException('Wait for the customer to approve or decline extra items');
    const finalAmount = j.total + j.addons.filter(a => a.status === 'APPROVED').reduce((t, a) => t + a.amount, 0);
    const payout = providerPayout(finalAmount, j.platformFee);
    await this.db.$transaction([
      this.db.job.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date(), finalAmount, providerPayout: payout } }),
      this.db.provider.update({ where: { userId: u.sub }, data: { activeJobId: null, jobsDone: { increment: 1 }, earnings: { increment: payout } } }),
      this.db.jobEvent.create({ data: { jobId: id, text: `Job completed · total ₹${finalAmount} (locked ₹${j.total}${finalAmount > j.total ? ` + approved extras ₹${finalAmount - j.total}` : ''})` } }),
    ]);
    await this.makeAvailable(u.sub);
    this.tellCustomer(j, 'Job done', `Total ₹${finalAmount}. Tap to review the bill and pay.`);
    return jobView(await this.broadcast(id), 'provider');
  }

  // ------------------------------------------------------------ payments
  async pay(u: AuthUser, id: string, method: string) {
    const j = await this.mustBeCustomer(u, id, ['COMPLETED']);
    if (!['upi', 'card', 'cash'].includes(method)) throw new BadRequestException('Choose UPI, card or cash');
    const amount = j.finalAmount!;
    if (method !== 'cash' && config.paymentGateway === 'razorpay') {
      // Create a Razorpay order; the app opens Checkout and then calls /payments/razorpay/verify.
      const res = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${config.razorpayKeyId}:${config.razorpayKeySecret}`).toString('base64') },
        body: JSON.stringify({ amount: amount * 100, currency: 'INR', receipt: id }),
      });
      if (!res.ok) throw new BadRequestException('Payment gateway error');
      const order: any = await res.json();
      await this.db.payment.upsert({ where: { jobId: id }, create: { jobId: id, method, amount, status: 'CREATED', ref: order.id, gatewayOrderId: order.id }, update: { method, gatewayOrderId: order.id, status: 'CREATED' } });
      return { checkout: { keyId: config.razorpayKeyId, orderId: order.id, amount: amount * 100, currency: 'INR' } };
    }
    if (method === 'cash') {
      // Cash isn't "paid" until the partner confirms they received it; otherwise anyone could tap "cash" and walk away.
      await this.db.payment.upsert({ where: { jobId: id }, create: { jobId: id, method, amount, status: 'PENDING_CASH', ref: 'CASH' }, update: { method, amount, status: 'PENDING_CASH', ref: 'CASH' } });
      await this.event(id, `Customer chose to pay ₹${amount} in cash · waiting for partner to confirm`);
      if (j.providerId) this.push.notify(j.providerId, { title: `Collect ₹${amount} in cash`, body: `Confirm in the app once ${j.customer.name} has paid you.`, data: { type: 'job', jobId: id }, channelId: 'jobs' });
      return jobView(await this.broadcast(id), 'customer');
    }
    return this.markPaid(id, method, amount, 'PAY' + randomBytes(4).toString('hex').toUpperCase());
  }

  /** Partner confirms the cash is in hand. Only then is the job PAID. */
  async cashReceived(u: AuthUser, id: string) {
    const j = await this.mustBeProvider(u, id, ['COMPLETED']);
    if (j.payment?.status !== 'PENDING_CASH') throw new ConflictException('The customer has not chosen cash');
    const v = await this.markPaid(id, 'cash', j.finalAmount!, 'CASH' + randomBytes(3).toString('hex').toUpperCase());
    this.tellCustomer(j, 'Cash payment confirmed', `${j.provider!.user.name} confirmed receiving ₹${j.finalAmount}. Thanks!`);
    return { ...v, startCode: undefined };
  }

  // ------------------------------------------------------------ tips (100% to the partner)
  async tip(u: AuthUser, id: string, amount: number) {
    const j = await this.mustBeCustomer(u, id, ['PAID']);
    if (j.tip > 0) throw new ConflictException('You already tipped for this job');
    const amt = Math.round(amount);
    if (!(amt >= 10 && amt <= 2000)) throw new BadRequestException('Tip between ₹10 and ₹2,000');
    // Production: charge via the gateway first (UPI collect); here the tip is recorded as paid.
    await this.db.$transaction([
      this.db.job.update({ where: { id }, data: { tip: amt } }),
      this.db.provider.update({ where: { userId: j.providerId! }, data: { earnings: { increment: amt } } }),
      this.db.jobEvent.create({ data: { jobId: id, text: `Customer tipped ₹${amt} · 100% to the partner` } }),
    ]);
    this.push.notify(j.providerId!, { title: `You got a ₹${amt} tip!`, body: `${j.customer.name} tipped you for the ${this.serviceName(j.service).toLowerCase()} job.`, data: { type: 'job', jobId: id }, channelId: 'jobs' });
    return jobView(await this.broadcast(id), 'customer');
  }

  // ------------------------------------------------------------ "Report a problem" → dispute for ops
  async dispute(u: AuthUser, id: string, reason: string, details = '') {
    const j = await this.mustBeCustomer(u, id, ['COMPLETED', 'PAID', 'CANCELLED']);
    if (!j.providerId) throw new BadRequestException('There is no partner on this request to report');
    if (j.dispute) throw new ConflictException('You already reported a problem for this job. Ops will get back to you.');
    await this.db.dispute.create({ data: { jobId: id, reason: reason as any, details: details.slice(0, 500) } });
    await this.event(id, `Problem reported by customer (${reason.toLowerCase().replace('_', ' ')}) · ops reviewing`);
    this.rt.toAdmins('dispute.created', { jobId: id });
    await this.push.notifyAdmins({ title: `Problem reported: ${reason.toLowerCase().replace('_', ' ')}`, body: `${j.customer.name} · ${this.serviceName(j.service)} job with ${j.provider?.user.name}`, data: { type: 'dispute', jobId: id } });
    return jobView(await this.broadcast(id), 'customer');
  }

  async resolveDispute(disputeId: string, resolution: string, refundAmount: number) {
    const d = await this.db.dispute.findUnique({ where: { id: disputeId }, include: { job: true } });
    if (!d) throw new NotFoundException('Dispute not found');
    if (d.status === 'RESOLVED') throw new ConflictException('Already resolved');
    const max = (d.job.finalAmount ?? 0) + d.job.cancelFee;
    const refund = Math.round(refundAmount);
    if (refund < 0 || refund > max) throw new BadRequestException(`Refund must be between ₹0 and ₹${max}`);
    // Production: issue the refund through the gateway (Razorpay refunds API) and record its id.
    await this.db.dispute.update({ where: { id: disputeId }, data: { status: 'RESOLVED', resolution: resolution.slice(0, 500), refundAmount: refund, resolvedAt: new Date() } });
    await this.event(d.jobId, `Ops resolved the reported problem${refund ? ` · ₹${refund} refunded` : ''}`);
    this.tellCustomer(d.job, refund ? `₹${refund} refund approved` : 'Your report was reviewed', resolution.slice(0, 140));
    return jobView(await this.broadcast(d.jobId), 'admin');
  }

  async verifyRazorpay(u: AuthUser, b: { jobId: string; razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) {
    const j = await this.mustBeCustomer(u, b.jobId, ['COMPLETED']);
    const expected = createHmac('sha256', config.razorpayKeySecret).update(`${b.razorpay_order_id}|${b.razorpay_payment_id}`).digest('hex');
    if (!j.payment || j.payment.gatewayOrderId !== b.razorpay_order_id || expected !== b.razorpay_signature) throw new BadRequestException('Payment could not be verified');
    return this.markPaid(j.id, j.payment.method, j.finalAmount!, b.razorpay_payment_id);
  }

  private async markPaid(id: string, method: string, amount: number, ref: string) {
    await this.db.$transaction([
      this.db.payment.upsert({ where: { jobId: id }, create: { jobId: id, method, amount, status: 'CAPTURED', ref }, update: { status: 'CAPTURED', ref, method } }),
      this.db.job.update({ where: { id }, data: { status: 'PAID', paidAt: new Date() } }),
      this.db.jobEvent.create({ data: { jobId: id, text: `Paid ₹${amount} via ${method.toUpperCase()}` } }),
    ]);
    return jobView(await this.broadcast(id), 'customer');
  }

  // ------------------------------------------------------------ ratings, chat, SOS, cancel
  async rate(u: AuthUser, id: string, stars: number, comment = '') {
    const j = await this.load(id);
    const by: Role = j.customerId === u.sub ? 'CUSTOMER' : j.providerId === u.sub ? 'PROVIDER' : (() => { throw new ForbiddenException('Not your job'); })();
    if (!['COMPLETED', 'PAID'].includes(j.status)) throw new ConflictException('You can rate after the job is complete');
    const s = Math.max(1, Math.min(5, Math.round(stars)));
    try { await this.db.rating.create({ data: { jobId: id, by, stars: s, comment: comment.slice(0, 300) } }); } catch { throw new ConflictException('Already rated'); }
    if (by === 'CUSTOMER' && j.providerId) {
      const p = j.provider!;
      await this.db.provider.update({ where: { userId: p.userId }, data: { rating: (p.rating * p.ratingCount + s) / (p.ratingCount + 1), ratingCount: { increment: 1 } } });
    }
    return jobView(await this.broadcast(id), by === 'CUSTOMER' ? 'customer' : 'provider');
  }

  async message(u: AuthUser, id: string, text: string) {
    const j = await this.load(id);
    const from: Role = j.customerId === u.sub ? 'CUSTOMER' : j.providerId === u.sub ? 'PROVIDER' : (() => { throw new ForbiddenException('Not your job'); })();
    if (!['ASSIGNED', 'ARRIVED', 'IN_PROGRESS'].includes(j.status)) throw new ConflictException('Chat is available while the job is active');
    if (!text?.trim()) throw new BadRequestException('Empty message');
    const m = await this.db.message.create({ data: { jobId: id, from, text: text.trim().slice(0, 500) } });
    const to = from === 'CUSTOMER' ? j.providerId! : j.customerId;
    const sender = from === 'CUSTOMER' ? j.customer.name : j.provider!.user.name;
    this.push.notify(to, { title: sender, body: m.text, data: { type: 'message', jobId: id }, channelId: 'jobs' });
    return jobView(await this.broadcast(id), from === 'CUSTOMER' ? 'customer' : 'provider');
  }

  async sos(u: AuthUser, id: string) {
    const j = await this.mustBeCustomer(u, id);
    const contacts = (j.customer.contacts as { name: string; phone: string }[]) || [];
    const link = `${config.publicUrl}/t/${id}`;
    for (const c of contacts) await this.sms.send(c.phone, `SOS from ${j.customer.name} via OnSpot. Live location: ${link}`);
    await this.event(id, `SOS raised · ops alerted${contacts.length ? ` · ${contacts.length} emergency contact(s) notified` : ''}`);
    this.rt.toAdmins(EVENTS.SOS, { jobId: id, customer: j.customer.name, phone: j.customer.phone, pickup: { lat: j.pickupLat, lng: j.pickupLng } });
    await this.push.notifyAdmins({ title: `SOS: ${j.customer.name}`, body: `${this.serviceName(j.service)} job · call +91 ${j.customer.phone} now`, data: { type: 'sos', jobId: id }, channelId: 'jobs' });
    await this.broadcast(id);
    return { ok: true, notified: contacts.length };
  }

  async cancel(u: AuthUser, id: string, reason = '') {
    const j = await this.load(id);
    if (j.customerId === u.sub) {
      if (!['SEARCHING', 'ASSIGNED', 'ARRIVED'].includes(j.status)) throw new ConflictException('This request can no longer be cancelled');
      const fee = j.status === 'ARRIVED' ? PRICING.cancelVisitFee : 0;
      const r = await this.db.job.updateMany({ where: { id, status: j.status }, data: { status: 'CANCELLED', cancelReason: reason.slice(0, 80) || null, cancelFee: fee } });
      if (!r.count) throw new ConflictException('Request changed, try again');
      if (j.providerId) { await this.db.provider.updateMany({ where: { userId: j.providerId, activeJobId: id }, data: { activeJobId: null } }); await this.makeAvailable(j.providerId); }
      else await this.revokeOffers(j.offeredIds, id);
      await this.event(id, `Cancelled by customer${reason ? ` (${reason})` : ''}${fee ? ` · ₹${fee} visit fee` : ' · no charge'}`);
      if (j.providerId) this.push.notify(j.providerId, { title: 'Job cancelled', body: `${j.customer.name} cancelled the ${this.serviceName(j.service).toLowerCase()} job.`, data: { type: 'job', jobId: id }, channelId: 'jobs' });
      return jobView(await this.broadcast(id), 'customer');
    }
    if (j.providerId === u.sub) {
      // Provider backs out: release and re-dispatch to others instead of failing the customer.
      if (!['ASSIGNED', 'ARRIVED'].includes(j.status)) throw new ConflictException('You cannot release the job now');
      await this.releaseToSearch(j, 'Provider released the job · finding you another provider');
      this.tellCustomer(j, 'Finding you another pro', `${j.provider!.user.name} couldn't make it. We're matching you with the next nearest pro.`);
      await this.broadcast(id);
      return { ok: true };
    }
    throw new ForbiddenException('Not your job');
  }

  /** Late-arrival guard: once flagged late, the customer may switch to another pro for free (same locked fare). */
  async switchPro(u: AuthUser, id: string) {
    const j = await this.mustBeCustomer(u, id, ['ASSIGNED']);
    if (!j.lateAt) throw new ConflictException('You can switch for free once your pro is running late');
    const old = j.provider!;
    await this.releaseToSearch(j, `Customer switched pros because ${old.user.name} was late · finding the next nearest pro`);
    this.push.notify(old.userId, { title: 'Job reassigned', body: `${j.customer.name} switched to another pro because you were running late.`, data: { type: 'job', jobId: id }, channelId: 'jobs' });
    return jobView(await this.broadcast(id), 'customer');
  }

  /** Put an assigned job back into search, excluding the current partner, and re-offer it to everyone else nearby. */
  private async releaseToSearch(j: FullJob, eventText: string) {
    const pid = j.providerId!;
    await this.db.$transaction([
      // offeredIds is reset so partners who saw the first offer get notified again (declines are kept).
      this.db.job.update({ where: { id: j.id }, data: { status: 'SEARCHING', providerId: null, assignedAt: null, arrivedAt: null, eta: null, promisedBy: null, lateAt: null, radiusKm: 0, searchStartedAt: new Date(), offeredIds: [], declinedIds: { push: pid } } }),
      this.db.provider.update({ where: { userId: pid }, data: { activeJobId: null } }),
      this.db.jobEvent.create({ data: { jobId: j.id, text: eventText } }),
    ]);
    this.offerAt.delete(j.id);
    this.rt.toUser(pid, EVENTS.JOB_OFFER_REVOKED, { jobId: j.id });
    await this.makeAvailable(pid);
    await this.tickJob(j.id);
  }

  // ------------------------------------------------------------ partner demand hotspots
  /** Where and when requests happened near the partner over the last 30 days, so they can wait in the right place. */
  async hotspots(providerId: string) {
    const p = await this.db.provider.findUniqueOrThrow({ where: { userId: providerId } });
    const center = p.lat != null ? { lat: p.lat, lng: p.lng! } : { lat: 18.7546, lng: 73.4062 };
    const d = 25 / 111; // ~25 km box, then exact distance filter
    const jobs = await this.db.job.findMany({
      where: { createdAt: { gt: new Date(Date.now() - 30 * 864e5) }, pickupLat: { gt: center.lat - d, lt: center.lat + d }, pickupLng: { gt: center.lng - d, lt: center.lng + d }, ...(p.services.length ? { service: { in: p.services } } : {}) },
      select: { pickupLat: true, pickupLng: true, pickupLabel: true, createdAt: true, service: true, total: true },
    });
    const cells = new Map<string, { lat: number; lng: number; count: number; labels: Map<string, number>; value: number }>();
    const hours = new Array(24).fill(0);
    for (const j of jobs) {
      if (roadKm(center, { lat: j.pickupLat, lng: j.pickupLng }) > 30) continue;
      hours[j.createdAt.getHours()]++;
      const key = `${Math.round(j.pickupLat / 0.02)}:${Math.round(j.pickupLng / 0.02)}`; // ~2 km cells
      const c = cells.get(key) ?? { lat: 0, lng: 0, count: 0, labels: new Map(), value: 0 };
      c.lat += j.pickupLat; c.lng += j.pickupLng; c.count++; c.value += j.total;
      if (j.pickupLabel) c.labels.set(j.pickupLabel, (c.labels.get(j.pickupLabel) ?? 0) + 1);
      cells.set(key, c);
    }
    const spots = [...cells.values()].sort((a, b) => b.count - a.count).slice(0, 5).map(c => {
      const lat = c.lat / c.count, lng = c.lng / c.count;
      const label = [...c.labels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
      return { lat, lng, label, requests: c.count, avgFare: Math.round(c.value / c.count), km: +roadKm(center, { lat, lng }).toFixed(1) };
    });
    const peak = hours.indexOf(Math.max(...hours));
    return { total: jobs.length, hotspots: spots, hours, peakHour: jobs.length ? peak : null };
  }

  // ------------------------------------------------------------ live location from the provider app
  async providerLocation(providerId: string, at: LatLng) {
    const p = await this.db.provider.update({ where: { userId: providerId }, data: { lat: at.lat, lng: at.lng } });
    if (!p.activeJobId) { await this.makeAvailable(providerId); return { ok: true }; }
    const j = await this.db.job.findUnique({ where: { id: p.activeJobId } });
    if (j?.status === 'ASSIGNED') {
      const eta = etaMinutes(roadKm(at, { lat: j.pickupLat, lng: j.pickupLng }));
      if (eta !== j.eta) await this.db.job.update({ where: { id: j.id }, data: { eta } });
      const payload = { jobId: j.id, providerId, lat: at.lat, lng: at.lng, eta };
      this.rt.toUser(j.customerId, EVENTS.PROVIDER_LOCATION, payload);
      this.rt.toAdmins(EVENTS.PROVIDER_LOCATION, payload);
    }
    return { ok: true };
  }
  serviceName(code: string) { return SERVICE_BY_CODE[code as ServiceCode]?.name ?? code; }
}
