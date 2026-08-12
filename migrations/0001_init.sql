-- thela v0.1 — core schema
--
-- Two idioms in here are load-bearing and easy to "clean up" into bugs.
-- Read the comments on `stock` and on the partial index over `orders`
-- before changing either.

PRAGMA foreign_keys = ON;

--------------------------------------------------------------------------------
-- STOCK
--
-- Stock lives on the PHYSICAL thing the shopkeeper owns, not on the sellable
-- variant. A shop selling 60 designs x 3 sizes x 2 frame colours owns six
-- kinds of frame blank, not 360 things. Six numbers can be counted on a shelf;
-- 360 cannot, and will drift within a month.
--
-- `tracked = 0` means made-to-order: the variant sells without consuming a
-- counted unit. It is NOT "unlimited stock" — a made-to-order item still
-- consumes a physical blank, so if you genuinely hold blanks, track them.
--------------------------------------------------------------------------------
CREATE TABLE stock (
  sku         TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  on_hand     INTEGER NOT NULL DEFAULT 0 CHECK (on_hand  >= 0),
  reserved    INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  tracked     INTEGER NOT NULL DEFAULT 1 CHECK (tracked IN (0, 1)),
  reorder_at  INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),

  -- THE MECHANISM, not a safety net.
  --
  -- D1 has no interactive transactions. A guarded conditional update
  --     UPDATE stock SET reserved = reserved + ?2 WHERE sku = ?1 AND reserved + ?2 <= on_hand
  -- that matches zero rows is NOT an error in SQLite: it succeeds with
  -- changes() = 0, so batch() happily commits the rest of the order and
  -- silently drops that line.
  --
  -- So we reserve UNGUARDED and let this CHECK raise SQLITE_CONSTRAINT, which
  -- DOES abort the batch and roll back the order insert with it.
  CHECK (tracked = 0 OR reserved <= on_hand)
) STRICT;

