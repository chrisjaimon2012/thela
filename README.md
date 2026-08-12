<p align="center">
  <img src="docs/assets/logo-480.png" alt="thela" width="220" />
</p>

<h1 align="center">thela</h1>

<p align="center">
  A shop that runs on your own Cloudflare free tier, takes UPI straight into
  your own bank account, and dispatches parcels without anyone clicking a button.
</p>

<p align="center">
  <a href="LICENSE"><img alt="Apache-2.0" src="https://img.shields.io/badge/licence-Apache--2.0-blue.svg" /></a>
  <img alt="status: pre-alpha" src="https://img.shields.io/badge/status-pre--alpha-orange.svg" />
  <img alt="worker bundle 145 KB" src="https://img.shields.io/badge/worker-145%20KB%20gzipped-brightgreen.svg" />
</p>

---

> **ठेला** — the handcart a great many Indian businesses start from, and plenty
> never outgrow. One person, one cart, no rent. That is the audience.

**Status: pre-alpha.** Nothing here has taken a real payment yet. See
[Before you trust this](#before-you-trust-this).

## Why

An Indian small business that wants to sell online has two options: pay a
platform, or sell on someone else's marketplace. The cheapest credible
subscription path costs around **₹3,470/month** — and it *still* makes you open
a courier panel and click *Ship* for every order.

The bottleneck was never the storefront. Storefronts are solved and several
good ones are free. It is that **payment verification and dispatch are both
gatekept** — payments behind aggregators charging for a rail that is free by
law, and dispatch behind panels designed for a human to click.

This unbundles both.

- **Payments go directly to the merchant.** A dynamic UPI QR or intent link
  paying the shopkeeper's own VPA. This software never receives, holds or
  settles a rupee — it only verifies that money arrived.
- **Dispatch is an API call.** Paid → shipment created → AWB → label → tracking
  emailed. Nobody watches it.
- **It runs on the free tier**, in the shopkeeper's own Cloudflare account, on
  their own domain.

### The claim, stated honestly

Not "we removed the 2% gateway fee" — the market already did that. UPI's
zero-MDR rule binds banks rather than aggregators, so a gateway's 2% is a
pricing decision, and at least one authorised aggregator charges 0% on UPI today.

The claim is that **every one of those rates is a promise a company can
revise**, and one already has an expiry date on it. A verifier running in the
merchant's own account has no vendor to change its mind. Not *cheaper* — *owned*.

## How payment verification works

Bank credit alerts carry no order reference, and a UUID of your own is useless
because the bank will never echo it back. So **the amount becomes the
identifier**:

```
Order total     ₹1,399.00
Customer pays   ₹1,399.37     ← this order's paise slot, prefilled in the QR
Bank emails     "credited ₹1,399.37 … UTR 402312345678"
                → unique match → order confirmed → dispatch begins
```

Collisions are prevented by the database, not by application logic: a partial
unique index over open orders means two orders can never ask for the same
amount.

If the amount match misses, the flow degrades — UPI note, payer VPA, the
customer's UTR, then a human pressing Confirm. Every path writes the same
`payment_verified` event, so nothing downstream cares which one fired.

**Why this is not a payment aggregator:** RBI's 2025 Directions define one
conjunctively (para 4(i)) as an entity that aggregates payments *and*
"subsequently settles the collected funds to such merchants". Collect nothing,
settle nothing. Full reasoning in
[ADR-0003](docs/decisions/0003-never-handle-funds.md).

## Before you trust this

Four things are unverified, and each would break a real shop:

- [ ] **Does your bank email UPI credits at all?** RBI mandates SMS and only
      *permits* email — only HDFC is confirmed. Run the setup self-test before
      taking a real order. See [supported banks](docs/supported-banks.md).
- [ ] **What is actually in that email?** The parsers in
      `src/lib/banks/parsers.json` are placeholders until replaced with patterns
      from real samples.
- [ ] **Can a seller without a GSTIN manifest through the carrier API?**
      Delhivery's docs list `seller_gst_tin` as mandatory while its onboarding
      accepts PAN + Aadhaar. Test in their staging sandbox.
- [ ] **Does D1's `batch()` roll back on constraint violation as documented?**
      sqlite3 proves the CHECK raises; the rollback needs a Miniflare test.

## Architecture

Single-tenant by design: one repo, one deploy, one shop per Cloudflare account.

| Layer | Choice |
|---|---|
| Runtime | Astro on Cloudflare Workers — **145 KB gzipped**, 4.7% of the free ceiling |
| Data | D1 — the ledger, and the only source of truth |
| Binaries | R2 for images and labels, served from a custom domain |
| Orchestration | Workflows for dispatch, cron for reconciliation and alarms |
| Admin auth | Cloudflare Access one-time PIN — free, 50 users, zero auth code |
| Email in | Cloudflare Email Routing → Email Worker |
| Email out | Resend |

Full detail in [docs/architecture.md](docs/architecture.md).

## Development

```bash
npm install
npm run db:migrate:local   # apply the schema to a local D1
npm run db:seed:local      # sample church shop, six frame blanks
npm run dev
```

```bash
npm run test:schema        # 7 executable schema invariants
npm run typecheck
npm run build
```

## Documentation

Start at [docs/](docs/). Decisions are recorded as
[ADRs](https://adr.github.io/) in [docs/decisions/](docs/decisions/), and
things we deliberately refused are in [NON-GOALS.md](NON-GOALS.md) so they stay
refused.

Working on this with an AI agent? [CLAUDE.md](CLAUDE.md) is written for it.

## Contributing

Read [NON-GOALS.md](NON-GOALS.md) first — it will save you an afternoon.

The most useful contribution right now is **a real bank alert sample**. Redact
the account number and balance, keep the amount, UTR and narration, and open a
PR adding a parser to `src/lib/banks/parsers.json`.

## Licence

[Apache-2.0](LICENSE) — permissive, with an explicit patent grant, because the
goal is that small merchants deploy this everywhere without thinking about it.
