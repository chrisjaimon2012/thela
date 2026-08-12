# ADR-0009: Key idempotency on the payment reference alone

* Status: Accepted
* Date: 2026-08-12

## Context

The obvious idempotency key for a payment event is `(source, reference)` — it
scopes each channel's replays to itself and is what most systems do.

It is wrong here. Because multiple channels observe the same account
(ADR-0006), the *same real payment* legitimately arrives twice: a bank alert
email today, and the same UTR again in tomorrow's uploaded statement. Under
`(source, reference)` both would insert, stock would decrement twice, and the
order would settle twice.

## Decision

`payment_event.reference` is `NOT NULL UNIQUE` on its own.

Sources without a natural reference synthesise a stable one — cash taken at the
counter records `cash:<orderId>` — so the constraint holds universally.

The idempotency insert is the **first** statement in the settlement batch, so a
replay violates the constraint and aborts everything after it before any stock
moves.

## Consequences

A merchant can safely enable every channel their bank supports and let the
matcher deduplicate. That is what makes the ladder in ADR-0010 usable rather
than dangerous.

The constraint is global, which means two genuinely distinct payments must never
share a reference. UTRs are minted by NPCI and unique, so this holds for real
payments; synthesised references must be constructed carefully.