--------------------------------------------------------------------------------
-- CATALOGUE
--------------------------------------------------------------------------------
CREATE TABLE product (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  summary     TEXT,
  body_md     TEXT,
  status      TEXT NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft', 'active', 'archived')),
  -- Domain extras stay out of the core schema. The church stores verse_ref,
  -- translation, licence_status and language here; a potter would store
  -- something else. Keep the platform generic.
  meta_json   TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE variant (
  id           TEXT PRIMARY KEY,
  product_id   TEXT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  -- The stock unit this variant consumes when sold.
  sku          TEXT NOT NULL REFERENCES stock(sku),
  option_1     TEXT,                       -- e.g. size
  option_2     TEXT,                       -- e.g. frame colour
  price_paise  INTEGER NOT NULL CHECK (price_paise > 0),

  -- Dimensions are NOT NULL on purpose. Indian courier billing is
  -- max(dead weight, L*W*H/5000) rounded up to the next 0.5 kg, so a light,
  -- bulky parcel is priced on its box. Shops that leave weight at 0 discover
  -- this through weight-discrepancy debits weeks later.
  weight_g     INTEGER NOT NULL CHECK (weight_g > 0),
  len_mm       INTEGER NOT NULL CHECK (len_mm > 0),
  wid_mm       INTEGER NOT NULL CHECK (wid_mm > 0),
  hgt_mm       INTEGER NOT NULL CHECK (hgt_mm > 0),

  position     INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
) STRICT;

CREATE INDEX variant_by_product ON variant(product_id, position);

CREATE TABLE product_image (
  id         TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  r2_key     TEXT NOT NULL,
  alt        TEXT,
  position   INTEGER NOT NULL DEFAULT 0
) STRICT;

--------------------------------------------------------------------------------
-- ORDERS
--------------------------------------------------------------------------------
CREATE TABLE orders (
  id              TEXT PRIMARY KEY,          -- human-facing, e.g. 'CG-000142'
  status          TEXT NOT NULL DEFAULT 'awaiting_payment'
                  CHECK (status IN (
                    'awaiting_payment', 'paid', 'packed',
                    'shipped', 'delivered', 'cancelled', 'refunded'
                  )),

  subtotal_paise  INTEGER NOT NULL CHECK (subtotal_paise > 0),
  shipping_paise  INTEGER NOT NULL DEFAULT 0 CHECK (shipping_paise >= 0),

  -- What the customer is actually asked to pay. This is subtotal + shipping,
  -- nudged up by 0..99 paise so that the AMOUNT ITSELF identifies the order in
  -- a bank credit alert. Bank alerts carry no order reference, so the amount
  -- is the join key and the customer types nothing.
  amount_due_paise INTEGER NOT NULL CHECK (amount_due_paise > 0),

  customer_name   TEXT NOT NULL,
  customer_email  TEXT NOT NULL,
  customer_phone  TEXT NOT NULL,
  -- Optional. If the shopper tells us which UPI ID they will pay from, it
  -- becomes a second matching signal and disambiguates a rare tie.
  payer_vpa_hint  TEXT,

  -- Chosen at checkout. `pickup` means the buyer collects in person: no
  -- carrier, no address, no shipping charge. For a parish shop selling to its
  -- own congregation this is likely the most-used option, and it is free.
  fulfilment      TEXT NOT NULL DEFAULT 'carrier'
                  CHECK (fulfilment IN ('pickup', 'carrier')),

  ship_line1      TEXT,
  ship_line2      TEXT,
  ship_city       TEXT,
  ship_state      TEXT,
  ship_pincode    TEXT CHECK (ship_pincode IS NULL OR length(ship_pincode) = 6),

  note            TEXT,
  admin_note      TEXT,

  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  -- Reservation expiry. A cron releases stock for orders that pass this
  -- while still awaiting payment, which also frees the paise slot.
  expires_at      TEXT NOT NULL,
  paid_at         TEXT,

  -- An address is required if and only if a carrier is involved. Enforced in
  -- the schema so no code path can create a shippable order with nowhere to
  -- ship it, and so a pickup order is not forced to invent a fake address.
  CHECK (
    fulfilment = 'pickup'
    OR (ship_line1 IS NOT NULL AND ship_city IS NOT NULL
        AND ship_state IS NOT NULL AND ship_pincode IS NOT NULL)
  )
) STRICT;

-- THE COLLISION GUARANTEE.
--
-- A partial unique index over only the awaiting-payment rows means the
-- database itself refuses to have two open orders asking for the same amount.
-- Allocation is therefore: try amount_due = total + k for k in 0..99 and take
-- the first INSERT that succeeds. No application-level locking, no slot table.
--
-- Once an order is paid or cancelled it leaves the index and its paise value
-- is immediately reusable.
CREATE UNIQUE INDEX orders_open_amount
  ON orders(amount_due_paise) WHERE status = 'awaiting_payment';

CREATE INDEX orders_by_status ON orders(status, created_at DESC);

CREATE TABLE order_item (
  order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  line_no     INTEGER NOT NULL,
  variant_id  TEXT NOT NULL,
  sku         TEXT NOT NULL,
  -- Snapshots. Never join to the live catalogue to render a past order:
  -- prices and titles change and an old invoice must not change with them.
  title       TEXT NOT NULL,
  option_1    TEXT,
  option_2    TEXT,
  qty         INTEGER NOT NULL CHECK (qty > 0),
  unit_paise  INTEGER NOT NULL CHECK (unit_paise > 0),
  PRIMARY KEY (order_id, line_no)
) STRICT;

--------------------------------------------------------------------------------
-- PAYMENT
--
-- The platform never touches funds. Money moves customer -> merchant bank.
-- These tables only record EVIDENCE that it moved.
--------------------------------------------------------------------------------

-- Evidence we saw but did NOT act on: either it matched no open order, or
-- policy said a human must look first. Never discarded — an unresolved credit
-- is either a customer owed goods or a bug in our own matching.
CREATE TABLE bank_credit (
  -- The UTR (Unique Transaction Reference / RRN) is a 12-digit value minted by
  -- NPCI: the one identifier neither party controls and both can see. Sources
  -- without a natural reference synthesise a stable one, e.g. 'cash:CG-000142'.
  utr              TEXT PRIMARY KEY,
  amount_paise     INTEGER NOT NULL CHECK (amount_paise > 0),
  credited_at      TEXT NOT NULL,
  payer_vpa        TEXT,
  narration        TEXT,
  bank_id          TEXT,
  source           TEXT NOT NULL,           -- email | statement | claim | manual
  confidence       TEXT NOT NULL
                   CHECK (confidence IN ('ledger', 'alert', 'asserted', 'claimed')),
  -- Set when we DID find the order but withheld settlement pending review.
  candidate_order  TEXT REFERENCES orders(id),
  unmatched_reason TEXT,
  resolved_at      TEXT,
  seen_at          TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE INDEX bank_credit_open
  ON bank_credit(seen_at DESC) WHERE resolved_at IS NULL;

-- Emails that arrived but did not parse. This is the template-drift tripwire:
-- a cron counts these, and a non-zero count during business hours means a bank
-- changed its format and payments have stopped confirming.
CREATE TABLE unparsed_alert (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  from_addr  TEXT NOT NULL,
  subject    TEXT,
  body_text  TEXT,
  reason     TEXT NOT NULL,
  seen_at    TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

-- Source-agnostic audit trail. A bank email, a statement row, a customer's UTR
-- and a volunteer taking cash all write the SAME row, so everything downstream
-- is identical regardless of how the payment was established.
CREATE TABLE payment_event (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      TEXT NOT NULL REFERENCES orders(id),
  source        TEXT NOT NULL,              -- email | statement | claim | manual
  confidence    TEXT NOT NULL
                CHECK (confidence IN ('ledger', 'alert', 'asserted', 'claimed')),
  -- UNIQUE on the reference ALONE, not (source, reference). The same UTR
  -- arriving by email today and again in tomorrow's statement is the SAME
  -- money; keying on the pair would settle it twice and decrement stock twice.
  reference     TEXT NOT NULL UNIQUE,
  amount_paise  INTEGER NOT NULL,
  bank_id       TEXT,
  actor         TEXT,                       -- admin identity, for manual events
  at            TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE INDEX payment_event_by_order ON payment_event(order_id);

-- Daily statement uploads. The statement is the account's own ledger, so a row
-- in it is STRONGER evidence than a credit alert — slower, but authoritative.
CREATE TABLE statement_import (
  id           TEXT PRIMARY KEY,
  bank_id      TEXT,
  filename     TEXT NOT NULL,
  row_count    INTEGER NOT NULL DEFAULT 0,
  matched      INTEGER NOT NULL DEFAULT 0,
  uploaded_by  TEXT,
  uploaded_at  TEXT NOT NULL DEFAULT (datetime('now')),
  -- Covers the window this file spans, so the UI can show gaps between uploads.
  period_from  TEXT,
  period_to    TEXT
) STRICT;

--------------------------------------------------------------------------------
-- SHIPPING
--------------------------------------------------------------------------------
CREATE TABLE shipment (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL REFERENCES orders(id),
  carrier       TEXT NOT NULL,              -- 'delhivery' | 'manual' | ...
  awb           TEXT UNIQUE,
  label_r2_key  TEXT,
  status        TEXT NOT NULL DEFAULT 'created',
  status_raw    TEXT,
  charged_paise INTEGER,                    -- reconciled against the wallet
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE INDEX shipment_by_order ON shipment(order_id);

-- Serviceable pincodes, synced nightly from the carrier. Checked at the edge
-- during checkout so we never call the carrier API on a page view.
CREATE TABLE pincode (
  pincode   TEXT PRIMARY KEY CHECK (length(pincode) = 6),
  state     TEXT NOT NULL,
  district  TEXT,
  prepaid   INTEGER NOT NULL DEFAULT 1 CHECK (prepaid IN (0, 1)),
  synced_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

--------------------------------------------------------------------------------
-- SETTINGS
--
-- Everything a shopkeeper configures without a redeploy. Secrets do NOT live
-- here — API tokens are Worker secrets, set by wrangler or the dashboard.
--------------------------------------------------------------------------------
CREATE TABLE setting (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

INSERT INTO setting (key, value) VALUES
  ('shop.name',            'My Shop'),
  ('shop.legal_name',      ''),
  ('shop.address',         ''),
  ('shop.support_email',   ''),
  ('shop.support_phone',   ''),
  ('payment.provider',     'upi-email'),
  ('payment.upi_vpa',      ''),
  ('payment.upi_payee',    ''),
  ('payment.hold_minutes', '60'),
  ('shipping.provider',    'manual'),
  ('shipping.origin_pincode', ''),
  -- Phase 1: unregistered for GST. No tax line is rendered anywhere while
  -- this is 0/false. Phase 2 is a config change, not a repricing exercise.
  ('tax.registered',       'false'),
  ('tax.rate_bp',          '0'),
  -- Server-side allow-list. A pincode prefix rule is WRONG: 403xxx is Goa and
  -- sits inside the otherwise-Maharashtra 400-445 range.
  ('shipping.allowed_states', 'Maharashtra');
