# Working on thela

Operating instructions for an AI agent (or a new human) working in this repo.
Read this before touching anything. The standards themselves live in
[docs/engineering-guidelines.md](docs/engineering-guidelines.md); this file is
about *how to work here*, not *how to write code*.

## What this project is, in one paragraph

A self-hosted shop that runs on one merchant's own Cloudflare free tier, takes
UPI directly into their own bank account, and dispatches parcels without anyone
clicking a button. **The software never touches money.** That single constraint
is what keeps it outside India's Payment Aggregator regime, and it is not
negotiable — see [ADR-0003](docs/decisions/0003-never-handle-funds.md).

## Non-negotiables

Violating any of these is a bug, not a style disagreement.

1. **Never route, hold, or settle funds.** No pooled account, no platform VPA,
   no settlement step. Payment adapters observe evidence; they never receive it.
2. **Never let a payment channel auto-settle above its trust tier.** A bank
   alert email can be wrong — RBL was documented sending 47 false "credited"
   emails out of 54. See [ADR-0010](docs/decisions/0010-bank-trust-tiers.md).
3. **Never add a matching path.** Every evidence source calls one `resolve()`.
   If a new source seems to need its own branch, the model is wrong —
   [ADR-0006](docs/decisions/0006-one-matcher-many-evidence-sources.md).
4. **Never guess a package version, an API shape, or a regulation.** Check the
   registry, the docs, or the statute. Three of the four versions originally in
   `package.json` did not exist because they came from memory.
5. **Never put a secret in `wrangler.jsonc`** or any committed file.
6. **Never make a page do the work.** Files under `src/pages/` read input, call
   one function in `src/lib/`, and render. No SQL, no business rule, no
   branching on shop configuration. This is what keeps
   [ADR-0019](docs/decisions/0019-ship-an-app-not-an-integration.md) reversible;
   lose it and we lose the option quietly.
7. **Never hardcode what a different shop would need different.** If a print
   studio in Lyon would want another value, it is a setting, not a literal. The
   `setting` table is the only reason a vendor can use thela without forking it.

## Before you change code

- Read [docs/decisions/](docs/decisions/) for anything touching payments,
  stock, or shipping. Most surprising code here is deliberate and explained.
- Two idioms look like mistakes and are not. Both are documented inline and
  proved in `tests/invariants.test.sql`:
  - **Stock reservation is unguarded**, relying on `CHECK (reserved <= on_hand)`
    to raise. A guarded conditional `UPDATE` matching zero rows *succeeds* in
    SQLite, so `batch()` would commit a partial order.
  - **Idempotency keys on the payment reference alone**, not
    `(source, reference)`. The same UTR seen by email and again in a statement
    is the same money.

## After you change code

Run these. All three must pass:

```bash
npm run test:schema   # 13 executable schema invariants
npm run typecheck
npm run build         # also prints nothing if the bundle is fine
```

Then check the bundle has not ballooned — the free plan's ceiling is 3 MiB
gzipped and we currently sit around 145 KB:

```bash
find dist/server -name '*.mjs' -exec cat {} + | gzip -9 | wc -c
```

## Keeping the docs true

Documentation drift is the failure mode this file exists to prevent.

- **Any architectural decision gets an ADR.** Copy
  [the template](docs/decisions/0000-template.md), take the next number, never
  edit a decided ADR — supersede it with a new one and mark the old one
  `Superseded by ADR-XXXX`.
- **Changing a flow means updating its Mermaid diagram** in [docs/flows/](docs/flows/).
- **Changing the schema means updating** `docs/architecture.md` and, if an
  invariant changed, `tests/invariants.test.sql`.
- **Rejecting an option is worth recording too.** `NON-GOALS.md` exists so that
  the same idea is not re-proposed in six months. SMS forwarding is in there
  precisely because it is a good idea with a fatal flaw.

## Writing commits

Explain *why*, not *what* — the diff already says what. If a change fixes
something subtle, say what would have gone wrong. Good examples are in
`git log`; the SMS and idempotency commits are the pattern to follow.

End with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

## Things that will bite you

| Trap | Reality |
|---|---|
| `wrangler.jsonc` with `main`/`assets` | Breaks `astro build`. The adapter generates the entry. |
| `Astro.locals.runtime.env` | Removed in Astro 7. Use `import { env } from 'cloudflare:workers'`. |
| Any `.sql` in `migrations/` | Wrangler applies **all** of them. Tests live in `tests/`, seeds in `seeds/`. |
| `"database_id": ""` or omitting it | Kills `astro dev` at the first request. Miniflare asserts the id is truthy; empty gives a bare falsy-value assertion, absent gives a misleading dep-optimizer error. Keep the placeholder. |
| Changing `database_id` | Re-keys the local D1. Your tables vanish — re-run `db:migrate:local` and `db:seed:local`. |
| `The file does not exist at .../deps_ssr/…?v=<hash>` | A stale vite SSR pre-bundle, never your code. Fixed for good by `environments.ssr.optimizeDeps` in `astro.config.mjs` — do not remove it. |
| `astro dev` errors going to nowhere | Astro 7 daemonises. Real errors are in `.astro/dev.log`; stdout only says "exited before becoming ready". |
| Testing a form POST with curl | Astro checks `Origin` and 403s without it. Send `-H "Origin: http://localhost:4321"`. Browsers send it automatically. |
| `Uint8Array` into WebCrypto | Since TS 5.7 it widens to `ArrayBufferLike`, which WebCrypto rejects. Annotate `Uint8Array<ArrayBuffer>`. |
| Serving images through the Worker | Turns a comfortable free tier into an overage. R2 custom domain only. |
| Prefix-matching Maharashtra pincodes | `403xxx` is **Goa**, inside the 400–445 range. Use the compiled list. |
| Assuming a bank emails UPI credits | RBI mandates SMS, only *permits* email. HDFC is the one confirmed bank. |

## Tone in user-facing copy

Plain, specific, and honest about limits. A shopkeeper reading an error should
learn what happened and what to do. No apologies, no marketing.
