# OnSpot: what's built and what's left

Last reviewed: 27 Nov 2026. Feature ideas (incl. unique ones): [IDEAS.md](IDEAS.md). Tiers are in launch order: **1** = blocks real users, **2** = needed soon after launch, **3** = later/scale.

## Built and tested

- **API** (NestJS, Postgres, Redis GEO, Socket.IO) with 28 end-to-end tests: phone OTP login, KYC gate, Fair Price Lock quotes, real-time dispatch with expanding radius and race-safe accept, offer expiry, start code, extras approval, cash confirmation, tips, disputes with capped refunds, late-arrival guard with free switch, top-rated-only dispatch, chat, SOS, family tracking API, push notifications (Expo), partner suspension, demand hotspots, nearby garages (Google Places with OpenStreetMap fallback), ops metrics.
- **Proof of work**: partners add up to 3 before and 3 after photos (checked file type, 5 MB max). Customers see them on the bill, receipt and Activity through signed links that expire; ops see them in the job drawer.
- **Automatic arrival**: the partner is marked arrived within 150 m of the customer, and "I've arrived" taps from more than 0.5 km away are rejected.
- **Partner trust score**: 60% on-time arrivals + 25% kept jobs + up to 15 for no refunded overcharges, shown after 3 arrivals (customer pro card, partner dashboard, ops Partners table).
- **IST everywhere**: night pricing is judged in Asia/Kolkata whatever the server zone, and every displayed time is IST.
- **Cleaner screens**: Account and the partner dashboard are grouped lists with sub-pages; the quote screen keeps garages, price details and notes collapsed until needed; confirmations use an in-app sheet (ops: an in-app dialog) instead of the browser pop-up.
- **Family tracking page** at `/t/<id>`: live map, status and ETA, no private data, link expires 2 h after the trip.
- **Partner background location** (native): battery-friendly while waiting, high accuracy during a job, Play-policy disclosure before the permission prompt.
- **Android build setup**: EAS profiles, permissions, Maps/Firebase keys from env ([ANDROID.md](ANDROID.md)).
- **Mobile app** (Expo SDK 58, customer + partner modes), checked in the browser build: every screen of the job flow, safety card with SMS fallback, Activity, Account (contacts, vehicle, Shield), partner dashboard, KYC, offers, hotspots.
- **Ops console**: live map and KPIs, jobs with full detail, KYC queue, suspensions, disputes, SOS and late alerts.
- **Dev tooling**: side-by-side view (`localhost:5173/side-by-side.html`), seed data, test database.

## Tier 1: before real users

| Area | What's missing | Notes |
|---|---|---|
| **Calling** | Call buttons dial a placeholder number | Add masked calling (Exotel / Knowlarity / Twilio): both sides call a virtual number, real numbers stay private. |
| **SMS** | Login codes and SOS-to-contacts are only logged | MSG91 or Twilio, plus **DLT registration** (mandatory in India for SMS templates and sender ID). |
| **Payments** | Razorpay checkout not wired in the app; tips and refunds recorded but no money moves; no partner payouts | Server order + signature verification exist. Add `react-native-razorpay`, Razorpay Route for payouts, refunds API, GST invoices. *(Deferred by decision for now.)* |
| **Phone build & push on a device** | Configured and validated (expo-doctor, prebuild), not yet built: needs your Expo account and Google/Firebase keys | Follow [ANDROID.md](ANDROID.md): `eas login`, `eas init`, `eas build`. Then test push with the app closed and background location with the screen locked. |
| **Garage data** | Needs a key to use Google | Set `GOOGLE_PLACES_API_KEY` (Places API (New), billing enabled). Without it, OpenStreetMap coverage on highways is poor. |
| **Real KYC** | Only last-4 digits and text fields; ops approve by eye | Document photo upload to private storage (S3), DigiLocker or a KYC vendor for Aadhaar/PAN/DL, UPI/bank "penny drop" check. |
| **Deployment** | Runs locally only | Host API + console (Render/Railway/AWS Mumbai), managed Postgres + Redis, HTTPS domain, secrets, daily DB backups, Sentry, uptime alerts, CI running the e2e tests on every push. |
| **Security** | 30-day JWTs with no refresh/revoke; CORS allows any origin; ops staff share the OTP login | Short access + refresh tokens, sign-out revokes; CORS allowlist; ops staff accounts with roles (agent, admin) and an audit log of ops actions. |
| **Legal & compliance** | No terms, privacy policy, partner agreement, refund/cancellation policy; no account deletion | Required for the Play Store and the DPDP Act 2023 (consent, data retention for location history, delete-my-account). |

## Tier 2: soon after launch

- **Support**: in-app help/contact ops, and the ops side to handle tickets (beyond disputes).
- **Receipts**: PDF/e-mail/SMS receipts with GST details.
- **Languages**: Hindi and Marathi (and later other Indian languages).
- **Pricing in the database**: per-city rate cards and live fuel prices editable from the ops console (currently fixed in code).
- **Real ETAs**: road distance and traffic from a routing API instead of straight-line × 1.35.
- **Dispatch quality**: offer waves (nearest few first, then expand) instead of offering everyone in range at once; partner acceptance score; cancellation penalties.
- **Partner tools**: payout history and bank details, availability schedule, document expiry reminders, in-app navigation.
- **Customer**: saved places, multiple vehicles, booking for someone else, scheduled (non-urgent) bookings.
- **Shield**: real subscription billing (currently a free toggle).
- **Ops console**: customer lookup, refund processing, rate card editor, charts/exports, partner onboarding pipeline.
- **App quality**: move to Expo Router, error boundaries, offline banners, product analytics, crash reporting, accessibility pass.

## Tier 3: later / scale

- Dispatch on a job queue (BullMQ) so the API can run on several servers; per-city Redis.
- Separate customer and partner store listings.
- B2B: insurer / car-maker roadside-assistance API, fleet accounts.
- WhatsApp and IVR booking for people without the app or with a low battery.
- AI triage from a photo or description ("sounds like the battery") and demand forecasting for partners.

## Known shortcuts in the current code

- Location default is a demo spot (Lonavala) when GPS is unavailable.
- The partner's "Simulate drive" button appears in development builds only.
- Offer expiry timestamps live in API memory (lost on restart; offers then remain valid until declined).
- Public Overpass (OpenStreetMap) servers are unreliable; failures are skipped for 2 minutes.
