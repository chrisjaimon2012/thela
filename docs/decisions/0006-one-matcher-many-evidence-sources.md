# ADR-0006: One matcher, many evidence sources

* Status: Accepted
* Date: 2026-08-12

## Context

Because we never handle funds (ADR-0003), confirming a payment means observing
it out-of-band. Several channels can do that, and each has different latency,
coverage and trustworthiness: a bank alert email, a row in an uploaded bank
statement, a customer typing their UTR, a volunteer taking cash, and — for
merchants who can obtain one — a bank callback.

The obvious implementation is one verification path per channel. That produces
five subsystems that each decide what "paid" means, and five places to get
idempotency wrong.

## Decision

Every channel is a thin **source** that produces one `Evidence` record —
`{ source, confidence, reference, amountPaise, at, … }` — and calls one
`resolve()` function. Settlement happens in exactly one place, `settle()`, as a
single D1 `batch()`.

Adding a source must never add a matching path. If a new source appears to need
its own branch inside `resolve()`, the model is wrong.

## Consequences

The order lifecycle is identical regardless of how a payment was established: a
volunteer confirming cash and an automatic email match write the same
`payment_event` row.

New channels are cheap — a bank callback adapter is a file in `sources/`, not a
redesign.

Deduplication across channels is automatic, because idempotency lives in one
place (ADR-0009). The same UTR seen by email today and in tomorrow's statement
settles once.

The cost is one indirection: reading the email source alone does not tell you
what happens next. That is what `resolve()` is for, and it is documented there.
