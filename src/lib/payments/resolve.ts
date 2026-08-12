/**
 * The one matcher.
 *
 * Every evidence source — bank email, statement upload, customer UTR claim,
 * a volunteer taking cash — lands here. There is exactly one place that
 * decides whether money belongs to an order, and exactly one place that moves
 * an order to `paid`. New sources must not add matching logic; if a source
 * needs its own path, the model is wrong.
 */

import { mayAutoSettle, timeWindowMinutes } from '../banks/registry';
import type { Evidence, Resolution } from './types';

const minutesBetween = (a: string, b: string) =>
  Math.abs(Date.parse(a) - Date.parse(b)) / 60_000;

export async function resolve(db: D1Database, ev: Evidence): Promise<Resolution> {
  // 1. Idempotency, on the reference alone.
  //
  //    NOT on (source, reference): the same UTR arriving by email and again in
  //    the next day's statement is the SAME money, and settling it twice would
  //    decrement stock twice. Sources without a natural reference synthesise a
  //    stable one (e.g. `cash:<orderId>`), so this holds for all of them.
  const seen = await db
    .prepare(`SELECT order_id FROM payment_event WHERE reference = ?1`)
    .bind(ev.reference)
    .first<{ order_id: string }>();
  if (seen) return { outcome: 'duplicate', orderId: seen.order_id };

  // 2. The amount IS the order id. `orders_open_amount` is a partial unique
  //    index over awaiting-payment rows, so this can never return two.
  const order = await db
    .prepare(
      `SELECT id, created_at FROM orders
        WHERE status = 'awaiting_payment'
          AND currency = ?1 AND amount_due_minor = ?2`,
    )
    .bind(ev.currency, ev.amountMinor)
    .first<{ id: string; created_at: string }>();

  if (!order) {
    await recordUnmatched(db, ev, 'no_open_order_for_amount');
    return { outcome: 'unmatched', why: 'no_open_order_for_amount' };
  }

  // 3. A slot is reused once an order is paid or cancelled, so a stale credit
  //    could otherwise match a much later order for the same amount.
  if (minutesBetween(ev.at, order.created_at) > timeWindowMinutes) {
    await recordUnmatched(db, ev, 'outside_time_window');
    return { outcome: 'unmatched', why: 'outside_time_window' };
  }

  const decision = mayAutoSettle(ev);
  if (!decision.auto) {
    await recordUnmatched(db, ev, null, order.id);
    return { outcome: 'review', orderId: order.id, why: decision.why! };
  }

  await settle(db, order.id, ev);
  return { outcome: 'settled', orderId: order.id };
}

/**
 * Mark paid and consume the reservation, atomically.
 *
 * Every failure mode is expressed as a constraint, because D1's `batch()`
 * rolls back on statement ERROR but not on "zero rows affected".
 */
export async function settle(
  db: D1Database,
  orderId: string,
  ev: Evidence,
): Promise<void> {
  const { results: lines } = await db
    .prepare(`SELECT sku, qty FROM order_item WHERE order_id = ?1`)
    .bind(orderId)
    .all<{ sku: string; qty: number }>();

  await db.batch([
    // Idempotency guard first: a replay violates UNIQUE(reference) and aborts
    // everything below it, so stock cannot be decremented twice.
    db
      .prepare(
        `INSERT INTO payment_event
           (order_id, source, confidence, reference, amount_minor, actor, bank_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(
        orderId,
        ev.source,
        ev.confidence,
        ev.reference,
        ev.amountMinor,
        ev.actor ?? null,
        ev.bankId ?? null,
      ),

    // Reservation -> real decrement. Both columns fall together so
    // CHECK (reserved <= on_hand) holds; CHECK (on_hand >= 0) catches oversell.
    ...lines.map((l) =>
      db
        .prepare(
          `UPDATE stock_item
              SET on_hand    = CASE WHEN tracked = 1 THEN on_hand  - ?2 ELSE on_hand  END,
                  reserved   = CASE WHEN tracked = 1 THEN reserved - ?2 ELSE reserved END,
                  updated_at = datetime('now')
            WHERE sku = ?1`,
        )
        .bind(l.sku, l.qty),
    ),

    db
      .prepare(
        `UPDATE orders SET status = 'paid', paid_at = datetime('now')
          WHERE id = ?1 AND status = 'awaiting_payment'`,
      )
      .bind(orderId),
  ]);
}

/**
 * Money we saw but did not act on.
 *
 * Never dropped: an unmatched credit is either a customer we owe goods to or a
 * bug in our own matching, and both need a human to see them.
 */
function recordUnmatched(
  db: D1Database,
  ev: Evidence,
  why: string | null,
  candidateOrder?: string,
) {
  return db
    .prepare(
      `INSERT OR IGNORE INTO credit_evidence
         (reference, currency, amount_minor, credited_at, payer_ref, narration,
          bank_id, source, confidence, candidate_order, unmatched_reason)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    )
    .bind(
      ev.reference,
      ev.currency,
      ev.amountMinor,
      ev.at,
      ev.payerRef ?? null,
      ev.narration ?? null,
      ev.bankId ?? null,
      ev.source,
      ev.confidence,
      candidateOrder ?? null,
      why,
    )
    .run();
}
