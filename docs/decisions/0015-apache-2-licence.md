# ADR-0015: Licence under Apache-2.0

* Status: Accepted
* Date: 2026-08-12

## Context

The goal is that small merchants deploy this everywhere, with as little friction
and as little thought as possible.

MIT is the most permissive and most familiar, but grants no patent rights.
AGPL-3.0 would prevent a competitor hosting this as a paid SaaS — but the
project's entire purpose is that people self-host it, and AGPL introduces
questions a shopkeeper's technical friend should never have to think about.
Comparable projects split: Medusa and Bagisto MIT, Saleor BSD-3, Vendure GPL-3
with a commercial dual-licence.

## Decision

Apache-2.0.

## Consequences

Adoption is unencumbered, and the explicit patent grant matters in a payments-
adjacent project more than it would in a static-site generator.

We accept that someone may host this commercially without contributing back.
Given the thesis — that merchants should not pay platform rent — a hosted
competitor charging for convenience is not obviously a bad outcome, and the
software remains free for anyone who would rather run it themselves.

Contributions are inbound under the same licence; no CLA, because a CLA is
friction that buys a solo-maintained project nothing.
