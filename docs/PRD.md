# OnSpot — Product Requirements Document (v1.0)

> **One line:** Uber-style on-demand marketplace that connects people stuck *right now* (car breakdown, flat tyre, no fuel, burst pipe, locked out) with **independent, verified, nearby service providers** — at a **fair, upfront, locked price**.

Working name: **OnSpot** ("help, on the spot"). Rename freely.

---

## 1. Problem

Origin story: stranded on a highway at midnight, car out of fuel, needed a tow.

| Pain | What actually happens today |
|---|---|
| **Discovery** | No single place to find a tow truck / puncture shop / mechanic open *now* and *near me*. Google listings are stale, numbers don't pick up at night. |
| **Price exploitation** | Providers quote high because the customer is helpless ("distress pricing"). |
| **Bait & switch** | Even after agreeing, the provider charges more on arrival ("extra km", "night charge", "parts"). |
| **Trust & safety** | Unknown person, at night, isolated location. No identity, no record, no accountability. |
| **No ETA** | "Coming in 10 minutes" turns into 90 minutes. No tracking. |

Providers have the mirror problem: idle time, no steady demand, dependence on word of mouth, payment disputes.

## 2. Vision & positioning

* **Marketplace, not employer.** Providers are independent businesses/individuals who list themselves, go online when they want, accept jobs they want (Rapido/Uber model). OnSpot earns a commission + platform fee.
* **Differentiator vs Urban Company:** UC is *scheduled* home services. OnSpot is **urgent, location-based, 24×7, roadside-first**. Speed + fair price + safety are the product.
* **Core promise — "Fair Price Lock":** the price you see before booking is the most you pay. Anything extra (parts, tolls) must be **itemised and approved by you in the app** before it's added.

## 3. Users & personas

| Persona | Need |
|---|---|
| **Stranded driver (primary)** — Rahul, 28, car dies on expressway at 1 AM | Help fast, know the price, feel safe, share location with family |
| **Two-wheeler commuter** — puncture on the way to work | Cheapest, nearest puncture fix in < 20 min |
| **Home emergency** — burst pipe / power trip / locked out | Plumber/electrician/locksmith *now*, not tomorrow |
| **Provider (supply)** — Sanjay, owns 1 tow truck; Imran, puncture shop owner; freelance mechanic | More jobs, guaranteed payment, no haggling, flexible hours |
| **Fleet owner** — 10 tow trucks | Manage drivers, see earnings, accept B2B jobs |
| **Ops/Admin** | Verify providers, monitor live jobs, resolve disputes, set rate cards |

## 4. Service catalog (launch → later)

**Launch (roadside, highest pain):** Towing (flatbed / wheel-lift), Flat tyre / puncture, Fuel delivery, Battery jump-start, On-spot mechanic.
**Phase 2 (home emergency):** Plumber, Electrician, Locksmith.
**Phase 3:** Car wash at spot, AC repair, pest control, appliance repair, ambulance partner hand-off (link to 108/112, not replace).

## 5. Core user flows

### 5.1 Customer — request help
1. Open app → location auto-detected (GPS; manual pin fallback; landmark/highway km-stone field).
2. Pick service (big tiles, 1 tap). For towing: pick drop point (nearest garage suggestions).
3. See **locked fare** with breakdown (base + distance + night surcharge, capped), ETA, number of providers nearby.
4. Optional: vehicle type, photo/notes ("front left tyre", "automatic car").
5. Tap **Request** → dispatch searches nearest online providers (expanding radius).
6. Matched → see provider name, photo, rating, vehicle number, live location, ETA, call/chat (masked number).
7. **Start OTP**: provider must enter the customer's 4-digit OTP to start the job (proves they're physically there, prevents fake starts).
8. Add-ons: provider proposes extra item (e.g., new tube ₹250, toll ₹80) → customer **Approve / Reject** in-app. No approval = no charge.
9. Job complete → pay (UPI/card/cash/wallet) → rate & review → receipt.

### 5.2 Provider
1. Sign up → KYC (Aadhaar/PAN via DigiLocker, DL, RC for vehicle, shop photo, bank/UPI) → verification by ops.
2. Choose services offered + equipment (flatbed? air compressor? jump starter?).
3. **Go online** toggle → location shared while online.
4. Incoming job card (sound + vibrate): service, distance, fare, customer rating → Accept within 20 s.
5. Navigate (Google Maps deep link) → Arrived → enter OTP → do job → add-ons if needed → Complete.
6. Earnings dashboard: today/week, commission, payouts (T+1 to bank/UPI).

### 5.3 Admin / Ops
Live map of jobs & providers, KYC queue, rate-card editor per city/service, dispute desk, refunds, provider suspension, analytics.

