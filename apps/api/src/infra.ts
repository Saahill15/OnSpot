// Infrastructure services: config, Prisma, geo index (Redis or in-memory), SMS, realtime emitter.
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { haversineKm, PRICING, ServiceCode, SERVICES } from '@onspot/shared';
import type { Server } from 'socket.io';

export const config = {
  port: +(process.env.PORT || 4100),
  jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me',
  redisUrl: process.env.REDIS_URL || '',
  otpDevEcho: process.env.OTP_DEV_ECHO !== 'false', // dev: return the OTP in the API response
  paymentGateway: (process.env.PAYMENT_GATEWAY || 'mock') as 'mock' | 'razorpay',
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || '',
  pushDriver: (process.env.PUSH_DRIVER || 'expo') as 'expo' | 'log' | 'memory',
  placesDriver: (process.env.PLACES_DRIVER || 'osm') as 'osm' | 'off',
  expoAccessToken: process.env.EXPO_ACCESS_TOKEN || '', // only if "enhanced push security" is on in Expo
  dispatchTickMs: +(process.env.DISPATCH_TICK_MS || 1000),
  offerTtlSec: 20,
  lateGraceMin: +(process.env.LATE_GRACE_MIN ?? 10), // minutes past the promised arrival before the customer can switch for free
  topRatedMin: 4.5,
  otpPerIpPer15Min: +(process.env.OTP_PER_IP ?? 20),
  searchTimeoutSec: 180,
  radiusSteps: [[0, 8], [15, 15], [30, 30], [45, 50]] as [number, number][], // [elapsed s, km]
};

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}

// ---------------------------------------------------------------- geo index
export interface NearbyHit { id: string; km: number; }
export interface GeoIndex {
  upsert(id: string, lat: number, lng: number, services: ServiceCode[]): Promise<void>;
  remove(id: string): Promise<void>;
  nearby(service: ServiceCode, lat: number, lng: number, radiusKm: number): Promise<NearbyHit[]>;
  kind: string;
}

class MemoryGeoIndex implements GeoIndex {
  kind = 'memory';
  private items = new Map<string, { lat: number; lng: number; services: ServiceCode[] }>();
  async upsert(id: string, lat: number, lng: number, services: ServiceCode[]) { this.items.set(id, { lat, lng, services }); }
  async remove(id: string) { this.items.delete(id); }
  async nearby(service: ServiceCode, lat: number, lng: number, radiusKm: number) {
    const out: NearbyHit[] = [];
    for (const [id, p] of this.items) {
      if (!p.services.includes(service)) continue;
      const km = haversineKm({ lat, lng }, p) * PRICING.roadFactor;
      if (km <= radiusKm) out.push({ id, km });
    }
    return out.sort((a, b) => a.km - b.km);
  }
}

/** Redis GEO: one sorted set per service of *available* providers (online, verified, not on a job). */
class RedisGeoIndex implements GeoIndex {
  kind = 'redis';
  constructor(private r: Redis) {}
  private key = (s: string) => `geo:avail:${s}`;
  async upsert(id: string, lat: number, lng: number, services: ServiceCode[]) {
    const m = this.r.multi();
    for (const s of SERVICES) m.zrem(this.key(s.code), id);
    for (const s of services) m.geoadd(this.key(s), lng, lat, id);
    await m.exec();
  }
  async remove(id: string) {
    const m = this.r.multi();
    for (const s of SERVICES) m.zrem(this.key(s.code), id);
    await m.exec();
  }
  async nearby(service: ServiceCode, lat: number, lng: number, radiusKm: number) {
    // Search the straight-line radius, then convert to road km with the same factor the pricing uses.
    const res = (await this.r.geosearch(this.key(service), 'FROMLONLAT', lng, lat, 'BYRADIUS', radiusKm / PRICING.roadFactor, 'km', 'ASC', 'WITHDIST')) as [string, string][];
    return res.map(([id, d]) => ({ id, km: +d * PRICING.roadFactor }));
  }
}

@Injectable()
export class GeoService implements OnModuleDestroy {
  private log = new Logger('Geo');
  index: GeoIndex;
  private redis?: Redis;
  constructor() {
    if (config.redisUrl) {
      this.redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2 });
      this.index = new RedisGeoIndex(this.redis);
    } else this.index = new MemoryGeoIndex();
    this.log.log(`Using ${this.index.kind} geo index`);
  }
  async onModuleDestroy() { await this.redis?.quit(); }
}

