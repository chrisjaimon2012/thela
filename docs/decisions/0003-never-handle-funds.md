# ADR-0003: Never handle funds

* Status: Accepted
* Date: 2026-08-12

## Context

Accepting payments in India normally means using a Payment Aggregator, which
charges a percentage for a rail that is free by law: UPI carries zero MDR under
PSS Act s.10A. An aggregator's fee is for software — checkout, verification,
reconciliation — not for the transaction.

The RBI (Regulation of Payment Aggregators) Directions, 2025
(RBI/DPSS/2025-26/141, 15 September 2025) define a PA **conjunctively** in
para 4(i): an entity that aggregates customer payments **and** "subsequently
settles the collected funds to such merchants". Para 4(j) separately defines a
Payment Gateway as technology infrastructure "without any involvement in
handling of funds", and para 3(a) applies the Directions only to entities
undertaking PA business — so a PG carries no operative obligations.

An RBI clarification reported 26 February 2026 goes further, stating that firms
offering only technical infrastructure are treated as technology service
providers rather than payment aggregators. *We have not located the underlying
circular number; treat the press reporting as supporting, not load-bearing.*

## Decision

The software will never receive, hold, pool, or settle funds. Customers pay the
merchant's own VPA directly. Our only role is to observe evidence that money
arrived and match it to an order.

No adapter may introduce a platform-controlled VPA, an escrow account, or a
settlement step. An adapter that would hold money does not belong in this repo.

## Consequences

We avoid the ₹15 crore minimum net worth, the Companies Act incorporation
requirement, escrow obligations, and PSS Act s.4 authorisation — none of which
a small open-source project could meet.

We also forgo everything an aggregator provides: instant confirmation as a
product guarantee, chargeback handling, and a support line. Verification
becomes our problem, which is the substance of ADR-0006 and ADR-0010.

This reasons from the operative text and is not legal advice. Anyone deploying
this commercially at scale should get an opinion.
