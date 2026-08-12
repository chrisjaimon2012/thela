# ADR-0013: Integrate a carrier directly, not an aggregator

* Status: Accepted
* Date: 2026-08-12

## Context

Courier aggregators (Shiprocket and similar) sell four things: pooled rates,
multi-carrier fallback, NDR/RTO tooling, and COD remittance.

For a prepaid shop (ADR-0011) three are close to worthless. Prepaid RTO is under
2%, so the NDR machinery solves a problem we do not have. COD remittance is
irrelevant. Coverage is oversold — India has only ~19,000 unique PIN codes, so
every "24,000+ pincodes" claim exceeds the number that exist, and one national
carrier already reaches ~97% of them. Damage cover is void regardless: carriers
exclude glass from liability entirely.

That leaves rate, where an aggregator is perhaps ₹5–15/shipment cheaper — except
Shiprocket gates API access behind a ₹499/month plan, which erases the saving
below roughly 17 orders/month.

Delhivery One, by contrast, onboards individuals with PAN + Aadhaar, has no
subscription, issues a self-service API token that does not expire, and
publishes a real staging sandbox.

## Decision

We will define a carrier-agnostic shipping port and ship **Delhivery One** as
the first adapter, plus a **manual** adapter (paste a carrier and AWB) that
doubles as the India Post fallback for rural pincodes.

An aggregator adapter may follow. If so it will be a zero-subscription one, not
Shiprocket, so no user is obliged to pay ₹7,068/year before our code runs.

## Consequences

A merchant needs one carrier account and no sales conversation, which is the
only shape compatible with self-hosted onboarding.

We forgo the one genuine aggregator benefit: when a courier's pickup rider stops
appearing — a documented pattern at 1–2 parcels/day — an aggregator can
re-allocate and we cannot. The mitigation is a franchise drop-off, which is
acceptable at this scale and would not be at 100 parcels/day.

**Unresolved and gating:** Delhivery's order-creation API documents
`seller_gst_tin` as mandatory while its onboarding accepts PAN + Aadhaar without
a GSTIN. This must be tested in their staging sandbox before the adapter is
written; if the field is enforced, this decision inverts for non-GST merchants.
