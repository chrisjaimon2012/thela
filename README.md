# thela

> **Working name.** *Thela* (ठेला) is the handcart a great many Indian
> businesses still start from. Rename freely — it is one find-and-replace while
> the repo is young.

A shop that runs entirely on Cloudflare's free tier, takes UPI **straight into
your own bank account**, and dispatches parcels without anyone clicking a
button.

**Status: pre-alpha.** Nothing here has taken a real payment yet. See
[Before you trust this](#before-you-trust-this).

---

## Why

An Indian small business that wants to sell online has two options: pay a
platform, or sell on someone else's marketplace. The cheapest credible
subscription path costs around **₹3,470/month** — and it still makes you open a
courier panel and click *Ship* for every single order.

The bottleneck was never the storefront. Storefronts are a solved problem and
several good ones are free. It is that **payment verification and dispatch are
both gatekept**: payments behind aggregators charging for a rail that is free
by law, and dispatch behind panels designed for a human to click.

This unbundles both.

- **Payments go directly to the merchant.** A dynamic UPI QR or intent link
  paying the shopkeeper's own VPA. This software never receives, holds, or
  settles a rupee — it only verifies that money arrived.
- **Dispatch is an API call.** Paid order → shipment created → AWB assigned →
  label rendered → tracking emailed. Nobody watches it.
- **The whole thing runs on the free tier**, in the shopkeeper's own Cloudflare
  account, on their own domain.

### The argument, stated honestly

It is *not* "we removed the 2% gateway fee". The market already did that — UPI's
zero-MDR rule binds banks rather than aggregators, so a gateway's 2% is a
pricing decision, and at least one authorised aggregator charges 0% on UPI
today.

The argument is that **every one of those rates is a promise a company can
revise.** One is already dated to expire. A verifier running in the merchant's
own Cloudflare account has no vendor to change its mind. The claim is not
*cheaper* — it is *owned*.

## How payment verification works

Bank credit alerts carry no order reference, so you cannot tell which order an
incoming payment belongs to. A UUID of your own does not help: the bank will
never echo it back.

So the **amount becomes the identifier**. Each order awaiting payment is
assigned a unique paise suffix, and the customer types nothing:

```
Order total     ₹1,399.00
Customer pays   ₹1,399.37     ← this order's paise slot, prefilled in the QR
Bank emails     "credited ₹1,399.37 … UTR 402312345678"
                → unique match → order confirmed → dispatch begins
```

Collisions are prevented by the database rather than by application logic: a
partial unique index over open orders means two orders can never ask for the
same amount. Allocation is "try `total + k` for k in 0..99 and take the first
insert that succeeds".

If the amount match misses — a customer rounded up, an alert was slow — the
flow degrades: UPI note, then payer VPA, then the customer's 12-digit UTR, then
a human pressing Confirm. Every path writes the same `payment_verified` event,
so nothing downstream knows or cares which one fired.

### Why this is not a payment aggregator

The RBI (Regulation of Payment Aggregators) Directions, 2025 define an
aggregator **conjunctively** (para 4(i)): an entity that aggregates customer
payments *and* "subsequently settles the collected funds to such merchants."
Collect nothing, settle nothing. Para 4(j) defines a Payment Gateway as
technology infrastructure "without any involvement in handling of funds", and
imposes no operative obligations on it.

This is reasoning from the text, not legal advice. If you deploy this
commercially at any scale, get an opinion.

### The security that makes it safe

An email saying "you were paid" is only trustworthy if it really came from the
bank. The Email Worker:

1. accepts mail only from the bank's exact alert sender,
2. asserts **DKIM alignment** on the bank's domain — the `From` header alone is
   trivially spoofable,
3. enforces `UNIQUE` on the UTR, so one genuine payment cannot be claimed by
   two orders,
4. matches amount **and** a time window,
5. never trusts a client-supplied amount; the total is recomputed server-side.

## Before you trust this

Four things are unverified, and each would break a real shop:

- [ ] **Does your bank email UPI credits at all?** Only HDFC is confirmed from a
      primary source. Run the setup self-test — pay yourself ₹1 and watch what
      arrives — before taking a real order.
- [ ] **What is actually in that email?** The parsers in
      `src/lib/banks/parsers.json` are placeholders. Replace them with patterns
      derived from real samples.
- [ ] **Can a seller without a GSTIN manifest through the carrier API?**
      Delhivery's order-creation docs list `seller_gst_tin` as mandatory while
      its onboarding accepts PAN + Aadhaar. Test in their staging sandbox.
- [ ] **What do the real rates look like?** No Indian carrier publishes its
      card. Open an account and read it.

## Architecture

Single-tenant by design. One repo, one Deploy button, one shop per Cloudflare
account.

| Layer | Choice |
|---|---|
| Runtime | Astro on Cloudflare Workers, aggressive per-route `prerender` |
| Data | D1 — the ledger, and the only source of truth |
| Binaries | R2 for images and labels, served from a custom domain |
| Orchestration | Workflows for dispatch, cron for reconciliation |
| Admin auth | Cloudflare Access one-time PIN (free, 50 users) |
| Email in | Cloudflare Email Routing → Email Worker |
| Email out | Resend |

**D1 is the ledger; Workflows is only the executor.** Free-plan workflow state
is retained three days, so no order fact may live only inside a workflow
instance.

## Deploying

> Not ready yet. When it is, this is a Deploy-to-Cloudflare button plus a setup
> wizard.

**First-run race — read this before you expose a deployment.** A fresh shop has
no admin password, so whoever reaches the setup page first owns it. Set
`ADMIN_SETUP_TOKEN` before the first deploy, and put Cloudflare Access in front
of `/admin` in production.

## Contributing

Read [NON-GOALS.md](./NON-GOALS.md) first — it will save you an afternoon.

The most useful contribution right now is **a real bank alert sample**. Redact
the account number and balance, keep the amount, UTR and narration, and open a
PR adding a parser to `src/lib/banks/parsers.json`.

## Licence

Apache-2.0. Chosen over MIT for the explicit patent grant, and over AGPL
because the goal is that small merchants deploy this everywhere without
thinking about it.