// ---------------------------------------------------------------- SMS (MSG91/Twilio adapter goes here)
@Injectable()
export class SmsService {
  private log = new Logger('SMS');
  async send(phone: string, text: string) { this.log.log(`→ ${phone.slice(0, 2)}XXXXXX${phone.slice(-2)}: ${text}`); }
}

// ---------------------------------------------------------------- push notifications (Expo Push → FCM / APNs)
export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  channelId?: 'offers' | 'jobs' | 'default'; // Android notification channels (created by the app)
  ttl?: number; // seconds; offers expire, so don't deliver them late
}
export interface SentPush extends PushMessage { userId: string }

@Injectable()
export class PushService {
  private log = new Logger('Push');
  /** Messages captured by the `memory` driver (tests). */
  readonly sent: SentPush[] = [];
  constructor(private db: PrismaService) {}

  /** Fire-and-forget: never let a push failure break the request that triggered it. */
  notify(userIds: string | string[], msg: PushMessage) {
    const ids = [...new Set(Array.isArray(userIds) ? userIds : [userIds])];
    if (config.pushDriver === 'memory') { for (const userId of ids) this.sent.push({ userId, ...msg }); return; }
    this.send(ids, msg).catch(e => this.log.warn(`push failed: ${e.message}`));
  }
  async notifyAdmins(msg: PushMessage) {
    const admins = await this.db.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
    this.notify(admins.map(a => a.id), msg);
  }

  private async send(userIds: string[], msg: PushMessage) {
    const tokens = await this.db.pushToken.findMany({ where: { userId: { in: userIds } } });
    if (!tokens.length) return;
    if (config.pushDriver === 'log') { this.log.log(`[${tokens.length} device(s)] ${msg.title}: ${msg.body}`); return; }
    const messages = tokens.map(t => ({
      to: t.token, title: msg.title, body: msg.body, data: msg.data ?? {}, sound: 'default', priority: 'high',
      channelId: msg.channelId ?? 'default', ...(msg.ttl ? { ttl: msg.ttl } : {}),
    }));
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(config.expoAccessToken ? { Authorization: `Bearer ${config.expoAccessToken}` } : {}) },
        body: JSON.stringify(batch),
      });
      const out: any = await res.json().catch(() => ({}));
      // Tickets come back in the same order; drop tokens for uninstalled apps.
      const dead = (out.data || []).map((t: any, j: number) => (t.status === 'error' && t.details?.error === 'DeviceNotRegistered' ? batch[j].to : null)).filter(Boolean);
      if (dead.length) await this.db.pushToken.deleteMany({ where: { token: { in: dead } } });
    }
  }
}

// ---------------------------------------------------------------- nearby garages (OpenStreetMap via Overpass)
export interface Garage { name: string; lat: number; lng: number; km: number; phone?: string }

@Injectable()
export class PlacesService {
  private log = new Logger('Places');
  private cache = new Map<string, { at: number; data: Garage[] }>();
  /** Real car-repair shops near a point. Cached 30 min per ~1 km cell. Returns [] if OSM is unreachable,
   *  and the app falls back to "choose on map". */
  async garages(lat: number, lng: number): Promise<Garage[]> {
    const key = `${lat.toFixed(2)}:${lng.toFixed(2)}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 30 * 60_000) return hit.data;
    if (config.placesDriver === 'off') return [];
    const q = `[out:json][timeout:8];(node["shop"="car_repair"](around:20000,${lat},${lng});way["shop"="car_repair"](around:20000,${lat},${lng}););out center 60;`;
    try {
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'OnSpot/0.1 (roadside assistance app)' },
        body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`overpass ${res.status}`);
      const out: any = await res.json();
      const data: Garage[] = (out.elements || [])
        .map((e: any) => ({ lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon, name: e.tags?.name, phone: e.tags?.phone || e.tags?.['contact:phone'] }))
        .filter((g: any) => g.lat != null && g.name)
        .map((g: any) => ({ ...g, km: +(haversineKm({ lat, lng }, g) * PRICING.roadFactor).toFixed(1) }))
        .sort((a: Garage, b: Garage) => a.km - b.km)
        .slice(0, 6);
      this.cache.set(key, { at: Date.now(), data });
      return data;
    } catch (e: any) {
      this.log.warn(`garage lookup failed: ${e.message}`);
      return [];
    }
  }
}

// ---------------------------------------------------------------- realtime emitter (gateway attaches the server)
@Injectable()
export class RealtimeService {
  server?: Server;
  toUser(userId: string, event: string, data: unknown) { this.server?.to(`user:${userId}`).emit(event, data); }
  toAdmins(event: string, data: unknown) { this.server?.to('admins').emit(event, data); }
}
