// @onspot/shared — the single source of truth for the catalog, pricing and job contract.
// Used by the API (authoritative) and the mobile app (display only; the server re-quotes).

export type ServiceCode = 'tow' | 'puncture' | 'fuel' | 'battery' | 'mechanic' | 'plumber' | 'electrician' | 'locksmith';
export type Role = 'CUSTOMER' | 'PROVIDER' | 'ADMIN';
export type JobStatus = 'SEARCHING' | 'ASSIGNED' | 'ARRIVED' | 'IN_PROGRESS' | 'COMPLETED' | 'PAID' | 'CANCELLED' | 'NO_PROVIDER';
export type KycStatus = 'PENDING' | 'SUBMITTED' | 'VERIFIED' | 'REJECTED';
export type AddonStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type PayMethod = 'upi' | 'card' | 'cash';

export const ACTIVE_STATUSES: JobStatus[] = ['SEARCHING', 'ASSIGNED', 'ARRIVED', 'IN_PROGRESS'];

export interface LatLng { lat: number; lng: number; }
export interface Place extends LatLng { label?: string; }

export interface ServiceDef {
  code: ServiceCode;
  name: string;
  group: 'Roadside' | 'Home';
  desc: string;
  base: number;        // ₹
  perKm: number;       // ₹ per approach km beyond includedKm
  includedKm: number;
  towPerKm?: number;   // towing only: ₹ per km pickup → drop
  fuelLitres?: number; // fuel delivery only
  fuelPrice?: number;  // ₹ / litre (pump price; per-city in production)
}

export const SERVICES: ServiceDef[] = [
  { code: 'tow', name: 'Towing', group: 'Roadside', desc: 'Flatbed or wheel-lift to a garage', base: 799, perKm: 25, includedKm: 5, towPerKm: 35 },
  { code: 'puncture', name: 'Flat tyre', group: 'Roadside', desc: 'Puncture repair or spare change', base: 199, perKm: 12, includedKm: 3 },
  { code: 'fuel', name: 'Fuel delivery', group: 'Roadside', desc: '5 L petrol or diesel at pump price', base: 149, perKm: 12, includedKm: 3, fuelLitres: 5, fuelPrice: 105 },
  { code: 'battery', name: 'Battery jump', group: 'Roadside', desc: 'Jump-start or battery check', base: 299, perKm: 12, includedKm: 3 },
  { code: 'mechanic', name: 'Mechanic', group: 'Roadside', desc: 'On-spot diagnosis and minor repair', base: 349, perKm: 15, includedKm: 3 },
  { code: 'plumber', name: 'Plumber', group: 'Home', desc: 'Leaks, bursts, blockages', base: 249, perKm: 10, includedKm: 3 },
  { code: 'electrician', name: 'Electrician', group: 'Home', desc: 'Power trips, wiring, MCB', base: 249, perKm: 10, includedKm: 3 },
  { code: 'locksmith', name: 'Locksmith', group: 'Home', desc: 'Locked out of home or car', base: 399, perKm: 12, includedKm: 3 },
];
export const SERVICE_BY_CODE = Object.fromEntries(SERVICES.map(s => [s.code, s])) as Record<ServiceCode, ServiceDef>;
export const isServiceCode = (x: unknown): x is ServiceCode => typeof x === 'string' && x in SERVICE_BY_CODE;

export const PRICING = {
  platformFee: 19,
  commission: 0.10,
  nightPct: 0.20,
  nightCap: 150,
  nightStartHour: 22,
  nightEndHour: 6,
  roadFactor: 1.35,   // straight line → road distance (replace with Distance Matrix in prod)
  avgKmph: 32,
  cancelVisitFee: 99,
};

// ---------------------------------------------------------------- geo
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371, r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export const roadKm = (a: LatLng, b: LatLng) => haversineKm(a, b) * PRICING.roadFactor;
export const etaMinutes = (km: number) => Math.max(2, Math.round((km / PRICING.avgKmph) * 60));
export function isNightHour(hour: number) { return hour >= PRICING.nightStartHour || hour < PRICING.nightEndHour; }

