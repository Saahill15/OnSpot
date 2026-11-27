# OnSpot: help, on the spot

On-demand marketplace for urgent roadside and home help (towing, flat tyre, fuel, battery, mechanic, plumber, electrician, locksmith). Independent, verified providers list themselves and go online; customers get the nearest one at a **locked, fair price**.

```
OnSpot/
├── apps/
│   ├── api          NestJS + Prisma (Postgres) + Redis GEO + Socket.IO
│   ├── mobile       Expo SDK 58 app (customer + partner, chosen at sign-in)
│   └── admin        Ops console (Vite + React + Leaflet)
├── packages/
│   └── shared       Service catalog, pricing engine (Fair Price Lock), job/realtime contract
├── infra/           docker-compose for Redis (and optional PostGIS)
├── docs/            PRD, system architecture, build roadmap
└── prototype/       Original zero-dependency clickable prototype (kept for demos)
```

Docs: [PRD](docs/PRD.md) · [Architecture](docs/ARCHITECTURE.md) · [Roadmap](docs/ROADMAP.md) · [Status / what's left](docs/STATUS.md) · [Prototype](prototype/README.md)

## Run it locally

Prereqs: Node 20+, Docker Desktop (for Redis), PostgreSQL binaries (or the optional Docker Postgres).

```bash
npm install
npm run build:shared
docker compose -f infra/docker-compose.yml up -d redis   # Redis on :6379
npm run db:start                                          # project-local Postgres on :54329 (data in .pgdata/)
```

First run only: create the cluster and database (`initdb -D .pgdata -U onspot --auth=trust`, start it, then `createdb -h localhost -p 54329 -U onspot onspot`), and copy `apps/api/.env.example` to `apps/api/.env`. Then:

```bash
cd apps/api
npx prisma migrate dev     # creates tables
npm run seed               # ops admin (9999999999) + 6 verified providers near Lonavala
npm run dev                # API on http://localhost:4100/v1
```

```bash
cd apps/mobile
npm run web                # browser preview
npx expo start             # phone: needs a development build (react-native-maps), see below
```

```bash
cd apps/admin
npm run dev                # ops console on http://localhost:5173 (sign in with 9999999999)
```

### See everything side by side

With the API and ops console running, start the mobile web app twice (one per role, each keeps its own sign-in):

```bash
cd apps/mobile
npm run web -- --port 8081   # customer
npm run web -- --port 8082   # partner (second terminal)
```

Then open **http://localhost:5173/side-by-side.html**: customer app, partner app and ops console in one window, all live. The phones render at a real device size (390×844) and are scaled to fit your window.

### What's in the apps

- **Fair Price Lock**: itemised fare before booking; extras need the customer's in-app approval, and declined extras are never charged.
- **Cash that can't be faked**: choosing cash leaves the job unpaid until the partner confirms they received it (the prompt survives an app restart).
- **Late-arrival guard**: if a partner is 10+ minutes past the arrival time they accepted with, the customer can switch to the next nearest pro for free; the partner and ops are told.
- **Highway safety card** while waiting (hazard lights, behind the barrier, verify the plate before sharing the code) with a **"no internet? send my location by SMS"** fallback.
- **Top-rated pros only**: optional booking setting, dispatches only to verified pros rated 4.5★+.
- **Real tow destinations**: nearby garages from Google Places (open-now first, with phone and rating; set `GOOGLE_PLACES_API_KEY`), falling back to OpenStreetMap, or pin a drop point on the map.
- **Tips** (100% to the partner) and **Report a problem** → ops **Disputes** queue with refunds capped at what was paid.
- **Partner demand hotspots**: where and when requests happen near them (last 30 days), with directions.
- Offers expire on the server's clock (no fresh 20 s timer on app reopen); apps and console resync after a network drop.

Ops console: live KPIs, a live map of partners and open requests (updated over Socket.IO), active requests, jobs with a full-detail drawer (bill, extras, chat, ratings, timeline), the KYC queue (approve/reject), partner suspension with a reason sent to the partner, and a red SOS banner with the customer's number the moment an SOS is raised.

### Push notifications

The API sends pushes through Expo's push service, which relays to FCM (Android) and APNs (iOS). Partners get new offers (expiring with the 20 s offer window, on a high-priority "Job offers" channel), cancellations, KYC decisions and suspensions. Customers get "on the way", "arrived", "approve an extra", "job done", "finding another pro", "no provider" and new chat messages. Ops admins get SOS alerts. Dead tokens are removed automatically.

To receive pushes on a phone (once): `npx eas-cli@latest init` in `apps/mobile` (adds the EAS projectId), upload FCM credentials for Android with `npx eas-cli@latest credentials`, then make a development build. Push doesn't work in Expo Go on Android or on web. `PUSH_DRIVER=log` prints instead of sending.

Phone testing: set `EXPO_PUBLIC_API_URL=http://<your-PC-LAN-IP>:4100/v1` (Android emulator: `http://10.0.2.2:4100/v1`) and build a dev client with `npx expo run:android` or `npx eas-cli@latest build --profile development`.

Sign-in uses phone OTP. In development (`OTP_DEV_ECHO=true`) the code is returned by the API and shown in the app instead of being sent by SMS.

## Tests

```bash
cd apps/api && npm run test:e2e
```

End-to-end tests run against a real Nest app, Postgres (`onspot_test`), Redis (db 1) and Socket.IO clients. They cover OTP auth and role guards; the KYC gate; locked quotes; real-time dispatch with exactly one winner when two providers accept at once; the start code being hidden from providers; chat; a public tracking link that leaks nothing private; extras needing approval (declined extras are never charged); payment; ratings; provider release with re-dispatch; the visit fee after arrival; SOS to emergency contacts; Shield waiving the platform fee; push notifications for every key moment; ops job detail, live map and partner suspension; and ops metrics.

## API overview (`/v1`)

| Area | Endpoints |
|---|---|
| Auth | `POST auth/otp/request`, `POST auth/otp/verify` → JWT |
| Public | `GET catalog`, `GET track/:id` (family link), `GET health` |
| Me | `GET/PATCH me` (emergency contacts, vehicle, Shield), `POST me/push-tokens`, `POST me/push-tokens/remove` |
| Jobs (customer) | `GET jobs/availability`, `POST jobs/quote`, `POST jobs`, `POST jobs/:id/{addons/:aid/decision, pay, tip, rate, dispute, switch, messages, sos, cancel}` |
| Jobs (partner) | `POST jobs/:id/{accept, decline, arrived, start, addons, complete, cash-received, messages, cancel}` |
| Partner | `GET/PATCH provider/me`, `GET provider/hotspots`, `POST provider/{kyc, status, location}` |
| Places | `GET places/garages?lat&lng` (Google Places → OpenStreetMap; empty list when unavailable) |
| Payments | `POST payments/razorpay/verify` |
| Ops | `GET admin/{overview, live, providers, jobs, jobs/:id, disputes}`, `POST admin/providers/:id/{kyc, suspend}`, `POST admin/disputes/:id/resolve` |

Realtime (Socket.IO, `auth: { token }`): `job.updated`, `job.offer`, `job.offer_revoked`, `provider.location`, `kyc.updated`, `sos`.

## Design decisions

- **Fair Price Lock is enforced server-side.** The quote is computed by `@onspot/shared`, stored immutably on the job, and the final amount is always locked total plus approved extras.
- **One active job per provider** is a unique database constraint, and accepting is a conditional update in a transaction, so concurrent accepts can't double-book.
- **Redis GEO holds only available providers** (online, verified, not on a job). It is rebuilt from Postgres on boot. Set `REDIS_URL` empty to fall back to an in-memory index.
- **Dispatch** is a 1-second loop with an expanding radius (8 → 15 → 30 → 50 km, 3-minute timeout). Shield members start wider. Move it to BullMQ when running more than one API instance.
- **One mobile app, two modes** (customer or partner, chosen at sign-in) for Phase 1 speed. Splitting into two store listings later only needs separate app configs.

## What's left

See **[docs/STATUS.md](docs/STATUS.md)**: what's built, and what's left in launch order (tier 1 = before real users).