## 6. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| F1 | Phone + OTP login (both apps) | P0 |
| F2 | Location detection + manual pin + address/landmark | P0 |
| F3 | Service catalog with platform rate card per city | P0 |
| F4 | Upfront fare quote with breakdown, night surcharge capped | P0 |
| F5 | Real-time dispatch to nearest online providers, radius expansion, timeout | P0 |
| F6 | Live tracking + ETA | P0 |
| F7 | Start-OTP verification | P0 |
| F8 | Add-on proposal → customer approval workflow | P0 |
| F9 | Payments: UPI/card (gateway), cash, receipts | P0 |
| F10 | Ratings & reviews both ways | P0 |
| F11 | Provider KYC & verification | P0 |
| F12 | Cancel flows with fair cancellation fee rules | P1 |
| F13 | Masked calling + in-app chat | P1 |
| F14 | **SOS button** + share live trip with emergency contacts | P1 |
| F15 | Provider earnings & payouts | P1 |
| F16 | Admin console | P1 |
| F17 | Push notifications + SMS fallback (low network on highways) | P1 |
| F18 | Scheduled/pre-booked services | P2 |
| F19 | Subscriptions ("OnSpot Shield" roadside cover) | P2 |
| F20 | B2B: insurers, fleets, car rental cos. API | P2 |

## 7. Pricing & business model

* **Platform rate card** per service per city: `base + per-km (beyond included km) + tow per-km`. Providers cannot exceed it. (Phase 2 option: providers bid *below* cap.)
* **Night surcharge** 10 PM–6 AM: +20%, **hard-capped** (₹150 default). Shown upfront.
* **Platform fee** to customer: ₹19 flat.
* **Commission** from provider: 10–15% (launch at 0–5% for first 3 months to attract supply).
* **Subscription "Shield"**: ₹99/month or ₹799/year → zero platform fee, priority dispatch, 1 free jump-start/fuel delivery per year.
* **B2B**: insurers & OEMs already buy roadside assistance (RSA) — sell OnSpot supply network as RSA fulfilment. Big revenue lever.
* Fuel delivery: fuel at pump price + delivery fee (comply with local rules — partner with fuel pumps).

## 8. Trust & safety (product pillar, not a feature)
* KYC-verified providers; badge on profile; vehicle number shown.
* Start-OTP; live tracking; trip share link; SOS → calls 112 + notifies contacts + ops.
* Masked phone numbers.
* Fair Price Lock + itemised add-on approval + digital receipt.
* Two-way ratings; auto-suspend providers below 3.8 avg or with repeated overcharge complaints.
* Women-safety: option to prefer highly rated/verified providers, ops callback within 2 min on SOS.

## 9. Non-functional requirements
* Match in **< 60 s p90** where supply exists; location updates every 3–5 s.
* Works on **2G/poor network**: tiny payloads, SMS fallback for job alerts and OTP, offline-tolerant provider app.
* Availability 99.9% (it's an emergency product — night traffic is critical).
* Low-end Android (2 GB RAM) friendly. Hindi/Marathi/regional language support.
* DPDP Act 2023 compliance (consent, data minimisation, location only while online/active job).

## 10. Success metrics
| Metric | Target (launch corridor) |
|---|---|
| Request → match rate | > 80% |
| Median time to match | < 45 s |
| Median ETA (roadside) | < 25 min |
| Final price = quote (no unapproved extras) | 100% (enforced) |
| Customer rating | > 4.5 |
| Provider weekly active / onboarded | > 60% |
| Repeat customers in 90 days | > 25% |

## 11. Go-to-market (supply first!)
Marketplaces die from empty supply. Start **narrow and dense**:
1. Pick **one corridor + one city** (e.g., Mumbai–Pune Expressway + Pune city).
2. Onboard 50–100 providers offline: tow operators, puncture shops near highways, dhaba-side mechanics. Give them a free phone stand + stickers + 0% commission for 3 months.
3. Demand: QR stickers at toll plazas, petrol pumps, dhabas; tie up with car clubs, cab driver unions, insurers.
4. Expand services/cities only when match rate > 80%.

## 12. Risks & mitigations
| Risk | Mitigation |
|---|---|
| Cold start / no supply at night | Corridor focus, night incentives, guaranteed minimum per online hour for first N providers |
| Providers take customer offline (disintermediation) | Low commission, payment guarantee, demand flow, insurance cover only on-platform |
| Fraud (fake jobs, fake providers) | KYC, OTP start, GPS proof, payout holds on flagged jobs |
| Regulation (towing permits, fuel delivery rules) | Partner model with licensed operators/fuel pumps |
| Poor network on highways | SMS fallback, lightweight app, IVR booking number |

## 13. Out of scope (v1)
Medical emergencies (we link to 112/108), vehicle sales, long-distance logistics, in-house employed workforce.

## 14. Add-ons & improvements suggested beyond the original idea
1. **Fair Price Lock** + add-on approval (direct fix for the "charged more after coming" problem).
2. **Start OTP** + live tracking + SOS + trip share.
3. **IVR/WhatsApp booking** for people with low battery or no app installed ("Send 'HELP' to …" → location pin → dispatch).
4. **Low-battery mode**: one-tap request, minimal screen.
5. **Highway km-stone input** (people know "km 62 near Lonavala" better than addresses).
6. **Garage drop suggestions** for towing + insurer cashless tie-ups.
7. **Shield subscription** & insurer RSA integration.
8. **Provider tools**: earnings, heat-map of demand, digital invoices, GST.
9. **Community fallback**: if no provider within radius, show nearest 24×7 shops/police highway helpline.
10. **AI triage** (later): customer describes issue/photo → app suggests right service ("sounds like battery, not mechanic") and pre-fills it.
