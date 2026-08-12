# ADR-0005: Use Astro rather than Next.js

* Status: Accepted
* Date: 2026-08-12

## Context

The storefront must render product pages server-side: the catalogue lives in D1
and is edited at runtime, so prerendering would mean a rebuild per price change.

The Workers free plan caps the Worker script at **3 MiB gzipped**. A Next.js SSR
worker carries the React runtime, the Next server and Node polyfills, and
OpenNext's own documentation frames that 3 MiB limit as the thing you upgrade
past. That would force the paid plan before a shop sold anything.

Astro renders to HTML with no client framework by default.

## Decision

We will use Astro with `@astrojs/cloudflare`, `output: 'server'`, and no UI
framework integration. Pages are HTML plus a few dozen lines of vanilla
JavaScript where genuinely needed.

## Consequences

Measured: the built worker is **145 KB gzipped, 4.7% of the free-tier ceiling**.
That headroom is the decision paying for itself, and it should be checked when
dependencies change.

Pages are fast on a mid-range Android over patchy 4G, which is the real
audience — no hydration, no framework download.

We give up the React ecosystem. For a shop with a product list, a product page,
a cart and an admin, that has cost us nothing so far; a genuinely interactive
admin screen may later want an island, which Astro supports without changing
the architecture.
