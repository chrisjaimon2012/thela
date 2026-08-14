# ADR-0021: Install by button, update by pull request

* Status: Accepted
* Date: 2026-08-12
* Corrects a supporting argument in [ADR-0019](0019-ship-an-app-not-an-integration.md); its decision stands

## Context

[ADR-0019](0019-ship-an-app-not-an-integration.md) chose to ship an app rather
than an npm package, and one of its supporting arguments was that GitHub's
"Sync fork" button covers upgrades for a vendor who never edits our files.

That argument was wrong about the install path we actually intend to use.
Cloudflare's "Deploy to Cloudflare" button **clones** the source repository into
a new one on the installer's account — from a single import commit, with no fork
relationship, therefore no Sync fork button, therefore no upgrade path at all for
a shop installed the way we most want shops to be installed. A security fix here
would never reach a running shop.

> **Correction, 2026-08-14, after watching the real flow.** This is true for
> somebody who does not own the repository, which is the case this ADR is about.
> It is *not* universal: when the installer owns the repository — a maintainer,
> or anybody who forked thela before deploying — the button connects Workers
> Builds directly to that repository and no copy is made. The decision below is
> unchanged, because the update channel has to serve the person who cloned; but
> the sentence "it clones, it does not fork" was stated more broadly than the
> evidence supported.
>
> The same session surfaced something this ADR missed entirely: the button
> pre-fills its **deploy command as `npx wrangler deploy`**, which bypasses
> `package.json` and therefore runs neither the migrations nor the ops Worker
> deploy. A shop installed with that default comes up against an empty database.
> The field is editable and must be changed to `npm run deploy`. See
> [docs/deploying.md](../deploying.md).

Verifying that turned up three more things about the button, all load-bearing:

**Our migrations never ran.** The `deploy` script was `astro build && wrangler
deploy`, and nothing applies `migrations_dir` on our behalf. Every button
install would have brought up a shop against a completely empty database. This
was not an edge case that needed a rename to trigger; it never worked.

**R2 requires a card.** R2's free tier is real — 10 GB, no egress charge — but
Cloudflare's own get-started page instructs you to "complete the checkout flow
to add an R2 subscription", and that means a payment method. We declared two
buckets, so a volunteer without an international card could not install thela
at all.

**The button is not reliable today.** [workers-sdk#14553](https://github.com/cloudflare/workers-sdk/issues/14553)
(open since 2026-07-04) reports the source import silently failing, leaving a
repo containing only a README and the wrangler config while the dashboard
reports success and the Worker sits on the Hello World placeholder.
[#15147](https://github.com/cloudflare/workers-sdk/issues/15147) reports a
`ZodError` aborting submission for accounts with Worker Previews enabled. Both
were open when this was written.

Queues, for the record, **is** on the free plan at 10,000 operations a day —
one of our own research passes claimed otherwise and was wrong.

## Decision

**The button is the primary install path, and a documented `git clone` is the
supported fallback.** Both are in the README, the fallback stated as a normal
option rather than a rescue, because the button has open bugs that fail
silently and a shopkeeper hitting one has no way to tell.

**Migrations run in a `predeploy` hook, referencing the binding.**

```json
"predeploy": "wrangler d1 migrations apply DB --remote",
"deploy": "astro build && wrangler deploy"
```

`DB`, not `thela`: the install page invites the user to rename the database, and
a name-based command breaks the moment they do. Workers Builds runs
`npm run deploy`, so npm fires `predeploy` first — the same mechanism
Cloudflare's own D1 template relies on.

**Updates arrive as a pull request.** The template ships a scheduled GitHub
Action that fetches upstream weekly and, when there is anything new, opens a PR
against the shop's own default branch. The owner reads a plain-language summary
and clicks Merge; Workers Builds deploys. It never pushes to the default branch
and never merges itself.

Merge conflicts are committed with their markers rather than failing the job,
so the PR shows precisely which files need a human instead of the run going red
with nothing to look at.

**R2 is not declared by default.** A default install has no object storage:
product images are absent rather than broken, and the logo degrades to the shop
name as text. `MEDIA` and `LABELS` are optional in `Cloudflare.Env` and every
use site must handle their absence. The admin explains the trade and links to
the checkout flow.

**`.env.example` contains only secrets a shopkeeper can answer on day one.**
Every key in that file becomes a prompt on the install page. It is now two:
`ADMIN_SETUP_TOKEN` and `SESSION_SECRET`. The carrier token, the email API key,
the from and reply-to addresses and the alert address all moved to the admin,
where they belong anyway — three of them were never secrets, and
`DELHIVERY_BASE` defaulted to the **staging** endpoint, so a shop could have
gone live pointing at staging and silently never dispatched anything.

## Consequences

A shop can be installed by someone who has never opened a terminal, and updated
by someone who can click a green button. That is the bar this project set
itself.

The update PR is better than Sync fork would have been, so ADR-0019's decision
survives its broken argument. A PR carries a changelog, can be read before it is
applied, and can sit unmerged indefinitely without drift — none of which is true
of a fork sync. It also works for the clone-installed majority, which Sync fork
never would have.

We now own an update channel. If the Action breaks, or upstream restructures in
a way that conflicts with every install, shops stop receiving fixes and we will
not hear about it. That is a real operational commitment and it should be
tested against a real clone before the first release.

A default install has no product images, which is a strange-sounding thing for
a shop. It is the honest trade: an installable shop with no photographs beats an
uninstallable one, and adding R2 later costs a paste and a redeploy.

The button's open bugs are Cloudflare's, not ours, and we cannot fix them. We
can only make the fallback visible and stop treating a green dashboard as proof
the install worked. Before announcing the button as the install path, someone
must run it end to end on a genuinely fresh, card-less account.
