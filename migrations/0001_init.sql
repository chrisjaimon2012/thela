-- thela — core schema
--
-- Country-agnostic by construction (ADR-0017). Money is always an integer in
-- the currency's MINOR units; the currency and its exponent are settings. No
-- column, function or comment is named after a currency.
--
-- Two idioms below look like mistakes and are deliberate. Read the comments on
-- `stock_item` and on the partial index over `orders` before changing either;
-- both are proved in tests/invariants.test.sql.

PRAGMA foreign_keys = ON;

--------------------------------------------------------------------------------
-- STOCK
--
-- A countable physical thing. The DEFAULT is one stock item per variant,
-- created with it — most vendors want one-variant-one-count and should never
-- think about this table.
--
-- Several variants MAY point at one stock item where they genuinely consume the
-- same object: a framer whose sixty designs share six frame blanks counts six
-- numbers, not 360. That is an advanced configuration, not the model's shape
-- (ADR-0016).
--------------------------------------------------------------------------------
CREATE TABLE stock_item (
  sku         TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  on_hand     INTEGER NOT NULL DEFAULT 0 CHECK (on_hand  >= 0),
  reserved    INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  -- 0 = made to order: sells without consuming a counted unit.
  tracked     INTEGER NOT NULL DEFAULT 1 CHECK (tracked IN (0, 1)),
  reorder_at  INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),

  -- THE MECHANISM, not a safety net (ADR-0008).
  --
  -- D1 has no interactive transactions. A guarded conditional update
  --   UPDATE ... SET reserved = reserved + ?2 WHERE sku = ?1 AND reserved + ?2 <= on_hand
  -- that matches zero rows is NOT an error in SQLite: it succeeds with
  -- changes() = 0, so batch() commits the rest of the order and silently drops
  -- that line. We reserve UNGUARDED and let this CHECK raise, which DOES abort
  -- the batch.
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
  -- Vendor-defined extras. A framer stores verse_ref and translation here; a
  -- clothing shop stores fabric. The platform never interprets it.
  meta_json   TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE INDEX product_by_status ON product(status, created_at DESC);

-- A product names its own option axes: "Size", "Colour", "Material".
-- Up to three, which is Shopify's long-standing cap and covers almost every
-- small-business catalogue. A product with no rows here has one implicit
-- variant and no picker.
CREATE TABLE product_option (
  product_id TEXT    NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL CHECK (position BETWEEN 1 AND 3),
  name       TEXT    NOT NULL,
  PRIMARY KEY (product_id, position)
) STRICT;

CREATE TABLE variant (
  id           TEXT PRIMARY KEY,
  product_id   TEXT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  -- The countable thing this variant consumes. Usually its own.
  sku          TEXT NOT NULL REFERENCES stock_item(sku),

  -- Values for the axes named in product_option, by position.
  option_1     TEXT,
  option_2     TEXT,
  option_3     TEXT,

  price_minor  INTEGER NOT NULL CHECK (price_minor > 0),

  -- Shipping dimensions describe the PACKED parcel, not the product. Couriers
  -- bill on max(dead weight, volumetric), so a light bulky parcel is priced on
  -- its box. Nullable because digital and collect-only goods have none.
  weight_g     INTEGER CHECK (weight_g IS NULL OR weight_g > 0),
  len_mm       INTEGER CHECK (len_mm  IS NULL OR len_mm  > 0),
  wid_mm       INTEGER CHECK (wid_mm  IS NULL OR wid_mm  > 0),
  hgt_mm       INTEGER CHECK (hgt_mm  IS NULL OR hgt_mm  > 0),

  position     INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
) STRICT;

