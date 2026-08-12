# ADR-0018: Payment verification is the product; a gateway is an adapter of last resort

* Status: Accepted
* Date: 2026-08-12

## Context

Every route to a real-time payment signal in India turned out to be gated:
merchant-acquiring APIs need a current account, a GSTIN, an NDA, per-merchant
certificates and a whitelisted static IP that a Cloudflare Worker cannot
provide. Bank account-credit webhooks are not sold to ordinary customers. The
one product that fits — ICICI's e-Collection/iValidate — is relationship-manager
gated and still needs a fixed IP.

The pragmatic answer is to integrate an aggregator: Razorpay in India, Stripe in
France, and so on. It works, and it is what everyone does.

It is also the wrong shape for this project, for two reasons the maintainer put
plainly: it is **not a global solution** — it means writing and maintaining a
different plugin per country — and it puts a **company that can change its
prices** back in the middle of every sale.

The observation that resolves it: **bank statements and decimal currency are
universal.** A minor-unit suffix that makes an order's amount unique works in
rupees, euros, pounds and dollars. A statement is the account's own ledger
everywhere. The verification mechanism we built for India is not Indian.

## Decision

**The evidence model is the product.** Statement import and alert-email parsing
are the primary, universal payment-verification mechanism, and the project's
reason to exist. Effort goes here first.

**Gateway adapters are supported and explicitly secondary.** A vendor who wants
Razorpay or Stripe may have it — the payment port already makes it a config
change — but it is documented as the fallback for merchants whose bank or
country the verification path does not yet reach, not as the recommended setup.

**We will not ship a gateway as the default**, and the README will not describe
the project as "supports Razorpay and Stripe".

## Consequences

One mechanism serves every country, instead of N plugins that each rot at their
own rate. Adding a country means adding *bank profiles* — data, not code — which
the community can contribute without touching TypeScript.

The honest cost is latency and coverage. Statement-based verification is
same-day, not instant. Alert-email verification is instant but only where a bank
sends alerts, which in India means essentially HDFC. A vendor who needs
instant confirmation on any bank today will use a gateway, and we should say so
rather than pretend otherwise.

This also means the project's headline claim is not "cheaper than Razorpay". It
is that the merchant owns the mechanism, in any country, with no vendor able to
reprice it.

Open: whether a gateway adapter ships in v0.1 at all, or waits until the
verification path has been proven on a real shop.
