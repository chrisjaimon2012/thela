# ADR-0019: Ship an app you deploy, not a package you install

* Status: Accepted
* Date: 2026-08-12

## Context

[EmDash](https://github.com/emdash-cms/emdash) is a CMS on very nearly our
stack: Astro, Cloudflare D1 + R2 + Workers, MIT, server-rendered, "runs
anywhere". It reached 11.6k stars in four months. It is distributed as an Astro
integration:

```ts
integrations: [emdash({ database: d1() })]
```

That is a different shape from ours, and it is worth being deliberate about why,
because the two shapes push a project in different directions and the cost of
switching rises with every route we write.

An integration composes. A vendor could run EmDash for content and thela for
commerce in one Worker, bring their own Astro theme, and upgrade with
`npm update`. A contributor in Lyon could publish `@thela/carrier-colissimo`
without asking us to merge anything.

An app is simpler. One repo, one version, one test run, no published API
surface, no semver discipline, and no gap between what the package does and
what the vendor's site does.

Two things decided it.

**The upgrade argument is weaker than it looks for us specifically.** The usual
case against forking is that upgrades become `git merge` and non-technical
owners never do them, so their shop freezes at the commit they forked —
security fixes included. That is true when customisation means editing code. We
have deliberately built so that customisation is *data*: shop name, currency and
exponent, locale, tax label, allowed countries, option axis names, and
(per [ADR-0020](0020-customization-surface.md)) branding and theme all live in
the `setting` table. A vendor who never edits our files can use GitHub's "sync
fork" button and it merges cleanly. The integration wins here only for vendors
who *do* edit code, and those are the vendors who can handle a merge.

**Converting later is not a rewrite.** Moving `src/pages/*` into a package that
calls `injectRoute()` is mechanical. The genuinely expensive part is deciding
what the public API is, and that cost is identical whenever it is paid — except
that later we will know what the seams actually are, because we will have built
against them. Doing it now means designing a public API for an admin panel that
does not exist yet.

The one real cost of waiting is contributors. A package ecosystem recruits a
carrier adapter from someone in Kenya better than a PR queue does. That cost is
zero until there is a second contributor.

## Decision

**thela ships as an application you deploy, not a package you install.** One
repo. The primary install path is Cloudflare's "Deploy to Cloudflare" button,
followed by configuration in the admin — not a fork, and not a terminal.

**We pay the discipline that keeps conversion cheap.** Specifically, and these
are enforced in review:

* Pages and endpoints under `src/pages/` are thin. They read input, call one
  function in `src/lib/`, and render. No SQL, no business rule, no branching on
  shop configuration.
* Every outside system — carrier, payment evidence source, email — sits behind
  an explicit TypeScript interface in `src/lib/`, with the concrete
  implementation selected by a setting. A new country's carrier is a new file
  implementing an existing interface, never an edit to a call site.
* Nothing about the shop is hardcoded in a template. If a Lyon studio would need
  it different, it is a setting.

**We revisit when either trigger fires**, and not before:

1. A second person wants to contribute a carrier or payment adapter. The package
   model is how we accept that contribution without owning it forever.
2. Someone wants a real CMS on the same Worker. Composing with EmDash requires
   both to be integrations.

## Consequences

Install stays a button click and a settings form. That is the whole reason a
church volunteer can run this, and it is worth more than composability we have
no user for yet.

We are the bottleneck for adapters. Every carrier and every bank parser arrives
as a PR we review and then maintain. That is fine at three adapters and painful
at thirty; trigger (1) exists to catch it before thirty.

thela cannot drop into an existing Astro site, and cannot share a Worker with
EmDash. A vendor wanting both today runs two Workers.

The discipline above is not optional bookkeeping — it is the thing that makes
the decision reversible. If pages start containing logic, we lose the option
quietly and only discover it when we try to exercise it.

We are betting that "customisation is data, not code" holds as the admin grows.
If it stops holding — if real vendors routinely edit templates — then the
sync-fork upgrade path breaks, the main argument here collapses, and we should
convert regardless of the two triggers.
