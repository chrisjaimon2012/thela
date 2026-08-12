import { beforeEach, describe, expect, it } from 'vitest';
import { resolve } from '../../src/lib/payments/resolve';
import type { Evidence } from '../../src/lib/payments/types';
import { migrate, openOrder, orderStatus, seedShop, stock } from './helpers';

/**
 * The one matcher, against a real database.
 *
 * Every one of these would have passed against a mock. Two real bugs were
 * sitting in `resolve()` when this file was written, both invisible to
 * TypeScript and both fatal in production:
 *
 *   * `recordUnmatched` inserted into `credit_evidence(utr, payer_vpa, …)`.
 *     Those columns were renamed to `reference` and `payer_ref`, and a
 *     NOT NULL `currency` was added. So every unmatched credit — money a
 *     customer really sent — threw instead of being recorded for a human.
 *   * The order lookup matched on amount alone, while the uniqueness index is
 *     on (currency, amount). In a shop trading in two currencies a €1,399.37
 *     credit could settle an order for ₹1,399.37.
 */

const evidence = (over: Partial<Evidence> = {}): Evidence => ({
  source: 'statement',
  confidence: 'ledger',
  reference: '402312345678',
  amountMinor: 139937,
  currency: 'INR',
  at: new Date().toISOString(),
  ...over,
});

describe('resolve', () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await migrate();
    await seedShop(db);
  });

  it('settles a matching order and converts the reservation into a decrement', async () => {
    await openOrder(db, { id: 'O1', amountMinor: 139937, qty: 2 });
    expect(await stock(db)).toMatchObject({ on_hand: 10, reserved: 2 });

    const r = await resolve(db, evidence());

    expect(r).toEqual({ outcome: 'settled', orderId: 'O1' });
    expect((await orderStatus(db, 'O1'))?.status).toBe('paid');
    // Both columns fall together, which is what keeps reserved <= on_hand true.
    expect(await stock(db)).toMatchObject({ on_hand: 8, reserved: 0 });
  });

  it('treats the same reference twice as a no-op, not a second sale', async () => {
    await openOrder(db, { id: 'O1', amountMinor: 139937, qty: 2 });
    await resolve(db, evidence());

    // The same UTR arriving by email today and in tomorrow's statement is the
    // SAME money. Settling twice would decrement stock twice.
    const again = await resolve(db, evidence({ source: 'email', confidence: 'alert' }));

    expect(again).toEqual({ outcome: 'duplicate', orderId: 'O1' });
    expect(await stock(db)).toMatchObject({ on_hand: 8, reserved: 0 });
    const events = await db
      .prepare(`SELECT count(*) AS n FROM payment_event WHERE reference = '402312345678'`)
      .first<{ n: number }>();
    expect(events?.n).toBe(1);
  });

  it('records an unmatched credit rather than dropping it', async () => {
    // Nobody's order is for this amount. That is either a customer we owe
    // goods to or a bug in our own matching, and both need a human.
    const r = await resolve(db, evidence({ amountMinor: 5000 }));

    expect(r).toEqual({ outcome: 'unmatched', why: 'no_open_order_for_amount' });

    const row = await db
      .prepare(`SELECT * FROM credit_evidence WHERE reference = '402312345678'`)
      .first<Record<string, unknown>>();
    expect(row, 'the credit must be recorded, not lost').not.toBeNull();
    expect(row).toMatchObject({
      currency: 'INR',
      amount_minor: 5000,
      unmatched_reason: 'no_open_order_for_amount',
      source: 'statement',
    });
  });

  it('does not settle an order in another currency for the same number', async () => {
    // The slot is unique per (currency, amount), so both of these can be open
    // at once and only one of them is owed this money.
    await openOrder(db, { id: 'EUR', amountMinor: 139937, currency: 'EUR' });

    const r = await resolve(db, evidence({ currency: 'INR' }));

    expect(r.outcome).toBe('unmatched');
    expect((await orderStatus(db, 'EUR'))?.status).toBe('awaiting_payment');
  });

  it('settles the order whose currency matches, when both are open', async () => {
    await openOrder(db, { id: 'INR', amountMinor: 139937, currency: 'INR' });
    await openOrder(db, { id: 'EUR', amountMinor: 139937, currency: 'EUR' });

    const r = await resolve(db, evidence({ currency: 'EUR' }));

    expect(r).toEqual({ outcome: 'settled', orderId: 'EUR' });
    expect((await orderStatus(db, 'INR'))?.status).toBe('awaiting_payment');
  });

  it('refuses a credit that arrived long after the order, because slots are reused', async () => {
    await openOrder(db, {
      id: 'OLD',
      amountMinor: 139937,
      createdAt: '2026-01-01 10:00:00',
    });

    const r = await resolve(db, evidence({ at: '2026-06-01T10:00:00Z' }));

    expect(r).toEqual({ outcome: 'unmatched', why: 'outside_time_window' });
    expect((await orderStatus(db, 'OLD'))?.status).toBe('awaiting_payment');
    // Still recorded — a human decides what that money was.
    const row = await db
      .prepare(`SELECT unmatched_reason FROM credit_evidence WHERE reference = '402312345678'`)
      .first<{ unmatched_reason: string }>();
    expect(row?.unmatched_reason).toBe('outside_time_window');
  });

  it('holds a customer claim for review instead of settling on their word', async () => {
    await openOrder(db, { id: 'O1', amountMinor: 139937 });

    const r = await resolve(db, evidence({ source: 'claim', confidence: 'claimed' }));

    expect(r.outcome).toBe('review');
    expect((await orderStatus(db, 'O1'))?.status).toBe('awaiting_payment');
    expect(await stock(db)).toMatchObject({ reserved: 1 });

    // Parked against the order it probably belongs to, so a human sees the pair.
    const row = await db
      .prepare(`SELECT candidate_order FROM credit_evidence WHERE reference = '402312345678'`)
      .first<{ candidate_order: string }>();
    expect(row?.candidate_order).toBe('O1');
  });

  it('settles on a human with account access asserting it', async () => {
    await openOrder(db, { id: 'O1', amountMinor: 139937 });

    const r = await resolve(
      db,
      evidence({ source: 'manual', confidence: 'asserted', actor: 'volunteer@example.com' }),
    );

    expect(r).toEqual({ outcome: 'settled', orderId: 'O1' });
    const ev = await db
      .prepare(`SELECT actor, confidence FROM payment_event WHERE order_id = 'O1'`)
      .first<{ actor: string; confidence: string }>();
    expect(ev).toMatchObject({ actor: 'volunteer@example.com', confidence: 'asserted' });
  });

  it('never settles the same order twice from two different references', async () => {
    await openOrder(db, { id: 'O1', amountMinor: 139937, qty: 2 });
    await resolve(db, evidence({ reference: 'A11111111111' }));

    // A second, genuinely different credit for the same amount. The order is
    // no longer open, so it must not match — and stock must not move again.
    const second = await resolve(db, evidence({ reference: 'B22222222222' }));

    expect(second.outcome).toBe('unmatched');
    expect(await stock(db)).toMatchObject({ on_hand: 8, reserved: 0 });
  });
});
