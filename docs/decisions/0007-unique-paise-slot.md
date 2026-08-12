# ADR-0007: Identify orders by a unique paise slot

* Status: Accepted
* Date: 2026-08-12

## Context

Bank credit alerts and statement rows carry no order reference. The bank knows
only what UPI told it: amount, payer VPA, UTR and timestamp. A UUID of our own
is useless because the bank will never echo it back.

Asking the customer to type the 12-digit UTR works but adds a step, and a
meaningful fraction of shoppers will mistype or not find it.

NPCI's UPI Linking Specification does allow a note (`tn`) in an intent link, and
some banks surface it in the credit narration — but apps may strip or let the
payer edit it, and it is unreliable on a static QR.

## Decision

Each order awaiting payment is assigned a **unique 0–99 paise suffix**, so the
amount itself identifies the order. A credit of exactly ₹1,399.37 unambiguously
resolves to one order, with nothing for the customer to type.

Uniqueness is enforced by the database, not by application code:

```sql
CREATE UNIQUE INDEX orders_open_amount
  ON orders(amount_due_paise) WHERE status = 'awaiting_payment';
```

Allocation is therefore "try `total + k` for k in 0..99 and take the first
`INSERT` that wins" — no slot table, no locking, correct under concurrency.

## Consequences

Checkout requires no customer input beyond paying the prefilled amount, and no
bank cooperation whatsoever.

A slot is held only while an order awaits payment and is released on settlement
or expiry, so the practical collision ceiling is ~100 *concurrent open orders at
the same price*, which is far beyond the target scale.

The costs: prices become odd (₹1,399.37), which needs a line of explanation at
checkout; and a customer who helpfully rounds to ₹1,400 falls through to the UTR
fallback. Both are acceptable, and both disappear if a bank is ever found whose
narration reliably carries the `tn` note — at which point this becomes the
fallback rather than the mechanism.
