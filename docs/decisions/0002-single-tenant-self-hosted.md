# ADR-0002: Ship single-tenant and self-hosted

* Status: Accepted
* Date: 2026-08-12

## Context

The project's purpose is that any small Indian business can run a shop for
free. Two topologies could deliver that: a hosted multi-tenant service, or
software each merchant deploys into their own Cloudflare account.

Multi-tenant is friendlier to non-technical users. It is also the topology in
which the project would hold merchants' bank credentials and customers'
personal data, incur a hosting bill that scales with adoption, and — the
decisive point — sit one product decision away from being a Payment Aggregator
under RBI's 2025 Directions the moment a shared payment identity appeared.

## Decision

We will ship single-tenant, self-hosted software. One repository, one
"Deploy to Cloudflare" button, one shop per Cloudflare account. Every binding,
credential and customer record lives in the merchant's own account.

We will not operate a hosted version.

## Consequences

The project has no hosting bill, no merchant funds, no customer PII, and no
obligations under the DPDP Act for other people's shoppers. "Free of cost" and
"not a payment aggregator" are simultaneously true, which is only possible in
this topology.

The cost is real: onboarding requires a Cloudflare account and a domain, which
means the honest user is a *technical friend* of a small business rather than
the shopkeeper. Documentation must be written for that person.

Cloudflare for Platforms remains the escape hatch if a managed offering is ever
wanted commercially, at $25/month with no free tier.
