# OnSpot — Help, on the spot

On-demand marketplace for urgent roadside and home help (towing, flat tyre, fuel, battery, mechanic, plumber, electrician, locksmith). Independent, verified providers list themselves and go online; customers get the nearest one at a **locked, fair price**.

## What's here

| Path | What |
|---|---|
| `docs/PRD.md` | Product requirements: problem, personas, flows, pricing, trust & safety, metrics, GTM, risks |
| `docs/ARCHITECTURE.md` | Production architecture (Expo + NestJS + Postgres/PostGIS + Redis GEO + Socket.IO + Razorpay), data model, job state machine, dispatch, pricing |
| `docs/ROADMAP.md` | Build order: prototype → corridor MVP → trust/scale → home services → revenue |
| `onspot/` | **Phase 1 production codebase**: NestJS API, Expo mobile app (customer + partner), ops console. Start here: [onspot/README.md](onspot/README.md) |
| `app/` | Original clickable prototype, no dependencies (Node 18+), kept for demos |

## Run the prototype

```bash
cd app
node server.js
```

Open http://localhost:4000

* **Customer**: `/#/customer`. Pin your spot, pick a service, see the locked fare, request, track, chat, approve extras, pay, rate.
* **Partner (provider)**: `/#/provider`. Submit KYC, get approved in Ops, go online, accept offers, simulate the drive, enter the customer's OTP, add extras, complete.
* **Ops console**: `/#/admin`. Live map, KPIs, jobs, providers, KYC approval queue, SOS alerts.
* **Family tracking link**: `/#/track/<jobId>` (created by "Share" during a job).

Simulated providers are seeded around the customer's location, so the full flow works with one tab. To act as the provider yourself, open the customer and partner apps in two tabs at the same location: a real provider gets the offer before the simulated ones.

## Features in the prototype

* Real-time dispatch with expanding search radius (8 → 15 → 30 → 50 km) and first-accept-wins locking
* **Fair Price Lock**: itemised fare before booking; capped night surcharge; extras need in-app customer approval, and rejected extras are not charged
* Start-OTP so the job can only begin when the provider is physically there
* Live tracking with ETA, in-app chat (masked numbers), quick replies
* SOS that alerts ops and the customer's emergency contacts; public live-trip link for family
* Cancellation with reasons, plus a visit fee only after the provider has arrived
* Saved vehicle, emergency contacts, **OnSpot Shield** subscription (no platform fee, priority dispatch)
* Provider KYC (submit → ops approve/reject; must be verified to go online), earnings and payout view
* Ops console: GMV, revenue, match rate, time to match, live map, KYC queue

Data is kept in `app/data.json` (delete it to reset, or use "Reset demo" in Ops).
