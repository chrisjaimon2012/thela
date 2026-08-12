# Architecture decisions

Decisions are recorded as [ADRs](https://adr.github.io/), in Michael Nygard's
format. Copy [0000-template.md](0000-template.md), take the next number, and
open it with the change it justifies.

**Never edit a decided ADR.** If a decision changes, write a new one and mark
the old `Superseded by ADR-XXXX`. The value is the trail, not the tidiness.

| # | Decision | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-single-tenant-self-hosted.md) | Ship single-tenant and self-hosted | Accepted |
| [0003](0003-never-handle-funds.md) | Never handle funds | Accepted |
| [0004](0004-cloudflare-as-the-platform.md) | Build on Cloudflare Workers, D1 and R2 | Accepted |
| [0005](0005-astro-over-nextjs.md) | Use Astro rather than Next.js | Accepted |
| [0006](0006-one-matcher-many-evidence-sources.md) | One matcher, many evidence sources | Accepted |
| [0007](0007-unique-paise-slot.md) | Identify orders by a unique paise slot | Accepted |
| [0008](0008-unguarded-stock-reservation.md) | Reserve stock unguarded, against a CHECK | Accepted |
| [0009](0009-idempotency-on-reference-alone.md) | Key idempotency on the payment reference alone | Accepted |
| [0010](0010-bank-trust-tiers.md) | Rank evidence by confidence, and gate auto-settlement | Accepted |
| [0011](0011-prepaid-only.md) | Prepaid only — no cash on delivery | Accepted |
| [0012](0012-reject-sms-forwarding.md) | Reject SMS forwarding as a channel | Accepted |
| [0013](0013-direct-carrier-over-aggregator.md) | Integrate a carrier directly, not an aggregator | Accepted |
| [0014](0014-database-backed-admin.md) | Database-backed admin, not a git-based CMS | Accepted |
| [0015](0015-apache-2-licence.md) | Licence under Apache-2.0 | Accepted |
| [0016](0016-generic-catalogue-model.md) | A generic catalogue — named option axes, stock decoupled from variants | Accepted |
| [0017](0017-global-first-india-first.md) | Global by construction, India first by sequence | Accepted |
| [0018](0018-verification-first-payments.md) | Verify payments rather than process them | Accepted |
| [0019](0019-ship-an-app-not-an-integration.md) | Ship an app you deploy, not a package you install | Accepted |
| [0020](0020-customization-surface.md) | One accent, computed contrast — what earns a setting | Proposed |
| [0021](0021-install-by-button-update-by-pull-request.md) | Install by button, update by pull request | Accepted |
| [0022](0022-passkeys-because-a-password-costs-too-much-cpu.md) | Passkeys for the admin — a password costs too much CPU | Accepted |
| [0023](0023-a-second-worker-for-email-and-cron.md) | A second Worker for email and cron | Accepted |