-- One row per combination of axis values.
--
-- This has to be an expression index, not `UNIQUE (product_id, option_1,
-- option_2, option_3)`. SQLite considers NULLs distinct in a UNIQUE
-- constraint, so the plain version silently permits duplicates for any product
-- using fewer than three axes — which is nearly all of them, and precisely the
-- case a two-axis shop would hit first. Coalescing to '' makes "no value" a
-- value, so the grid cell is unique whatever the arity.
CREATE UNIQUE INDEX variant_grid ON variant(
  product_id, ifnull(option_1, ''), ifnull(option_2, ''), ifnull(option_3, '')
);

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
  id               TEXT PRIMARY KEY,
  status           TEXT NOT NULL DEFAULT 'awaiting_payment'
                   CHECK (status IN (
                     'awaiting_payment', 'paid', 'packed',
                     'shipped', 'delivered', 'cancelled', 'refunded'
                   )),

  currency         TEXT NOT NULL,            -- ISO 4217, snapshot at order time
  subtotal_minor   INTEGER NOT NULL CHECK (subtotal_minor > 0),
  shipping_minor   INTEGER NOT NULL DEFAULT 0 CHECK (shipping_minor >= 0),
  tax_minor        INTEGER NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),

  -- What the customer is asked to pay. Subtotal + shipping + tax, nudged up by
  -- 0..99 minor units so the AMOUNT ITSELF identifies the order in a bank
  -- statement or credit alert, which carry no order reference (ADR-0007).
  -- Works in paise, cents or pence — the mechanism is not Indian.
  amount_due_minor INTEGER NOT NULL CHECK (amount_due_minor > 0),

  customer_name    TEXT NOT NULL,
  customer_email   TEXT NOT NULL,
  customer_phone   TEXT,

  fulfilment       TEXT NOT NULL DEFAULT 'carrier'
                   CHECK (fulfilment IN ('pickup', 'carrier', 'digital')),

  ship_line1       TEXT,
  ship_line2       TEXT,
  ship_city        TEXT,
  ship_region      TEXT,                     -- state / province / département
  ship_postal_code TEXT,
  ship_country     TEXT,                     -- ISO 3166-1 alpha-2

  note             TEXT,
  admin_note       TEXT,

  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at       TEXT NOT NULL,
  paid_at          TEXT,

  -- An address is required if and only if something is being carried. Enforced
  -- here so no code path can create a shippable order with nowhere to ship it,
  -- and a pickup or digital order is never forced to invent one.
  CHECK (
    fulfilment <> 'carrier'
    OR (ship_line1 IS NOT NULL AND ship_city IS NOT NULL
        AND ship_postal_code IS NOT NULL AND ship_country IS NOT NULL)
  )
) STRICT;

-- THE COLLISION GUARANTEE (ADR-0007).
--
-- A partial unique index over only the open orders means the database itself
-- refuses two orders asking for the same amount. Allocation is therefore
-- "try total + k for k in 0..99 and take the first INSERT that wins" — no slot
-- table, no locking, correct under concurrency.
CREATE UNIQUE INDEX orders_open_amount
  ON orders(currency, amount_due_minor) WHERE status = 'awaiting_payment';

CREATE INDEX orders_by_status ON orders(status, created_at DESC);

CREATE TABLE order_item (
  order_id     TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  line_no      INTEGER NOT NULL,
  variant_id   TEXT NOT NULL,
  sku          TEXT NOT NULL,
  -- Snapshots. Never join to the live catalogue to render a past order: prices
  -- and titles change and an old invoice must not change with them.
  title        TEXT NOT NULL,
  option_1     TEXT,
  option_2     TEXT,
  option_3     TEXT,
  qty          INTEGER NOT NULL CHECK (qty > 0),
  unit_minor   INTEGER NOT NULL CHECK (unit_minor > 0),
  PRIMARY KEY (order_id, line_no)
) STRICT;

--------------------------------------------------------------------------------
-- PAYMENT
--
-- The platform never touches funds (ADR-0003). These tables record only
-- EVIDENCE that money moved between the customer and the merchant's own bank.
--------------------------------------------------------------------------------

