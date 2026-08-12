# ADR-0008: Reserve stock unguarded, against a CHECK constraint

* Status: Accepted
* Date: 2026-08-12

## Context

D1 has no interactive transactions. Atomicity comes only from `batch()`, which
Cloudflare documents as rolling back the entire sequence **if a statement
returns an error**.

The intuitive way to prevent overselling is a guarded conditional update:

```sql
UPDATE stock SET reserved = reserved + ?2
 WHERE sku = ?1 AND reserved + ?2 <= on_hand;   -- WRONG
```

In SQLite an `UPDATE` matching zero rows **is not an error**. It succeeds with
`changes() = 0`. So `batch()` commits everything else, and a three-line order
whose second line is out of stock silently drops that line while charging for
it. `RAISE(ABORT, …)` cannot help either — SQLite only permits `RAISE` inside a
trigger body.

## Decision

Reserve **unguarded**, and let a constraint raise:

```sql
-- schema
CHECK (tracked = 0 OR reserved <= on_hand)

-- statement, deliberately without a WHERE guard on quantity
UPDATE stock SET reserved = reserved + ?2 WHERE sku = ?1;
```

Insufficiency becomes `SQLITE_CONSTRAINT`, which aborts the batch and rolls back
the order insert with it.

## Consequences

Overselling is structurally impossible rather than conventionally avoided, and
the guarantee survives any future code path that touches stock.

The code looks wrong to a reader who does not know the SQLite semantics, so it
carries a long inline comment and an executable proof in
`tests/invariants.test.sql`.

Because the mechanism is the constraint, the SKU must be derived server-side and
validated against known values: an unknown SKU matches zero rows and would
silently succeed.
