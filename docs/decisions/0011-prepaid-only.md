# ADR-0011: Prepaid only — no cash on delivery

* Status: Accepted
* Date: 2026-08-12

## Context

COD is a large share of Indian e-commerce and the obvious thing to support.

It is also the single largest source of complexity and loss. Industry data for
FY25 puts COD return-to-origin at ~26% against under 2% for prepaid, and the
₹500–1,000 order band — exactly where a small shop lives — is the worst at 28%.
On an RTO the seller pays forward freight *and* return freight, both billed on
volumetric weight. Fragile goods often come back unsellable, and carrier damage
cover excludes glass entirely.

Supporting it also requires OTP verification, RTO and NDR workflows,
QC-on-return, a receivable ledger, and reconciliation against a remittance
report delivered as a scheduled CSV, because no aggregator exposes a remittance
API.

## Decision

Prepaid only. We will not implement COD.

## Consequences

Roughly half the payment subsystem disappears: no receivable ledger, no
remittance reconciler, no dual refund rails, no RTO state machine. The order
lifecycle collapses to something a volunteer can understand.

Prepaid RTO under 2% also removes most of the argument for a courier
aggregator, which feeds ADR-0013.

We lose the customers who will only pay on delivery. For a church selling
largely to its own congregation that is socially viable; for a general shop it
is a real constraint, and one a future maintainer may reasonably revisit — but
only with the full cost above in view.
