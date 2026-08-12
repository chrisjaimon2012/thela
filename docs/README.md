# thela documentation

Start here.

## Orientation

| | |
|---|---|
| [architecture.md](architecture.md) | How the system fits together, the data model, and the free-tier budget |
| [engineering-guidelines.md](engineering-guidelines.md) | The standards this project is held to |
| [decisions/](decisions/) | Architecture Decision Records — the *why* behind everything |
| [flows/](flows/) | Sequence and state diagrams for the three flows that matter |
| [supported-banks.md](supported-banks.md) | Which banks automatic payment verification works with, and which it does not |
| [../NON-GOALS.md](../NON-GOALS.md) | What we have deliberately refused to build, and why |
| [../CLAUDE.md](../CLAUDE.md) | Operating instructions for an AI agent or new contributor |

## If you are here to…

**Understand the project in five minutes** — read the
[root README](../README.md), then [ADR-0003](decisions/0003-never-handle-funds.md).
Everything else follows from not touching money.

**Change payment code** — read
[flows/payment-verification.md](flows/payment-verification.md), then ADRs
[0006](decisions/0006-one-matcher-many-evidence-sources.md),
[0007](decisions/0007-unique-paise-slot.md),
[0009](decisions/0009-idempotency-on-reference-alone.md) and
[0010](decisions/0010-bank-trust-tiers.md). Two of the four will stop you
introducing a bug that looks like a fix.

**Change stock or checkout** — read
[ADR-0008](decisions/0008-unguarded-stock-reservation.md) first. The
reservation code is unguarded on purpose and the reason is not obvious.

**Add a bank** — [supported-banks.md](supported-banks.md), then
`src/lib/banks/parsers.json`. Bank profiles are data, not code, so they can be
fixed without a redeploy.

**Add a carrier** — [ADR-0013](decisions/0013-direct-carrier-over-aggregator.md)
and the port in `src/lib/shipping/types.ts`.

**Propose something we already rejected** — check
[NON-GOALS.md](../NON-GOALS.md) first. Several good ideas are in there with the
reason they lost; if you can beat the reason, open an issue.

## Conventions

Decisions are recorded as [ADRs](https://adr.github.io/) in Nygard format,
numbered sequentially, never edited once decided — superseded instead.

Diagrams are Mermaid, inline in Markdown, so they render on GitHub and stay in
the same commit as the change they describe.
