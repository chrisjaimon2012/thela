-- Executable proof of the three schema invariants the design rests on.
--
--   sqlite3 :memory: '.read migrations/0001_init.sql' '.read migrations/invariants.test.sql'
--
-- Each block prints PASS or FAIL. These are constraints, not conventions —
-- if one of them stops holding, the failure mode is silent and expensive.

.bail off
.echo off

INSERT INTO stock (sku, label, on_hand, tracked) VALUES ('blank:s:black', 'S Black', 1, 1);
INSERT INTO stock (sku, label, on_hand, tracked) VALUES ('made:to:order', 'MTO',     0, 0);

--------------------------------------------------------------------------------
-- 1. Oversell must ABORT, not partially commit.
--
-- The tempting "safe" version is a guarded update:
--     UPDATE stock SET reserved = reserved + 2 WHERE sku=? AND reserved + 2 <= on_hand
-- which matches zero rows, succeeds, and lets the rest of the order commit.
-- We rely on CHECK (tracked = 0 OR reserved <= on_hand) raising instead.
--------------------------------------------------------------------------------
SELECT '--- 1. oversell aborts ---';

BEGIN;
UPDATE stock SET reserved = reserved + 2 WHERE sku = 'blank:s:black';
COMMIT;

SELECT CASE WHEN reserved = 0
            THEN 'PASS  oversell rejected, reservation untouched'
            ELSE 'FAIL  reserved=' || reserved || ' (oversell was allowed)' END
FROM stock WHERE sku = 'blank:s:black';

-- An exact-fit reservation must still succeed.
UPDATE stock SET reserved = reserved + 1 WHERE sku = 'blank:s:black';
SELECT CASE WHEN reserved = 1 THEN 'PASS  exact-fit reservation allowed'
                              ELSE 'FAIL  exact fit rejected' END
FROM stock WHERE sku = 'blank:s:black';

-- Untracked (made-to-order) rows must never be constrained by on_hand.
UPDATE stock SET reserved = reserved + 99 WHERE sku = 'made:to:order';
SELECT CASE WHEN reserved = 99 THEN 'PASS  untracked sku ignores stock ceiling'
                               ELSE 'FAIL  untracked sku was constrained' END
FROM stock WHERE sku = 'made:to:order';

--------------------------------------------------------------------------------
-- 2. Two OPEN orders may not claim the same amount.
--
-- This is what makes the paise slot a reliable identifier, and it is why
-- allocation can be "try total+k, take the first insert that wins" with no
-- application-level locking.
--------------------------------------------------------------------------------
SELECT '--- 2. paise slot uniqueness ---';

INSERT INTO orders (id, subtotal_paise, amount_due_paise, customer_name,
                    customer_email, customer_phone, fulfilment, expires_at)
VALUES ('O1', 139900, 139937, 'A', 'a@x.com', '9000000000', 'pickup', datetime('now','+1 hour'));

INSERT INTO orders (id, subtotal_paise, amount_due_paise, customer_name,
                    customer_email, customer_phone, fulfilment, expires_at)
VALUES ('O2', 139900, 139937, 'B', 'b@x.com', '9000000001', 'pickup', datetime('now','+1 hour'));

SELECT CASE WHEN count(*) = 1 THEN 'PASS  duplicate open amount rejected'
                              ELSE 'FAIL  ' || count(*) || ' open orders share an amount' END
FROM orders WHERE amount_due_paise = 139937 AND status = 'awaiting_payment';

-- Once an order leaves the awaiting-payment state its slot is reusable.
UPDATE orders SET status = 'paid' WHERE id = 'O1';
INSERT INTO orders (id, subtotal_paise, amount_due_paise, customer_name,
                    customer_email, customer_phone, fulfilment, expires_at)
VALUES ('O3', 139900, 139937, 'C', 'c@x.com', '9000000002', 'pickup', datetime('now','+1 hour'));

SELECT CASE WHEN count(*) = 1 THEN 'PASS  slot reusable once the order settles'
                              ELSE 'FAIL  slot not released' END
FROM orders WHERE id = 'O3';

--------------------------------------------------------------------------------
-- 3. A carrier order cannot exist without somewhere to ship it,
--    and a pickup order is not forced to invent an address.
--------------------------------------------------------------------------------
SELECT '--- 3. fulfilment / address coherence ---';

INSERT INTO orders (id, subtotal_paise, amount_due_paise, customer_name,
                    customer_email, customer_phone, fulfilment, expires_at)
VALUES ('O4', 100000, 100001, 'D', 'd@x.com', '9000000003', 'carrier', datetime('now','+1 hour'));

SELECT CASE WHEN count(*) = 0 THEN 'PASS  carrier order without address rejected'
                              ELSE 'FAIL  shippable order has no address' END
FROM orders WHERE id = 'O4';

--------------------------------------------------------------------------------
-- 4. One UTR settles exactly one order, whatever source reported it.
--    Email today and tomorrow's statement are the same money.
--------------------------------------------------------------------------------
SELECT '--- 4. reference idempotency across sources ---';

INSERT INTO payment_event (order_id, source, confidence, reference, amount_paise)
VALUES ('O3', 'email', 'alert', '402312345678', 139937);

INSERT INTO payment_event (order_id, source, confidence, reference, amount_paise)
VALUES ('O3', 'statement', 'ledger', '402312345678', 139937);

SELECT CASE WHEN count(*) = 1 THEN 'PASS  same UTR from a second source is a no-op'
                              ELSE 'FAIL  ' || count(*) || ' events for one UTR' END
FROM payment_event WHERE reference = '402312345678';
