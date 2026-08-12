# ADR-0017: Build globally, ship India first

* Status: Accepted
* Date: 2026-08-12

## Context

The project began as one church's shop and grew into infrastructure for small
businesses. The obvious next step is to assume India everywhere — INR, GST,
Delhivery, UPI — because that is the first user and every constraint we
researched is Indian.

That would be a mistake we could not undo cheaply. A vendor in France should be
able to run this on Cloudflare's free tier with a local carrier and whatever
payment verification works there. Nothing in the architecture actually requires
India; only the *adapters* do.

## Decision

The core is country-agnostic. Everything country-specific is an adapter or a
setting.

* **Money is minor units, always.** Paise, cents, pence — one integer, one
  currency code, one exponent from the settings. No function is named after a
  currency.
* **Tax is a configured rule, not a hardcoded regime.** GST is a rate, a
  registration flag and an invoice template — the same shape as VAT.
* **Carriers are adapters with no country assumption.** The port is
  serviceability, quote, create, label, track, cancel, pickup. Delhivery is the
  first implementation, not the interface.
* **Payment verification is a mechanism, not a market.** See
  [ADR-0018](0018-verification-first-payments.md).
* **Compliance fields are structured and optional.** Legal Metrology
  declarations are product fields a vendor may fill; they are not required by
  the schema and do not appear when unset.

India ships first, and India-specific defaults live in seed data and
documentation rather than in code paths.

## Consequences

Every feature costs slightly more to build, because "what would this look like
in another country" has to be answered once per feature rather than never.

In exchange the project is not a fork away from being useful outside India, and
the first non-Indian adopter is a new adapter rather than a rewrite.

Concretely and immediately: `formatINR` becomes `formatMoney(minor, currency)`,
the docs stop saying "paise slot" and say "minor-unit slot", and the pincode
table becomes a generic postal-code serviceability table.
