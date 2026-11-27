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
  placesDriver: (process.env.PLACES_DRIVER || 'on') as 'on' | 'off',
  googlePlacesKey: process.env.GOOGLE_PLACES_API_KEY || '', // Google Places API (New); empty = OpenStreetMap only
  expoAccessToken: process.env.EXPO_ACCESS_TOKEN || '', // only if "enhanced push security" is on in Expo
  dispatchTickMs: +(process.env.DISPATCH_TICK_MS || 1000),
  publicUrl: (process.env.PUBLIC_WEB_URL || `http://localhost:${process.env.PORT || 4100}`).replace(/\/$/, ''), // base for share links (/t/:id)
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

/// ---------------------------------------------------------------- nearby garages (Google Places → OpenStreetMap fallback)
export interface Garage { name: string; lat: number; lng: number; km: number; phone?: string; openNow?: boolean | null; rating?: number | null; source: 'google' | 'osm' }

@Injectable()
export class PlacesService {
  private log = new Logger('Places');
  private cache = new Map<string, { at: number; data: Garage[] }>();
  private osmDownUntil = 0; // after an OSM failure, skip it for a while so customers aren't kept waiting

  /** Real car-repair shops near a point, nearest first (max 6). Cached 15 min per ~1 km cell.
   *  Google Places when GOOGLE_PLACES_API_KEY is set (best coverage in India, includes "open now");
   *  otherwise, or if Google fails, OpenStreetMap via Overpass. Returns [] when nothing is available,
   *  and the app falls back to "choose on map". */
  async garages(lat: number, lng: number): Promise<Garage[]> {
    if (config.placesDriver === 'off') return [];
    const key = `${lat.toFixed(2)}:${lng.toFixed(2)}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 15 * 60_000) return hit.data; // short: "open now" changes during the night
    let data: Garage[] | null = null;
    if (config.googlePlacesKey) data = await this.fromGoogle(lat, lng).catch(e => { this.log.warn(`Google Places failed: ${e.message}`); return null; });
    if (!data && Date.now() >= this.osmDownUntil) {
      data = await this.fromOsm(lat, lng).catch(e => { this.log.warn(`OSM lookup failed: ${e.message}; skipping OSM for 2 min`); this.osmDownUntil = Date.now() + 2 * 60_000; return null; });
    }
    if (!data) return [];
    data = data.map(g => ({ ...g, km: +(haversineKm({ lat, lng }, g) * PRICING.roadFactor).toFixed(1) }))
      // Open garages first (when known), then nearest.
      .sort((a, b) => Number(b.openNow === true) - Number(a.openNow === true) || a.km - b.km)
      .slice(0, 6);
    this.cache.set(key, { at: Date.now(), data });
    return data;
  }

  /** Google Places API (New): Nearby Search, type car_repair, 20 km, ranked by distance. */
  private async fromGoogle(lat: number, lng: number): Promise<Garage[]> {
    const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': config.googlePlacesKey,
        // Only the fields we use (also keeps the per-call price in the cheaper tier).
        'X-Goog-FieldMask': 'places.displayName,places.location,places.nationalPhoneNumber,places.currentOpeningHours.openNow,places.rating,places.businessStatus',
      },
      body: JSON.stringify({
        includedTypes: ['car_repair'], maxResultCount: 15, rankPreference: 'DISTANCE',
        locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: 20000 } },
      }),
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
    const out: any = await res.json();
    return (out.places || [])
      .filter((p: any) => p.location && p.displayName?.text && (p.businessStatus ?? 'OPERATIONAL') === 'OPERATIONAL')
      .map((p: any) => ({
        name: p.displayName.text, lat: p.location.latitude, lng: p.location.longitude, km: 0,
        phone: p.nationalPhoneNumber || undefined, openNow: p.currentOpeningHours?.openNow ?? null, rating: p.rating ?? null, source: 'google' as const,
      }));
  }

  /** OpenStreetMap via Overpass (free, no key). Coverage in India is patchy and public servers are often overloaded. */
  private async fromOsm(lat: number, lng: number): Promise<Garage[]> {
    const q = `[out:json][timeout:8];(node["shop"="car_repair"](around:20000,${lat},${lng});way["shop"="car_repair"](around:20000,${lat},${lng}););out center 60;`;
    let out: any = null, lastErr = '';
    for (const url of ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': 'OnSpot/0.1 (roadside assistance app)' },
          body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(6_000),
        });
        if (!res.ok) { lastErr = `${new URL(url).host} ${res.status}`; continue; }
        out = await res.json();
        break;
      } catch (e: any) { lastErr = `${new URL(url).host} ${e.message}`; }
    }
    if (!out) throw new Error(lastErr);
    return (out.elements || [])
      .map((e: any) => ({ lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon, name: e.tags?.name, phone: e.tags?.phone || e.tags?.['contact:phone'] }))
      .filter((g: any) => g.lat != null && g.name)
      .map((g: any) => ({ ...g, km: 0, openNow: null, rating: null, source: 'osm' as const }));
  }
}

// ---------------------------------------------------------------- realtime emitter (gateway attaches the server)
@Injectable()
export class RealtimeService {
  server?: Server;
  toUser(userId: string, event: string, data: unknown) { this.server?.to(`user:${userId}`).emit(event, data); }
  toAdmins(event: string, data: unknown) { this.server?.to('admins').emit(event, data); }
}
