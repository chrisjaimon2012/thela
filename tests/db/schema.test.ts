import { beforeEach, describe, expect, it } from 'vitest';
import { migrate, openOrder, seedShop, stock } from './helpers';

/**
 * The claim the entire stock model rests on, verified rather than assumed.
 *
 * `settle()` puts the idempotency INSERT first in a `batch()` so that a replayed
 * payment violates `UNIQUE(reference)` and aborts everything after it — which is
 * the only reason stock cannot be decremented twice. That is a documented D1
 * behaviour, and documented is not the same as true. Everything below runs
 * against a real D1 inside workerd.
 */

describe('D1 batch semantics', () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await migrate();
    await seedShop(db);
  });

  it('rolls back the WHOLE batch when a statement violates a constraint', async () => {
    await expect(
      db.batch([
        db.prepare(`UPDATE stock_item SET on_hand = on_hand - 1 WHERE sku = 'blank-a'`),
        // reserved > on_hand fires CHECK (tracked = 0 OR reserved <= on_hand)
        db.prepare(`UPDATE stock_item SET reserved = 999 WHERE sku = 'blank-a'`),
        db.prepare(`UPDATE stock_item SET on_hand = on_hand - 1 WHERE sku = 'blank-a'`),
      ]),
    ).rejects.toThrow();

    // The first statement's decrement must not have survived.
    expect((await stock(db))?.on_hand).toBe(10);
  });

  it('does NOT roll back when a statement merely affects zero rows', async () => {
    // This is the trap that made stock reservation unguarded. A conditional
    // UPDATE that matches nothing SUCCEEDS, so a batch guarded that way commits
    // a partial order. Proving it here is why the CHECK exists.
    const res = await db.batch([
      db.prepare(`UPDATE stock_item SET reserved = reserved + 99
                   WHERE sku = 'blank-a' AND reserved + 99 <= on_hand`),
      db.prepare(`UPDATE stock_item SET on_hand = on_hand - 1 WHERE sku = 'blank-a'`),
    ]);

    expect(res[0]!.meta.changes).toBe(0);
    // The second statement committed anyway. Exactly the silent partial commit
    // the CHECK-based design exists to prevent.
    expect((await stock(db))?.on_hand).toBe(9);
  });

  it('refuses to oversell, at the database rather than in application code', async () => {
    await openOrder(db, { id: 'O1', amountMinor: 139900, qty: 10 });
    expect((await stock(db))?.reserved).toBe(10);

    await expect(openOrder(db, { id: 'O2', amountMinor: 139901, qty: 1 })).rejects.toThrow();
    expect((await stock(db))?.reserved).toBe(10);
  });

  it('lets an untracked item be reserved without limit', async () => {
    await db
      .prepare(`UPDATE stock_item SET reserved = reserved + 500 WHERE sku = 'mto'`)
      .run();
    expect((await stock(db, 'mto'))?.reserved).toBe(500);
  });
});

describe('the open-amount slot', () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await migrate();
    await seedShop(db);
  });

  it('permits only one open order per amount per currency', async () => {
    await openOrder(db, { id: 'A', amountMinor: 139937 });
    await expect(openOrder(db, { id: 'B', amountMinor: 139937 })).rejects.toThrow();
  });

  it('scopes the slot to a currency, so a two-currency shop keeps all 100', async () => {
    await openOrder(db, { id: 'A', amountMinor: 139937, currency: 'INR' });
    await openOrder(db, { id: 'B', amountMinor: 139937, currency: 'EUR' });
    const n = await db
      .prepare(`SELECT count(*) AS n FROM orders WHERE amount_due_minor = 139937`)
      .first<{ n: number }>();
    expect(n?.n).toBe(2);
  });

  it('frees the slot once the order settles', async () => {
    await openOrder(db, { id: 'A', amountMinor: 139937 });
    await db.prepare(`UPDATE orders SET status = 'paid' WHERE id = 'A'`).run();
    await expect(openOrder(db, { id: 'C', amountMinor: 139937 })).resolves.not.toThrow();
  });
});
