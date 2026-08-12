// `cloudflare:workers`, not `cloudflare:test` — the latter's `env` is
// deprecated in favour of the same import the application code uses, which is
// also the point: the tests reach for bindings exactly as the Worker does.
import { env } from 'cloudflare:workers';
import migration from '../../migrations/0001_init.sql?raw';

/**
 * Apply the real migration to the test database.
 *
 * The REAL one, read off disk — not a hand-maintained copy. The entire value of
 * these tests is that they fail when the schema and the code disagree, and a
 * second copy of the schema is precisely how that stops working.
 *
 * D1 has no multi-statement exec that tolerates the comments and blank lines a
 * readable migration is full of, so statements are split on semicolons at line
 * ends after comments are stripped. That is crude, and it is sufficient because
 * the migration contains no semicolon inside a string literal or a trigger body.
 * If one ever does, this will break loudly rather than silently — which is the
 * right failure for a test helper.
 */
export async function migrate(): Promise<D1Database> {
  // The database outlives an individual test, so migrate once and clear
  // between. Re-running the DDL would fail with "table already exists", and
  // dropping every table each time is slower for no benefit.
  const existing = await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'orders'`,
  ).first<{ name: string }>();

  if (existing) {
    await clear(env.DB);
    return env.DB;
  }

  const sql = migration
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  const statements = sql
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);

  await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
  return env.DB;
}

/**
 * Empty every table, children first.
 *
 * Listed explicitly rather than discovered from sqlite_master, so that adding a
 * table without thinking about test isolation shows up as a test that mysteriously
 * sees another test's rows — which is a bug worth being loud about.
 */
async function clear(db: D1Database): Promise<void> {
  const tables = [
    'payment_event', 'credit_evidence', 'unparsed_alert', 'statement_import',
    'shipment', 'order_item', 'orders',
    'product_image', 'variant', 'product_option', 'product', 'stock_item',
    'postal_serviceability',
  ];
  await db.batch(tables.map((t) => db.prepare(`DELETE FROM ${t}`)));
}

/** A shop with stock, for tests that need something to sell. */
export async function seedShop(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(
      `INSERT INTO stock_item (sku, label, on_hand, reserved, tracked)
       VALUES ('blank-a', 'Blank A', 10, 0, 1), ('mto', 'Made to order', 0, 0, 0)`,
    ),
    db.prepare(
      `INSERT INTO product (id, slug, title, status) VALUES ('p1', 'p1', 'Product one', 'active')`,
    ),
    db.prepare(
      `INSERT INTO variant (id, product_id, sku, option_1, price_minor)
       VALUES ('v1', 'p1', 'blank-a', 'Small', 139900)`,
    ),
  ]);
}

export interface OpenOrderInput {
  id: string;
  amountMinor: number;
  currency?: string;
  /** Units of `blank-a` this order holds. Reserved as part of creating it. */
  qty?: number;
  createdAt?: string;
  expiresAt?: string;
}

/**
 * An order awaiting payment, with its stock reserved — the state every
 * verification path actually encounters.
 */
export async function openOrder(db: D1Database, o: OpenOrderInput): Promise<void> {
  const qty = o.qty ?? 1;
  await db.batch([
    db
      .prepare(
        `INSERT INTO orders (id, currency, subtotal_minor, amount_due_minor,
                             customer_name, customer_email, fulfilment, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?3, 'A Customer', 'a@example.com', 'pickup',
                 COALESCE(?4, datetime('now')), COALESCE(?5, datetime('now', '+1 hour')))`,
      )
      .bind(o.id, o.currency ?? 'INR', o.amountMinor, o.createdAt ?? null, o.expiresAt ?? null),
    db
      .prepare(
        `INSERT INTO order_item (order_id, line_no, variant_id, sku, title, qty, unit_minor)
         VALUES (?1, 1, 'v1', 'blank-a', 'Product one', ?2, ?3)`,
      )
      .bind(o.id, qty, o.amountMinor),
    db.prepare(`UPDATE stock_item SET reserved = reserved + ?2 WHERE sku = 'blank-a'`).bind(o.id, qty),
  ]);
}

export const stock = (db: D1Database, sku = 'blank-a') =>
  db
    .prepare(`SELECT on_hand, reserved, tracked FROM stock_item WHERE sku = ?1`)
    .bind(sku)
    .first<{ on_hand: number; reserved: number; tracked: number }>();

export const orderStatus = (db: D1Database, id: string) =>
  db.prepare(`SELECT status, paid_at FROM orders WHERE id = ?1`).bind(id).first<{
    status: string;
    paid_at: string | null;
  }>();
