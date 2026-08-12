-- Executable proof of the schema invariants the design rests on.
--
--   sqlite3 :memory: '.read migrations/0001_init.sql' '.read tests/invariants.test.sql'
--
-- Each assertion prints PASS or FAIL. These are constraints, not conventions —
-- if one of them stops holding, the failure mode is silent and expensive.
--
-- npm run test:invariants greps the output for FAIL and exits non-zero.

.bail off
.echo off

INSERT INTO stock_item (sku, label, on_hand, tracked) VALUES ('blank:s:black', 'S Black', 1, 1);
INSERT INTO stock_item (sku, label, on_hand, tracked) VALUES ('made:to:order', 'MTO',     0, 0);

--------------------------------------------------------------------------------
-- 1. Oversell must ABORT, not partially commit.
--
-- The tempting "safe" version is a guarded update:
--     UPDATE stock_item SET reserved = reserved + 2
--      WHERE sku = ? AND reserved + 2 <= on_hand
-- which matches zero rows, SUCCEEDS, and lets the rest of the order commit.
-- D1's batch() rolls back on a statement error but not on zero rows affected,
-- so the guard has to be a CHECK that raises: (tracked = 0 OR reserved <= on_hand).
--------------------------------------------------------------------------------
SELECT '--- 1. oversell aborts ---';

BEGIN;
UPDATE stock_item SET reserved = reserved + 2 WHERE sku = 'blank:s:black';
COMMIT;

SELECT CASE WHEN reserved = 0
            THEN 'PASS  oversell rejected, reservation untouched'
            ELSE 'FAIL  reserved=' || reserved || ' (oversell was allowed)' END
FROM stock_item WHERE sku = 'blank:s:black';

-- An exact-fit reservation must still succeed.
UPDATE stock_item SET reserved = reserved + 1 WHERE sku = 'blank:s:black';
SELECT CASE WHEN reserved = 1 THEN 'PASS  exact-fit reservation allowed'
                              ELSE 'FAIL  exact fit rejected' END
FROM stock_item WHERE sku = 'blank:s:black';

-- Untracked (made-to-order) rows must never be constrained by on_hand.
UPDATE stock_item SET reserved = reserved + 99 WHERE sku = 'made:to:order';
SELECT CASE WHEN reserved = 99 THEN 'PASS  untracked sku ignores stock ceiling'
                               ELSE 'FAIL  untracked sku was constrained' END
FROM stock_item WHERE sku = 'made:to:order';

--------------------------------------------------------------------------------
-- 2. Two OPEN orders in one currency may not claim the same amount.
--
-- This is what makes the minor-unit slot a reliable identifier, and it is why
-- allocation can be "try total+k, take the first insert that wins" with no
-- application-level locking.
--------------------------------------------------------------------------------
SELECT '--- 2. minor-unit slot uniqueness ---';

INSERT INTO orders (id, currency, subtotal_minor, amount_due_minor, customer_name,
                    customer_email, customer_phone, fulfilment, expires_at)
VALUES ('O1', 'INR', 139900, 139937, 'A', 'a@x.com', '9000000000', 'pickup', datetime('now','+1 hour'));

INSERT INTO orders (id, currency, subtotal_minor, amount_due_minor, customer_name,
                    customer_email, customer_phone, fulfilment, expires_at)
VALUES ('O2', 'INR', 139900, 139937, 'B', 'b@x.com', '9000000001', 'pickup', datetime('now','+1 hour'));

SELECT CASE WHEN count(*) = 1 THEN 'PASS  duplicate open amount rejected'
                              ELSE 'FAIL  ' || count(*) || ' open orders share an amount' END
FROM orders WHERE currency = 'INR' AND amount_due_minor = 139937 AND status = 'awaiting_payment';

-- Once an order leaves the awaiting-payment state its slot is reusable.
UPDATE orders SET status = 'paid' WHERE id = 'O1';
INSERT INTO orders (id, currency, subtotal_minor, amount_due_minor, customer_name,
                    customer_email, customer_phone, fulfilment, expires_at)
VALUES ('O3', 'INR', 139900, 139937, 'C', 'c@x.com', '9000000002', 'pickup', datetime('now','+1 hour'));

SELECT CASE WHEN count(*) = 1 THEN 'PASS  slot reusable once the order settles'
                              ELSE 'FAIL  slot not released' END
FROM orders WHERE id = 'O3';

-- The slot is scoped to a currency. 1399.37 EUR and 1399.37 INR are different
-- money and different rows in a statement; only 100 slots per currency exist,
-- and a shop trading in two must not lose half of them (ADR-0017).
INSERT INTO orders (id, currency, subtotal_minor, amount_due_minor, customer_name,
                    customer_email, customer_phone, fulfilment, expires_at)
VALUES ('O3e', 'EUR', 139900, 139937, 'C', 'c@x.com', NULL, 'pickup', datetime('now','+1 hour'));

SELECT CASE WHEN count(*) = 1 THEN 'PASS  same amount in another currency is a distinct slot'
                              ELSE 'FAIL  slot uniqueness is not currency-scoped' END
FROM orders WHERE id = 'O3e';

