# OnSpot prototype

The original zero-dependency, clickable prototype (Node 18+). Useful for quick demos; the real product lives in `apps/`.

```bash
cd prototype
node server.js
```

Open http://localhost:4000

* **Customer**: `/#/customer`. Pin your spot, pick a service, see the locked fare, request, track, chat, approve extras, pay, rate.
* **Partner (provider)**: `/#/provider`. Submit KYC, get approved in Ops, go online, accept offers, simulate the drive, enter the customer's OTP, add extras, complete.
* **Ops console**: `/#/admin`. Live map, KPIs, jobs, providers, KYC approval queue, SOS alerts.
* **Family tracking link**: `/#/track/<jobId>` (created by "Share" during a job).

Simulated providers are seeded around the customer's location, so the full flow works with one tab. To act as the provider yourself, open the customer and partner apps in two tabs at the same location: a real provider gets the offer before the simulated ones.

Data is kept in `prototype/data.json` (delete it to reset, or use "Reset demo" in Ops).
