# OnSpot — Build Roadmap (best-order flow)

**Recommendation:** don't start with a big native app. Start with a **clickable working prototype + landing page + provider sign-up**, validate supply in one corridor, *then* build the native apps. Supply is the hard part of this business, not code.

| Phase | Duration | What you build | Exit criteria |
|---|---|---|---|
| **0. Prototype & validate** *(you are here)* | 1–2 wks | This repo: working web prototype (customer/provider/admin), PRD, architecture. Landing page + Google Form/Typeform for provider waitlist. Show to 30 drivers + 30 providers. | 50+ providers say "yes, I'll list"; 10 tow operators on the corridor committed |
| **1. MVP (one corridor)** | 8–10 wks | Expo customer app + provider app, NestJS API, Postgres/PostGIS, Redis GEO, Socket.IO, phone-OTP login, 5 roadside services, Fair Price Lock, OTP start, add-on approval, Razorpay UPI + cash, ratings, basic admin (KYC queue, live jobs). | 80% match rate, < 45 s median match, 4.5★ |
| **2. Trust & scale** | 6 wks | SOS + trip share, masked calls, in-app chat, SMS fallback, provider payouts (Razorpay Route), cancellation rules, Hindi/Marathi, WhatsApp booking bot. | 3 cities/corridors, 500 providers |
| **3. Home emergency** | 6 wks | Plumber, electrician, locksmith; scheduled bookings; photo-based quotes. | Home services ≥ 20% of jobs |
| **4. Revenue levers** | ongoing | Shield subscription, insurer/OEM RSA API, fleet accounts, dynamic (capped) pricing, AI triage, demand heat-maps for providers. | Contribution-margin positive per job |

## Phase 1 repo structure (monorepo, Turborepo + pnpm)

```
onspot/
├── apps/
│   ├── customer/        # Expo (React Native)
│   ├── provider/        # Expo (React Native)
│   ├── admin/           # Next.js
│   └── api/             # NestJS
│       └── src/modules/ auth, users, providers, services, pricing,
│                        dispatch, jobs, realtime, payments, ratings, notifications, admin
├── packages/
│   ├── ui/              # shared RN components + design tokens
│   ├── types/           # shared TS types (Job, Quote, Addon…) — generated from OpenAPI
│   └── config/          # eslint, tsconfig
├── infra/               # docker-compose (postgres+postgis, redis), terraform later
└── docs/                # PRD, architecture, ADRs
```

## Phase 1 sprint plan (2-week sprints)

1. **S1 – Foundations:** monorepo, CI, docker-compose, auth (phone OTP), users/providers schema, design system.
2. **S2 – Catalog & pricing:** services, rate cards, quote API, customer home + service picker + quote screen.
3. **S3 – Dispatch & realtime:** Redis GEO, go-online, offer waves, accept lock, Socket.IO, provider job card.
4. **S4 – Job lifecycle:** tracking map, ETA, arrive, OTP start, add-ons, complete, ratings.
5. **S5 – Payments & admin:** Razorpay UPI/cards, cash flow, receipts, admin KYC + live jobs.
6. **Hardening:** background location, poor-network testing, load test dispatch, Play Store beta to 50 providers.

## Immediate next steps (this week)
1. Run the prototype (`cd app && node server.js`) and demo it to 5 drivers + 5 providers.
2. Fix the name + domain + Play Store listing name.
3. Map 100 providers on your launch corridor (spreadsheet: name, phone, service, location, hours, has smartphone?).
4. Decide launch commission (recommend 0% for 3 months).
5. Start Phase 1 S1.
