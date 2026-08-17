import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { ensureSchema, resetBootstrapCache } from '../../src/lib/db/bootstrap';

/**
 * The state a Deploy-button install actually starts in: a real, provisioned,
 * completely empty database.
 *
 * Cloudflare creates the D1 and binds it, and never runs a migration — its own
 * changelog does not mention them. Whether they run at all depends on what is
 * in the "Deploy command" field on the setup page, which defaults to
 * `npx wrangler deploy` and which a shopkeeper has no reason to touch. So the
 * shop has to be able to build its own schema, and this is the test that says
 * it can.
 */

/**
 * Children before parents. D1 refuses `PRAGMA defer_foreign_keys` with
 * SQLITE_AUTH, so the order has to be right rather than deferred — which is
 * itself a small proof that the foreign keys in the schema are real.
 */
const DROP_ORDER = [
  '_thela_migration',
  'admin_action', 'admin_recovery', 'admin_credential', 'admin_user',
  'payment_event', 'credit_evidence', 'unparsed_alert', 'statement_import',
  'shipment', 'order_item', 'orders',
  'product_image', 'variant', 'product_option', 'product', 'stock_item',
  'postal_serviceability', 'setting',
];

async function emptyDatabase(): Promise<D1Database> {
  await env.DB.batch(DROP_ORDER.map((t) => env.DB.prepare(`DROP TABLE IF EXISTS "${t}"`)));
  resetBootstrapCache();
  return env.DB;
}

const tables = async (db: D1Database): Promise<string[]> => {
  const { results } = await db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .all<{ name: string }>();
  return results.map((r) => r.name);
};

describe('ensureSchema', () => {
  beforeEach(async () => {
    await emptyDatabase();
  });

  it('builds the whole schema from nothing', async () => {
    const db = env.DB;
    expect(await tables(db)).not.toContain('orders');

    const result = await ensureSchema(db);

    expect(result.applied.length).toBeGreaterThanOrEqual(2);
    const after = await tables(db);
    // The tables a shop cannot open without.
    for (const t of ['orders', 'order_item', 'stock_item', 'product', 'variant',
                     'setting', 'payment_event', 'credit_evidence',
                     'admin_user', 'admin_credential']) {
      expect(after, `missing ${t}`).toContain(t);
    }
  });

  it('applies migrations in filename order', async () => {
    await ensureSchema(env.DB);
    const { results } = await env.DB
      .prepare(`SELECT name FROM _thela_migration ORDER BY name`)
      .all<{ name: string }>();

    const names = results.map((r) => r.name);
    expect(names).toEqual([...names].sort());
    expect(names[0]).toMatch(/^0001/);
  });

  it('does nothing on a second call, which is the common case', async () => {
    await ensureSchema(env.DB);
    resetBootstrapCache();

    const again = await ensureSchema(env.DB);

    expect(again.applied).toEqual([]);
    expect(again.alreadyReady).toBe(true);
  });

  it('short-circuits without touching the database once an isolate has checked', async () => {
    await ensureSchema(env.DB);
    // No reset: the module flag is set. Dropping every table underneath it must
    // NOT cause a rebuild, which proves the flag is what is being consulted.
    await env.DB.batch([env.DB.prepare(`DROP TABLE IF EXISTS _thela_migration`)]);

    const result = await ensureSchema(env.DB);

    expect(result).toEqual({ applied: [], alreadyReady: true });
  });

  it('survives two isolates racing to build the same empty database', async () => {
    // The real scenario: a shop goes live and two requests land together on a
    // database that has nothing in it. Exactly one set of tables must result.
    const db = env.DB;

    const results = await Promise.allSettled([
      ensureSchema(db),
      (async () => {
        resetBootstrapCache();
        return ensureSchema(db);
      })(),
    ]);

    // Neither is allowed to leave the schema broken, whichever won.
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);

    const after = await tables(db);
    expect(after).toContain('orders');
    expect(after).toContain('admin_user');

    // And the ledger holds one row per migration, not two.
    const { results: ledger } = await db
      .prepare(`SELECT name, count(*) AS n FROM _thela_migration GROUP BY name`)
      .all<{ name: string; n: number }>();
    for (const row of ledger) expect(row.n, `${row.name} recorded twice`).toBe(1);
  });

  it('leaves a working shop able to take an order immediately afterwards', async () => {
    // The point of all of this: the first visitor to a freshly installed shop
    // should be able to buy something, not read a 500.
    const db = env.DB;
    await ensureSchema(db);

    await db.batch([
      db.prepare(`INSERT INTO stock_item (sku, label, on_hand) VALUES ('s', 'S', 5)`),
      db.prepare(`INSERT INTO product (id, slug, title, status) VALUES ('p', 'p', 'P', 'active')`),
      db.prepare(`INSERT INTO variant (id, product_id, sku, price_minor) VALUES ('v', 'p', 's', 100)`),
      db.prepare(
        `INSERT INTO orders (id, currency, subtotal_minor, amount_due_minor,
                             customer_name, customer_email, fulfilment, expires_at)
         VALUES ('O', 'INR', 100, 100, 'A', 'a@x.com', 'pickup', datetime('now', '+1 hour'))`,
      ),
    ]);

    const order = await db
      .prepare(`SELECT status FROM orders WHERE id = 'O'`)
      .first<{ status: string }>();
    expect(order?.status).toBe('awaiting_payment');

    // Seeded: only what is true of every shop on earth.
    const provider = await db
      .prepare(`SELECT value FROM setting WHERE key = 'shipping.provider'`)
      .first<{ value: string }>();
    expect(provider?.value, 'every shop can dispatch manually from day one').toBe('manual');

    // NOT seeded: anything that would make this an Indian shop by default.
    // A print studio in Lyon must not find itself priced in rupees because
    // nobody asked. The setup wizard asks; the schema does not guess.
    for (const key of ['money.currency', 'shop.country', 'shop.locale', 'tax.label']) {
      const row = await db
        .prepare(`SELECT value FROM setting WHERE key = ?1`)
        .bind(key)
        .first<{ value: string }>();
      expect(row, `${key} must not be seeded`).toBeNull();
    }
  });
});
