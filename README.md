<p align="center">
  <img src="docs/assets/logo-480.png" alt="thela" width="220" />
</p>

<h1 align="center">thela</h1>

<p align="center">
  A shop that runs on your own Cloudflare free tier, takes payment straight into
  your own bank account, and prints its own labels. No platform fee, no shipping
  aggregator, and no payment aggregator unless you want one.
</p>

<p align="center">
  <a href="LICENSE"><img alt="Apache-2.0" src="https://img.shields.io/badge/licence-Apache--2.0-blue.svg" /></a>
  <img alt="status: pre-alpha" src="https://img.shields.io/badge/status-pre--alpha-orange.svg" />
  <img alt="worker bundle 204 KB" src="https://img.shields.io/badge/worker-204%20KB%20gzipped-brightgreen.svg" />
  <img alt="180 tests" src="https://img.shields.io/badge/tests-180-brightgreen.svg" />
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

- **Payments go directly to the merchant.** This software never receives, holds
  or settles money — it only verifies that money arrived, from a bank statement,
  a credit alert, or a shopkeeper who checked their own account. A shop that
  would rather use Stripe or Razorpay can, and the same matcher handles it.
- **Dispatch needs no aggregator.** Paste a tracking number and thela identifies
  the carrier, catches a typo before it reaches a customer, prints a 4×6 label
  and emails a working link. That works in every country on day one, with no
  carrier account. Direct carrier adapters are an upgrade, not a requirement.
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
Order total     1,399.00
Customer pays   1,399.37     ← this order's minor-unit slot, prefilled
Statement says  "credited 1,399.37 … ref 402312345678"
                → unique match → order confirmed → dispatch begins
```

Collisions are prevented by the database, not by application logic: a partial
unique index over open orders means two orders can never ask for the same
amount.

It works in paise, cents or centimes — the mechanism is not Indian, which is
why it can be the answer everywhere rather than one plugin per country.

When the amount match misses, the credit lands in a review queue with the likely
orders beside it and the difference spelled out, because the commonest failure is
a customer who rounded the suffix off. Every path — statement, alert, a human
pressing Confirm, a gateway webhook — writes the same event through one matcher,
so nothing downstream cares which fired.

**Why this is not a payment aggregator:** RBI's 2025 Directions define one
conjunctively (para 4(i)) as an entity that aggregates payments *and*
"subsequently settles the collected funds to such merchants". Collect nothing,
settle nothing. Full reasoning in
[ADR-0003](docs/decisions/0003-never-handle-funds.md).

## Before you trust this

Nothing here has taken a real payment. These are the things still unverified,
and each would break a real shop:

- [ ] **Does your bank email credit alerts at all?** In India, RBI mandates SMS
      and only *permits* email — only HDFC is confirmed. Statement upload works
      regardless and is the stronger source anyway. See
      [supported banks](docs/supported-banks.md).
- [ ] **What is actually in that email?** The parsers in
      `src/lib/banks/parsers.json` are placeholders until replaced with patterns
      from real samples.
- [ ] **Can a seller without a GSTIN manifest through an Indian carrier's API?**
      Delhivery's docs list `seller_gst_tin` as mandatory while its onboarding
      accepts PAN + Aadhaar. Untested, and it gates that adapter — not the shop,
      which dispatches manually without any carrier account.
- [ ] **Do Indian carriers IP-allowlist their API clients?** Workers have no
      static egress IP on the free plan, so an allowlisting carrier is not
      expensive — it is unreachable.

Answered since this list was first written:

- [x] **D1's `batch()` rolls back on a constraint violation** — and does *not*
      when a statement merely affects zero rows, which is why stock reservation
      is unguarded. Both are executable proofs in `tests/db/schema.test.ts`.

## Architecture

Single-tenant by design: one repo, one deploy, one shop per Cloudflare account.
Nothing about the shop is hardcoded — country, currency, language, tax wording,
carrier and payment method are all answered at setup, so the same code serves a
church stall in Maharashtra and a print studio in Lyon.

| Layer | Choice |
|---|---|
| Storefront | Astro on Cloudflare Workers — **204 KB gzipped**, 6.5% of the free ceiling |
| Background | A second Worker, `thela-ops`, for bank alert email and cron ([ADR-0023](docs/decisions/0023-a-second-worker-for-email-and-cron.md)) |
| Data | D1 — the ledger, and the only source of truth. The shop builds its own schema on first run |
| Binaries | R2, **optional** — a default install has none, because R2 needs a card ([ADR-0021](docs/decisions/0021-install-by-button-update-by-pull-request.md)) |
| Admin auth | Passkeys. A password costs 7.5 ms of a 10 ms CPU budget; a passkey costs 0.044 ms ([ADR-0022](docs/decisions/0022-passkeys-because-a-password-costs-too-much-cpu.md)) |
| Labels | 4×6 HTML with an inline Code 128 SVG. No PDF library, nothing stored |
| Email in | Cloudflare Email Routing → the ops Worker |
| Email out | Pluggable: Cloudflare Email Routing (free, own addresses) or Resend |

Full detail in [docs/architecture.md](docs/architecture.md).

## Install

<a href="https://deploy.workers.cloudflare.com/?url=https://github.com/chrisjaimon2012/thela"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare" /></a>

> **Set your custom domain before you run the setup wizard.** A passkey is bound
> to the hostname it was created on, so claiming your shop on `*.workers.dev`
> and moving to your own domain afterwards leaves you unable to sign in.
> [docs/deploying.md](docs/deploying.md) has the full sequence.

Cloudflare copies this repository into your own GitHub account, creates the
database, asks you for two values, builds, and deploys. Then open `/admin/setup`
and answer a short wizard: shop name, currency, address, how you take payment.
No terminal, no configuration file.

Two things to know before you click.

**A free Cloudflare account is enough**, and no card is needed. A default
install has no object storage, so your shop starts with no product photographs
— everything else works. Adding photographs means adding
[R2](https://developers.cloudflare.com/r2/), whose free tier is generous but
whose signup asks for a payment method; the admin walks you through it when you
are ready.

**If the deploy finishes but your shop shows Cloudflare's "Hello World" page**,
you have hit [an open Cloudflare bug](https://github.com/cloudflare/workers-sdk/issues/14553)
where the copy silently fails. The dashboard reports success either way. Delete
the Worker and the repository it made, and use the manual path below.

### Installing by hand

```bash
git clone https://github.com/chrisjaimon2012/thela.git && cd thela
npm install
npx wrangler d1 create thela        # paste the id into wrangler.jsonc
npx wrangler secret put ADMIN_SETUP_TOKEN
npx wrangler secret put SESSION_SECRET
npm run deploy                      # applies migrations, then deploys
```

### Updates

Installed shops receive updates as a pull request. A scheduled action checks
this repository weekly and, when something has changed, opens a PR against your
own copy with a plain-language summary. Read it, click Merge, and Cloudflare
rebuilds. Nothing changes on your shop until you do.

This exists because the Deploy button *copies* rather than forks, so there is no
"Sync fork" button to press — see
[ADR-0021](docs/decisions/0021-install-by-button-update-by-pull-request.md).

## Development

```bash
npm install
npm run db:migrate:local   # apply the schema to a local D1
npm run db:seed:local      # sample church shop, six frame blanks
npm run db:seed:apparel    # or: a Lyon print studio, in euros
npm run dev
```

```bash
npm run test:schema        # 13 executable schema invariants
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
