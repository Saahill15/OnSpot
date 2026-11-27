# Feature ideas: what to add, and what would make OnSpot stand out

Reviewed against what the apps do today (see [STATUS.md](STATUS.md)) and against how people get roadside help in India now: insurer/car-maker helplines (slow, call-centre based), random numbers from Google, and local contacts.
**Effort**: S ≈ days, M ≈ 1–2 weeks, L ≈ a month+.

## Unique features (the reasons to choose OnSpot)

| # | Feature | Why it stands out | Effort |
|---|---|---|---|
| 1 | ~~Night Guardian~~ | Dropped: OnSpot is a service, not a ride. Customers can still share the trip manually with "Share trip". | — |
| 2 | **Km-stone booking** | On highways people know "Km 62, Mumbai–Pune Expressway", not an address. Type or say the highway + km stone and we place the pin exactly, using NHAI km-marker data. Works when GPS is poor. | M |
| 3 | **Get-home ride when towed** | When the car is towed, the passengers are stranded too. One tap books a cab (Rapido/Ola/Uber deep link or partner fleet) from the breakdown spot. Nobody else does tow + ride together. | S–M |
| 4 | **Proof of work** | Partner takes a "before" photo at the start code and an "after" photo at completion; both go on the receipt. Settles disputes in seconds, builds trust, and later doubles as an insurance claim record. | ✅ Built |
| 5 | **Missed-call & SMS booking** | No data, low battery or no app: give a missed call to the OnSpot number (or SMS "HELP") from a registered phone. We call back with an IVR, take the km stone or last known location, and dispatch. Built for highway dead zones. | M |
| 6 | **Talk-to-book in Hindi/Marathi** | "Meri gaadi start nahi ho rahi" → the app suggests Battery jump and pre-fills the request. Faster under stress and for people who don't read English. | M |
| 7 | **2-minute DIY before you book** | For simple cases (fitting the spare wheel, a blown fuse) show a short guided video first, with "still stuck? request help" one tap away. Builds trust because we're not just selling. | S |
| 8 | **Public Fair Price Board** | A public page with the rate card per city and the real average paid per service (from completed jobs), next to what people report paying elsewhere. Turns Fair Price Lock into marketing. | S |
| 9 | **Partner trust score** | Visible to customers: on-time arrival %, completed jobs, zero-overcharge streak, verified badge. Partners earn more offers by keeping it high. | ✅ Built |
| 10 | **Auto-arrive by geofence** | Mark "arrived" automatically when the partner is within ~100 m, and flag "arrived" taps from far away. Stops fake arrivals and makes the late-arrival guard fairer. | ✅ Built (150 m; taps from > 0.5 km rejected) |
| 11 | **Insurance claim pack** | After an accident or tow: one PDF with location, timeline, photos, partner details and bill, ready for the insurer. Later: direct insurer integrations and cashless garages. | M |
| 12 | **Partner parts & fuel at wholesale** | Partners buy tubes, batteries and fuel stock through OnSpot at negotiated prices. Supply-side reason to stay on the platform. | L |

## Features every customer will expect (not unique, but missing)

| Feature | Notes | Effort |
|---|---|---|
| Referral and promo codes | "Give ₹100, get ₹100" for customers; joining bonus for partners. | S |
| Wallet and refunds to wallet | Faster than bank refunds; pairs with dispute refunds and Shield. | M |
| Notification centre | List of past alerts in the app (pushes are easy to miss). | S |
| Saved places and multiple vehicles | Home, office, parents' house; two-wheeler + car. | S |
| Scheduled (non-urgent) bookings | e.g. battery check tomorrow 9 AM: fills partners' idle daytime hours. | M |
| Help centre and live chat with ops | FAQs plus a support chat that ops answer from the console. | M |
| Rate and review history | Customers see their reviews; partners see feedback trends. | S |
| Accessibility and large-text mode | Many users will be older or stressed; big buttons, screen-reader labels. | S |

## For partners (supply side; this is where marketplaces win or die)

| Feature | Notes | Effort |
|---|---|---|
| Guaranteed night earnings | Minimum ₹ per online hour for night shifts in the launch corridor, funded as marketing. | S (logic) |
| Daily payouts and earnings statements | Payout history, GST-ready statements, bank/UPI change with verification. | M |
| Availability schedule | "Online automatically 10 PM–6 AM" with a reminder. | S |
| Document expiry reminders | Licence, RC, insurance renewals tracked; auto-pause when expired. | S |
| Leaderboard and badges | Weekly top partners per zone; badges shown to customers. | S |
| Fleet accounts | One owner, many trucks/drivers; owner sees all jobs and earnings. | M |

## Ops and business

| Feature | Notes | Effort |
|---|---|---|
| Rate card editor | Per city/service, with change history (pricing is in code today). | M |
| Demand heatmap and forecast | Where/when requests go unmatched, to recruit partners there. | M |
| B2B API for insurers and car makers | Insurers already pay for roadside assistance; sell OnSpot's network as the fulfilment layer. | L |
| Corporate accounts | Fleets and cab aggregators pay monthly for their drivers. | M |

## Suggested order

1. **Done:** Proof of work (4), Auto-arrive by geofence (10), Partner trust score (9). Night Guardian (1) dropped.
2. **Before marketing:** Fair Price Board (8), Referral codes, Get-home ride (3).
3. **Highway edge:** Km-stone booking (2), Missed-call/SMS booking (5), Talk-to-book (6).
4. **Business scale:** Insurance claim pack (11), B2B API, fleets, parts marketplace (12).
