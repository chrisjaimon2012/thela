# Non-goals

This file exists because a solo-maintained project that takes payments and
ships parcels dies of scope, not of technical difficulty. Everything below is a
deliberate refusal, not a gap waiting to be filled. Please do not open issues
asking for them; do open an issue if you think one of these lines is wrong.

## Not building

**Multi-tenant SaaS.** Every shop is a separate deployment in the shopkeeper's
own Cloudflare account. This is not laziness — it is the only configuration in
which "free of cost" and "not a payment aggregator" are simultaneously true.
The moment one deployment serves many merchants through a shared payment
identity, it collects and settles funds on their behalf, which is the RBI
definition of a Payment Aggregator (Directions 2025, para 4(i)) and requires
₹15 crore of net worth.

**Cash on Delivery.** COD carries 20–26% return-to-origin in India against
under 2% for prepaid, and drags in remittance reconciliation, RTO handling,
and a receivable ledger. It roughly doubles the surface area of the project to
serve a payment method the platform's users can start without.

**Multi-carrier failover.** Automatically re-routing to a second courier when
one carrier's pickup fails is a real feature for a warehouse doing hundreds of
parcels a day. For a shop doing one or two, the answer is to walk to the
nearest franchise counter.

**Customer accounts.** Not having them is a feature. Accounts mean passwords,
reset flows, an auth surface to attack, and data-subject obligations under the
DPDP Act — in exchange for repeat-purchase behaviour that barely exists at this
scale. Order status lives behind a signed link in the confirmation email.

**A discount engine.** A shop that wants a festival offer edits its prices for
a fortnight. Coupon codes, stacking rules, and eligibility logic are a
surprisingly deep well.

**Abandoned-cart recovery.** It requires capturing an email address before
payment and then sending unsolicited mail to people who did not buy. Wrong
trade for the businesses this serves.

**ONDC / Beckn.** Philosophically aligned and currently the wrong bet: ONDC's
retail order volume peaked in October 2024 and fell roughly 35% once incentives
were cut, retail's share of the network collapsed as mobility grew, and joining
means running a certified network node with — in practice — a GSTIN. The domain
model should not make an adapter impossible later. That is all.

**Multi-currency, marketplaces, B2B pricing, subscriptions, POS,
multi-warehouse.** Each is a different product.

## Deliberately unsupported

**Shops without a bank that emails credit alerts.** The automatic payment
verifier reads the merchant's own bank alert email. Where a bank does not send
one, the shop falls back to the customer submitting a UTR and the shopkeeper
confirming it, or to a conventional gateway adapter. The setup wizard tests
this before launch rather than letting it be discovered afterwards.

**Shopkeepers who cannot use a terminal.** The honest user of this project is
the *technical friend* of a small business — a nephew, a volunteer, a local
developer. The one-click deploy button and the docs are written for them. The
shopkeeper's job is the admin UI, and that must need no explanation at all.

## Things that are goals, and are easy to mistake for scope creep

- The dead-man's switch cron. Without it, "zero maintenance" means
  "unmonitored", which is worse than a maintenance burden you can see.
- The bank self-test in setup. It converts an invisible assumption into a
  visible pass/fail before any real money is at stake.
- The wallet-balance alarm. An empty carrier wallet means the customer paid and
  nothing shipped.
