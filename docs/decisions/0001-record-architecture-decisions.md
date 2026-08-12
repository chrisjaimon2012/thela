# ADR-0001: Record architecture decisions

* Status: Accepted
* Date: 2026-08-12

## Context

This project's design was settled over a long exploration in which several
conclusions reversed — open source, then free-tier-only, then buy-not-build,
then build-as-open-source. Each reversal was correct given what was known at
the time, but the *reasoning* is what has value, and conversation history is
not a durable artefact.

Several decisions here also look wrong at a glance and are deliberate. Without
a record, a future contributor will "fix" them into bugs.

## Decision

We will record architecturally significant decisions as ADRs in
[Nygard format](https://adr.github.io/), numbered sequentially, in
`docs/decisions/`.

A decision is architecturally significant if reversing it would be expensive,
if it constrains what the project may do later, or if the resulting code looks
surprising without the reasoning.

We will also record decisions *not* to do things, in `NON-GOALS.md`.

## Consequences

Every substantive change carries a small documentation cost. In exchange, a
new contributor can discover why something is the way it is without asking, and
an agent working in this repo has the context that would otherwise be lost to
compaction.

ADRs are immutable once decided. Superseding one costs a new file, which is
deliberate friction — it makes reversals visible.
