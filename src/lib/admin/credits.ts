/**
 * Acting on a credit that is waiting for a human.
 *
 * Two kinds end up in the same queue, deliberately: money that matched no open
 * order, and money that matched one but whose source was not trusted enough to
 * settle by itself. From a shopkeeper's side both mean the same thing — somebody
 * has paid and nothing has happened — and making them learn which queue to look
 * in would be an implementation detail leaking into their morning.
 */

import { settle } from '../payments/resolve';
import type { Confidence, Minor } from '../payments/types';
import { audit } from './auth';

export interface SettleOutcome {
  ok: boolean;
  /** Why not, in words a shopkeeper can act on. */
  why?: string;
}

/**
 * Apply a held credit to an order the shopkeeper has chosen.
 *
 * The amount is NOT re-checked against the order. That sounds wrong and is the
 * point of the queue: a customer who paid ₹1,399.00 instead of the ₹1,399.37
 * they were asked for is exactly the case that lands here, and a shopkeeper
 * looking at their own bank app knows it is the same money. The mismatch is
 * shown on the page so the decision is informed, and it is recorded on the
 * event so the discrepancy is never silent.
 */
export async function settleCredit(
  db: D1Database,
  reference: string,
  orderId: string,
  actor: string,
): Promise<SettleOutcome> {
  const credit = await db
    .prepare(
      `SELECT reference, currency, amount_minor AS amountMinor, credited_at AS creditedAt,
              source, confidence, resolved_at AS resolvedAt
         FROM credit_evidence WHERE reference = ?1`,
    )
    .bind(reference)
    .first<{
      reference: string; currency: string; amountMinor: Minor; creditedAt: string;
      source: string; confidence: Confidence; resolvedAt: string | null;
    }>();

  if (!credit) return { ok: false, why: 'That payment is no longer in the queue.' };
  if (credit.resolvedAt) return { ok: false, why: 'That payment has already been dealt with.' };

  const order = await db
    .prepare(`SELECT status, currency, amount_due_minor AS due FROM orders WHERE id = ?1`)
    .bind(orderId)
    .first<{ status: string; currency: string; due: Minor }>();

  if (!order) return { ok: false, why: 'That order does not exist.' };
  if (order.status !== 'awaiting_payment') {
    return { ok: false, why: `That order is already ${order.status.replace('_', ' ')}.` };
  }
  if (order.currency !== credit.currency) {
    // Not a judgement call. Applying a EUR credit to an INR order would put a
    // number in the ledger that means nothing.
    return {
      ok: false,
      why: `That payment is in ${credit.currency} and the order is in ${order.currency}.`,
    };
  }

  try {
    await settle(db, orderId, {
      source: credit.source,
      confidence: credit.confidence,
      reference: credit.reference,
      amountMinor: credit.amountMinor,
      currency: credit.currency,
      at: credit.creditedAt,
      actor,
      narration:
        credit.amountMinor === order.due
          ? undefined
          : // Recorded, not hidden. Somebody reconciling this later needs to see
            // that the amounts differed and that a human accepted it anyway.
            `Amount differs: received ${credit.amountMinor}, expected ${order.due}`,
    });
  } catch {
    // Almost always UNIQUE(reference): the same money settled something else
    // while this page was open.
    return { ok: false, why: 'That payment had already been applied somewhere.' };
  }

  await db
    .prepare(
      `UPDATE credit_evidence
          SET resolved_at = datetime('now'), candidate_order = ?2
        WHERE reference = ?1`,
    )
    .bind(reference, orderId)
    .run();

  await audit(db, actor, 'credit.settled', orderId, `${reference} · ${credit.amountMinor}`);
  return { ok: true };
}

/**
 * Take a credit out of the queue without applying it.
 *
 * For money that is genuinely not a customer payment — a refund coming back, a
 * transfer from the shopkeeper's own account, a bank fee reversal. The row
 * stays; only its `resolved_at` is set, so the evidence is never destroyed.
 */
export async function dismissCredit(
  db: D1Database,
  reference: string,
  actor: string,
  reason: string,
): Promise<SettleOutcome> {
  const res = await db
    .prepare(
      `UPDATE credit_evidence SET resolved_at = datetime('now')
        WHERE reference = ?1 AND resolved_at IS NULL`,
    )
    .bind(reference)
    .run();

  if (res.meta.changes === 0) {
    return { ok: false, why: 'That payment has already been dealt with.' };
  }

  await audit(db, actor, 'credit.dismissed', reference, reason);
  return { ok: true };
}

/**
 * Open orders whose amount is near a credit, best first.
 *
 * Offered as suggestions rather than a match, because by the time a credit is
 * in this queue the exact-amount rule has already failed. Nearby amounts are
 * where the answer usually is: a customer who rounded the minor-unit suffix off,
 * or paid a day late into a slot that had been reused.
 */
export const candidateOrders = (db: D1Database, currency: string, amountMinor: Minor, window = 200) =>
  db
    .prepare(
      `SELECT id, amount_due_minor AS amountDueMinor, customer_name AS customerName,
              customer_email AS customerEmail, created_at AS createdAt
         FROM orders
        WHERE status = 'awaiting_payment' AND currency = ?1
        ORDER BY ABS(amount_due_minor - ?2), created_at DESC
        LIMIT 8`,
    )
    .bind(currency, amountMinor)
    .all<{
      id: string; amountDueMinor: Minor; customerName: string;
      customerEmail: string; createdAt: string;
    }>()
    .then((r) => r.results.filter((o) => Math.abs(o.amountDueMinor - amountMinor) <= window * 100));