// ---------------------------------------------------------------- pricing (Fair Price Lock)
export interface QuoteLine { label: string; amount: number; kind: 'base' | 'travel' | 'tow' | 'fuel' | 'night' | 'platform'; }
export interface Quote {
  service: ServiceCode;
  lines: QuoteLine[];
  total: number;
  platformFee: number;
  night: boolean;
  shield: boolean;
  approachKm: number;
  towKm: number;
  etaMin: number;
}
export interface QuoteInput {
  service: ServiceCode;
  pickup: LatLng;
  drop?: LatLng | null;
  approachKm: number;   // road km from nearest available provider
  night: boolean;
  shield: boolean;      // Shield members pay no platform fee
}

export function computeQuote(i: QuoteInput): Quote {
  const s = SERVICE_BY_CODE[i.service];
  const lines: QuoteLine[] = [{ label: 'Base charge', amount: s.base, kind: 'base' }];
  // Whole km only: "extra 0.1 km · ₹2" is noise, and riders/drivers think in whole km.
  const extraKm = Math.max(0, Math.round(i.approachKm - s.includedKm));
  if (extraKm > 0) lines.push({ label: `Travel: extra ${extraKm} km (first ${s.includedKm} km free)`, amount: extraKm * s.perKm, kind: 'travel' });
  let towKm = 0;
  if (s.towPerKm && i.drop) {
    towKm = roadKm(i.pickup, i.drop);
    lines.push({ label: `Tow distance (${towKm.toFixed(1)} km × ₹${s.towPerKm})`, amount: Math.round(towKm * s.towPerKm), kind: 'tow' });
  }
  if (s.fuelLitres && s.fuelPrice) lines.push({ label: `Fuel ${s.fuelLitres} L at ₹${s.fuelPrice} (pump price)`, amount: s.fuelLitres * s.fuelPrice, kind: 'fuel' });
  const subtotal = lines.reduce((t, l) => t + l.amount, 0);
  if (i.night) lines.push({ label: `Night surcharge (20%, capped at ₹${PRICING.nightCap})`, amount: Math.min(Math.round(subtotal * PRICING.nightPct), PRICING.nightCap), kind: 'night' });
  const platformFee = i.shield ? 0 : PRICING.platformFee;
  lines.push({ label: i.shield ? 'Platform fee (waived, Shield member)' : 'Platform fee', amount: platformFee, kind: 'platform' });
  const total = lines.reduce((t, l) => t + l.amount, 0);
  return { service: i.service, lines, total, platformFee, night: i.night, shield: i.shield, approachKm: +i.approachKm.toFixed(1), towKm: +towKm.toFixed(1), etaMin: etaMinutes(i.approachKm) };
}

/** Provider payout = (customer total − platform fee) × (1 − commission). */
export const providerPayout = (customerTotal: number, platformFee: number) => Math.round((customerTotal - platformFee) * (1 - PRICING.commission));

// ---------------------------------------------------------------- realtime contract (Socket.IO)
export const EVENTS = {
  JOB_UPDATED: 'job.updated',          // → customer, provider, admin: full JobView
  JOB_OFFER: 'job.offer',              // → provider: JobOffer
  JOB_OFFER_REVOKED: 'job.offer_revoked', // → provider: { jobId }
  PROVIDER_LOCATION: 'provider.location', // → customer + admin: { jobId?, providerId, lat, lng, eta? }
  KYC_UPDATED: 'kyc.updated',          // → provider: { status }
  SOS: 'sos',                          // → admin
} as const;

export interface JobOffer {
  jobId: string;
  service: ServiceCode;
  km: number;
  fare: number;
  payout: number;
  pickup: Place;
  customerName: string;
  expiresAt: string; // ISO
}

export const CANCEL_REASONS = ['Fixed it myself', 'Found help elsewhere', 'Taking too long', 'Wrong location or service', 'Price concern', 'Other'];
