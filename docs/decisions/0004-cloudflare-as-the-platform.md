# ADR-0004: Build on Cloudflare Workers, D1 and R2

* Status: Accepted
* Date: 2026-08-12

## Context

The project promises a shop that costs nothing to run. That requires a platform
with a genuinely durable free tier, not a trial.

Every free always-on *server* host was assessed and disqualified during 2026:
Oracle Always Free halved its Ampere allowance without announcement and began
terminating over-limit instances; Render's free services sleep with a ~60s cold
start and its free Postgres self-destructs after 30 days; Fly and Koyeb closed
their free tiers; Neon's 100 CU-hours cannot cover a 730-hour month and its
5-minute suspend cannot be disabled; Supabase Free has no backups or PITR.

Cloudflare's free tier is different in kind: 100,000 Worker requests/day,
**free and unlimited static asset requests**, D1 at 5M row reads/day, R2 at
10 GB with zero egress, Queues, Workflows, Cron Triggers, and Access for 50
users. Workers Builds gives git-push deploys on the free plan.

## Decision

We will build on Cloudflare: Workers for compute, D1 as the ledger, R2 for
images and labels, Workflows for the dispatch saga, Cron for reconciliation,
and Access for admin authentication.

**D1 is the source of truth. Workflows is only an executor** — free-plan
workflow state is retained three days, so no order fact may live solely inside
a workflow instance.

## Consequences

A shop costs ₹0 to run beyond the domain, which is the entire premise.

We accept D1's constraints: no interactive transactions (only `batch()`), 500 MB
per database on the free plan, and rows *scanned* rather than returned being the
billing unit — so every `WHERE` and `ORDER BY` column needs an index.

We accept that no bank webhook can terminate here: banks require a whitelisted
static IP for callbacks, and Workers have no stable egress IP. That is a real
ceiling and is why the evidence ladder exists.

Cloudflare's free tier is a business decision they can revise. The mitigation is
that the migration path is real — standard SQLite-shaped SQL, S3-compatible
object storage — and the fallback is $5/month, not a rewrite.
