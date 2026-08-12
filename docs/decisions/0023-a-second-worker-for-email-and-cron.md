# ADR-0023: A second Worker for email and cron

* Status: Accepted
* Date: 2026-08-13

## Context

thela's payment confirmation depends on Cloudflare Email Routing delivering the
merchant's bank alerts to an `email` handler, and its stock hygiene depends on
`scheduled` handlers releasing orders nobody paid for.

Neither can be attached to the storefront. The Astro Cloudflare adapter builds
its Worker entry from a virtual module, and that module is:

```js
import * as mod from "<user entry>";
export * from "<user entry>";
export default mod.default ?? {};
```

The adapter supplies the user entry, and it is `{ fetch: handle }`. `export *`
re-exports named bindings such as Durable Object classes, but `email` and
`scheduled` must sit on the **default export object**, which the adapter owns.
There is no configuration hook and no supported override; the only ways in are
a post-build rewrite of generated code, or a second Worker.

The adapter exposes `auxiliaryWorkers`, which is the supported answer.

## Decision

**A second Worker, `thela-ops`, carries every handler that is not a page
request.** It lives in `workers/ops/`, has its own `wrangler.jsonc`, and is
declared through the adapter's `auxiliaryWorkers` option. `npm run deploy`
deploys both, the ops Worker from its build-output config rather than its source
one, because the adapter rewrites `main` to the bundled entry.

**Both Workers bind the same D1.** One database, one truth. `database_id` in
`workers/ops/wrangler.jsonc` must be the same id the storefront uses; getting
that wrong is quiet and expensive, because payments would confirm against an
empty database while the shop sat waiting.

**The ops Worker has `workers_dev: false` and no routes.** It answers no HTTP
request at all, so a public hostname would be an attack surface with nothing
behind it. Its bindings are the smallest set that does the job: the database,
and the address a copy of each bank alert is forwarded to. It cannot serve a
page, read a session, or reach R2.

**The `email` handler never throws.** A thrown handler makes Email Routing retry
and eventually bounce, and a bounced bank alert is gone — there is no second
copy and no way to ask the bank to resend. Anything unparseable is quarantined
in the database, where the watchdog counts it.

## Consequences

The separation is worth having for its own sake, not only as a workaround. The
two halves have the most different change rates in the system — storefront
templates move weekly, bank parsing moves when a bank rewrites an email — and
they now fail independently. A storefront deploy cannot break payment ingest.

The ops Worker is 37 KB gzipped against the storefront's 158 KB, so it cold
starts in a fraction of the time. That matters for `email`, which has no user
waiting but does have a bank's SMTP timeout.

**It complicates the install.** ADR-0021 made the Deploy to Cloudflare button
the primary path, and that button reads one wrangler configuration. Whether it
can provision an auxiliary Worker is unverified and should be tested on a real
account before the first release. If it cannot, the fallback is honest and
usable: the button installs the storefront, and the ops Worker becomes a
documented second step a shop takes when it wants payments confirmed
automatically. **Manual and statement verification both work without it**, so a
shop is never blocked — only doing more by hand than it needs to.

Two Workers is one more thing to deploy, one more place for a stale
`database_id`, and one more set of secrets. The deploy script hides the first;
the other two are documented in `workers/ops/wrangler.jsonc` at the point of
use, because that is where someone will be looking when it matters.

The watchdog currently writes its alarms to the Workers log rather than emailing
anyone, because the notification seam does not exist yet. That is a visible gap
rather than a silent one: the counts are correct and nobody is being told. It
closes when the `EmailProvider` seam lands.