-- Evidence seen but not acted on: matched no open order, or policy withheld
-- settlement pending review. Never discarded.
CREATE TABLE credit_evidence (
  -- Bank reference (UTR/RRN in India, end-to-end id in SEPA, and so on).
  -- Sources without a natural reference synthesise a stable one, e.g.
  -- 'cash:ORD-000142'.
  reference        TEXT PRIMARY KEY,
  currency         TEXT NOT NULL,
  amount_minor     INTEGER NOT NULL CHECK (amount_minor > 0),
  credited_at      TEXT NOT NULL,
  payer_ref        TEXT,                     -- VPA, IBAN, card last4…
  narration        TEXT,
  bank_id          TEXT,
  source           TEXT NOT NULL,            -- email | statement | claim | manual
  confidence       TEXT NOT NULL
                   CHECK (confidence IN ('ledger', 'alert', 'asserted', 'claimed')),
  candidate_order  TEXT REFERENCES orders(id),
  unmatched_reason TEXT,
  resolved_at      TEXT,
  seen_at          TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE INDEX credit_evidence_open
  ON credit_evidence(seen_at DESC) WHERE resolved_at IS NULL;

-- Alerts that arrived but did not parse. The template-drift tripwire: a cron
-- counts these, and a non-zero count during business hours means a bank changed
-- its format and payments have quietly stopped confirming.
CREATE TABLE unparsed_alert (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  from_addr  TEXT NOT NULL,
  subject    TEXT,
  body_text  TEXT,
  reason     TEXT NOT NULL,
  seen_at    TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

-- Source-agnostic audit trail. A bank email, a statement row, a customer's
-- reference and a volunteer taking cash all write the SAME row (ADR-0006).
CREATE TABLE payment_event (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      TEXT NOT NULL REFERENCES orders(id),
  source        TEXT NOT NULL,
  confidence    TEXT NOT NULL
                CHECK (confidence IN ('ledger', 'alert', 'asserted', 'claimed')),
  -- UNIQUE on the reference ALONE, not (source, reference): the same payment
  -- seen by email today and in tomorrow's statement is the same money, and
  -- keying on the pair would settle it twice (ADR-0009).
  reference     TEXT NOT NULL UNIQUE,
  amount_minor  INTEGER NOT NULL,
  bank_id       TEXT,
  actor         TEXT,
  at            TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE INDEX payment_event_by_order ON payment_event(order_id);

-- Statement uploads. A statement is the account's own ledger, so a row in it is
-- STRONGER evidence than a credit alert — slower, but authoritative (ADR-0010).
CREATE TABLE statement_import (
  id           TEXT PRIMARY KEY,
  bank_id      TEXT,
  filename     TEXT NOT NULL,
  row_count    INTEGER NOT NULL DEFAULT 0,
  matched      INTEGER NOT NULL DEFAULT 0,
  uploaded_by  TEXT,
  uploaded_at  TEXT NOT NULL DEFAULT (datetime('now')),
  period_from  TEXT,
  period_to    TEXT
) STRICT;

--------------------------------------------------------------------------------
-- SHIPPING
--------------------------------------------------------------------------------
CREATE TABLE shipment (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL REFERENCES orders(id),
  carrier       TEXT NOT NULL,
  tracking_ref  TEXT UNIQUE,                 -- AWB / tracking number
  label_r2_key  TEXT,
  status        TEXT NOT NULL DEFAULT 'created',
  status_raw    TEXT,
  charged_minor INTEGER,                     -- reconciled against the carrier
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE INDEX shipment_by_order ON shipment(order_id);

-- Serviceable postal codes, synced from the carrier. Checked at the edge during
-- checkout so we never call a carrier API on a page view.
CREATE TABLE postal_serviceability (
  country     TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  region      TEXT,
  city        TEXT,
  deliverable INTEGER NOT NULL DEFAULT 1 CHECK (deliverable IN (0, 1)),
  synced_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (country, postal_code)
) STRICT;

--------------------------------------------------------------------------------
-- SETTINGS
--
-- Everything a vendor configures without a redeploy. Secrets do NOT live here:
-- API tokens are Worker secrets, so a leaked database backup holds no
-- credentials.
--------------------------------------------------------------------------------
CREATE TABLE setting (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

INSERT INTO setting (key, value) VALUES
  ('shop.name',               'My Shop'),
  ('shop.legal_name',         ''),
  ('shop.address',            ''),
  ('shop.support_email',      ''),
  ('shop.support_phone',      ''),
  ('shop.country',            'IN'),
  ('shop.locale',             'en-IN'),

  -- ISO 4217 plus its exponent. Everything monetary is an integer in minor
  -- units; this is the only place the currency is known.
  ('money.currency',          'INR'),
  ('money.exponent',          '2'),

  -- R2 custom domain. Serving images through the Worker instead is the single
  -- change that turns a comfortable free tier into an overage.
  ('media.base_url',          ''),

  ('payment.provider',        'upi-email'),
  ('payment.upi_vpa',         ''),
  ('payment.upi_payee',       ''),
  ('payment.hold_minutes',    '60'),

  ('shipping.provider',       'manual'),
  ('shipping.origin_postal',  ''),
  -- Empty means unrestricted. A shop restricted to one region lists it here.
  ('shipping.allowed_regions', ''),
  ('shipping.allowed_countries', 'IN'),

  -- Tax is a configured rule, not a hardcoded regime (ADR-0017). While
  -- unregistered no tax line is rendered anywhere.
  ('tax.registered',          'false'),
  ('tax.rate_bp',             '0'),
  ('tax.label',               'GST'),
  ('tax.number',              '');
