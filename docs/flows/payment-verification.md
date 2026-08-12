# Payment verification

The shop never touches money. Confirming a payment means observing evidence
that it landed in the merchant's own account, and matching that to an order.

See [ADR-0006](../decisions/0006-one-matcher-many-evidence-sources.md),
[ADR-0007](../decisions/0007-unique-paise-slot.md) and
[ADR-0010](../decisions/0010-bank-trust-tiers.md).

## The happy path — nothing for the customer to type

```mermaid
sequenceDiagram
  autonumber
  actor C as Shopper
  participant W as Worker
  participant B as Merchant's bank
  participant E as Email Worker
  participant D as D1

  C->>W: Checkout
  W->>D: INSERT order, try total + k paise
  Note over D: partial unique index on open orders<br/>guarantees the amount is unique
  W-->>C: Pay ₹1,399.37 — QR or upi:// intent
  C->>B: Pays the merchant's VPA directly
  B->>E: Credit alert email (DKIM-signed)
  E->>E: Verify DKIM d= against bank profile
  E->>D: resolve(evidence)
  D-->>E: unique open order at 1399.37
  E->>D: settle() — one batch
  Note over D: payment_event · stock consumed · order → paid
```

## What `resolve()` actually decides

```mermaid
flowchart TD
  ev[Evidence arrives] --> dup{reference<br/>already settled?}
  dup -->|yes| noop([duplicate — no-op])
  dup -->|no| find{open order at<br/>this exact amount?}
  find -->|no| unmatched([record unmatched<br/>never discard])
  find -->|yes| win{inside the<br/>time window?}
  win -->|no| unmatched
  win -->|yes| pol{may auto-settle?}
  pol -->|ledger or asserted| settle([settle])
  pol -->|alert from a verified bank<br/>and under the ceiling| settle
  pol -->|otherwise| review([queue for a human])

  classDef good stroke-width:2px
  class settle good
```

Deduplication is on the **reference alone**, not `(source, reference)` — the
same UTR seen by email today and in tomorrow's statement is the same money
([ADR-0009](../decisions/0009-idempotency-on-reference-alone.md)).

## The evidence ladder

A merchant turns on every channel their bank supports; the matcher deduplicates.

| Channel | Confidence | Latency | Coverage |
|---|---|---|---|
| Bank callback | `ledger` | seconds | needs corporate onboarding + a static IP |
| Statement upload | `ledger` | daily | universal |
| Alert email | `alert` | seconds | HDFC confirmed; patchy elsewhere |
| Customer UTR | `claimed` | instant | universal, never settles alone |
| Cash / manual | `asserted` | instant | universal |

A statement row outranks an alert email deliberately: an alert is a
notification about an attempt, a statement is the account's ledger. RBL was
documented sending 47 false "credited" alerts out of 54.
