// Dev seed: one ops admin and a handful of verified, online providers around Lonavala (Mumbai–Pune Expressway).
// Sign in as admin with phone 9999999999 (role ADMIN) using the dev OTP flow.
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const CENTER = { lat: 18.7546, lng: 73.4062 };
const PROVIDERS = [
  { name: 'Sanjay Patil', phone: '9800000001', services: ['tow'], vehicleNo: 'MH 14 TX 4821', dLat: 0.02, dLng: 0.01 },
  { name: 'Imran Shaikh', phone: '9800000002', services: ['puncture', 'battery', 'fuel'], vehicleNo: 'MH 12 CK 1180', dLat: -0.012, dLng: 0.018 },
  { name: 'Ravi Jadhav', phone: '9800000003', services: ['mechanic', 'battery', 'puncture'], vehicleNo: 'MH 14 AB 7731', dLat: 0.008, dLng: -0.022 },
  { name: 'Prakash More', phone: '9800000004', services: ['tow', 'mechanic'], vehicleNo: 'MH 12 PL 3390', dLat: -0.03, dLng: -0.01 },
  { name: 'Amit Kulkarni', phone: '9800000005', services: ['plumber', 'electrician'], vehicleNo: 'MH 14 EE 2020', dLat: 0.015, dLng: 0.03 },
  { name: 'Salim Khan', phone: '9800000006', services: ['locksmith', 'electrician'], vehicleNo: 'MH 12 LK 5501', dLat: -0.005, dLng: -0.035 },
];

async function main() {
  await db.user.upsert({ where: { phone_role: { phone: '9999999999', role: 'ADMIN' } }, update: {}, create: { phone: '9999999999', role: 'ADMIN', name: 'OnSpot Ops' } });
  for (const p of PROVIDERS) {
    await db.user.upsert({
      where: { phone_role: { phone: p.phone, role: 'PROVIDER' } },
      update: {},
      create: {
        phone: p.phone, role: 'PROVIDER', name: p.name,
        provider: { create: { services: p.services, vehicleNo: p.vehicleNo, online: true, lat: CENTER.lat + p.dLat, lng: CENTER.lng + p.dLng, kycStatus: 'VERIFIED', rating: 4.6 + Math.random() * 0.4, ratingCount: 40 + Math.floor(Math.random() * 200) } },
      },
    });
  }
  console.log(`Seeded admin + ${PROVIDERS.length} providers`);
}
main().finally(() => db.$disconnect());
