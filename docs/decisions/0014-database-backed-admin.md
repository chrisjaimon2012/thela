# ADR-0014: Database-backed admin, not a git-based CMS

* Status: Accepted
* Date: 2026-08-12

## Context

The developer's preference is a git-push workflow: edit, push, site updates.
Applied to the catalogue, that means a git-based CMS (Sveltia, Decap, Pages CMS)
where a volunteer's edits become commits.

It is genuinely attractive — content is versioned, reviewable, and the deploy
pipeline is one you already trust. Sveltia in particular uploads media straight
to R2 rather than into the repository.

But stock cannot live in git. It has two writers: the volunteer adjusting counts
and the checkout decrementing them. A file has no atomic conditional update, so
concurrent writes silently lose — and the whole oversell guarantee (ADR-0008)
depends on a database constraint.

Splitting them — content in git, stock in D1 — is coherent but means two editing
surfaces, two mental models, and a volunteer who must know which is which.

## Decision

Products, prices, stock, orders and settings live in D1, edited through a small
admin UI behind Cloudflare Access.

Git carries code, theme, migrations and provider adapters. `git push` still
deploys the *shop*; it does not deploy the *catalogue*.

## Consequences

One editing surface for the shopkeeper, one source of truth, and correctness
guarantees that live in the schema.

The developer gives up git-push for content. Given that the alternative was two
systems and a subtle failure mode, this is the right trade — but it is a real
concession and worth naming as one.

Catalogue history is lost unless we add an audit trail later. D1's 7-day Time
Travel is a partial backstop for accidental deletion.