--------------------------------------------------------------------------------
-- 3. A carrier order cannot exist without somewhere to ship it, and a pickup
--    or digital order is not forced to invent an address.
--------------------------------------------------------------------------------
SELECT '--- 3. fulfilment / address coherence ---';

INSERT INTO orders (id, currency, subtotal_minor, amount_due_minor, customer_name,
                    customer_email, customer_phone, fulfilment, expires_at)
VALUES ('O4', 'INR', 100000, 100001, 'D', 'd@x.com', '9000000003', 'carrier', datetime('now','+1 hour'));

SELECT CASE WHEN count(*) = 0 THEN 'PASS  carrier order without address rejected'
                              ELSE 'FAIL  shippable order has no address' END
FROM orders WHERE id = 'O4';

-- The address requirement is postal_code + country, not a pincode: a French
-- order carries no region at all and must still be accepted.
INSERT INTO orders (id, currency, subtotal_minor, amount_due_minor, customer_name,
                    customer_email, fulfilment, ship_line1, ship_city,
                    ship_postal_code, ship_country, expires_at)
VALUES ('O5', 'EUR', 3200, 3201, 'E', 'e@x.fr', 'carrier',
        '12 rue Burdeau', 'Lyon', '69001', 'FR', datetime('now','+1 hour'));

SELECT CASE WHEN count(*) = 1 THEN 'PASS  non-Indian address shape accepted'
                              ELSE 'FAIL  address check assumes an Indian shape' END
FROM orders WHERE id = 'O5';

-- A digital order has no address and no parcel, and must not be blocked.
INSERT INTO orders (id, currency, subtotal_minor, amount_due_minor, customer_name,
                    customer_email, fulfilment, expires_at)
VALUES ('O6', 'EUR', 900, 901, 'F', 'f@x.fr', 'digital', datetime('now','+1 hour'));

SELECT CASE WHEN count(*) = 1 THEN 'PASS  digital order needs no address'
                              ELSE 'FAIL  digital fulfilment demands an address' END
FROM orders WHERE id = 'O6';

--------------------------------------------------------------------------------
-- 4. One bank reference settles exactly one order, whatever source reported it.
--    Today's credit alert and tomorrow's statement row are the same money.
--------------------------------------------------------------------------------
SELECT '--- 4. reference idempotency across sources ---';

INSERT INTO payment_event (order_id, source, confidence, reference, amount_minor)
VALUES ('O3', 'email', 'alert', '402312345678', 139937);

INSERT INTO payment_event (order_id, source, confidence, reference, amount_minor)
VALUES ('O3', 'statement', 'ledger', '402312345678', 139937);

SELECT CASE WHEN count(*) = 1 THEN 'PASS  same reference from a second source is a no-op'
                              ELSE 'FAIL  ' || count(*) || ' events for one reference' END
FROM payment_event WHERE reference = '402312345678';

--------------------------------------------------------------------------------
-- 5. A variant is identified by its combination of option values, and the
--    vendor decides what those axes mean (ADR-0016). Two variants of one
--    product may not occupy the same cell of that grid.
--------------------------------------------------------------------------------
SELECT '--- 5. variant option-grid uniqueness ---';

INSERT INTO product (id, slug, title, status) VALUES ('P1', 'p1', 'P1', 'active');
INSERT INTO product_option (product_id, position, name) VALUES ('P1', 1, 'Size'), ('P1', 2, 'Frame');

INSERT INTO variant (id, product_id, sku, option_1, option_2, price_minor)
VALUES ('V1', 'P1', 'blank:s:black', 'Small', 'Black', 89900);

INSERT INTO variant (id, product_id, sku, option_1, option_2, price_minor)
VALUES ('V2', 'P1', 'made:to:order', 'Small', 'Black', 99900);

SELECT CASE WHEN count(*) = 1 THEN 'PASS  duplicate option combination rejected'
                              ELSE 'FAIL  ' || count(*) || ' variants share one grid cell' END
FROM variant WHERE product_id = 'P1' AND option_1 = 'Small' AND option_2 = 'Black';

-- A third axis is optional, and adding one does not collide with the two-axis
-- rows that came before it.
INSERT INTO variant (id, product_id, sku, option_1, option_2, option_3, price_minor)
VALUES ('V3', 'P1', 'made:to:order', 'Small', 'Black', 'Glazed', 109900);

SELECT CASE WHEN count(*) = 1 THEN 'PASS  a third axis distinguishes an otherwise-equal variant'
                              ELSE 'FAIL  option_3 is not part of variant identity' END
FROM variant WHERE id = 'V3';

-- Many variants may point at ONE countable thing. That is the whole reason
-- stock lives on the blank and not on the variant (ADR-0008): sixty verse
-- designs on six frame blanks is six stock rows, not three hundred and sixty.
INSERT INTO product (id, slug, title, status) VALUES ('P2', 'p2', 'P2', 'active');
INSERT INTO variant (id, product_id, sku, option_1, price_minor)
VALUES ('V4', 'P2', 'blank:s:black', 'Small', 89900);

SELECT CASE WHEN count(*) = 2 THEN 'PASS  one stock item backs variants of different products'
                              ELSE 'FAIL  stock is pinned to a single variant' END
FROM variant WHERE sku = 'blank:s:black';
