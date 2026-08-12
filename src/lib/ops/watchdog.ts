/**
 * The dead man's switch.
 *
 * "Zero maintenance" and "unmonitored" are the same system with different
 * marketing. Every silent failure mode this shop has looks identical from the
 * outside — the storefront stays up, orders keep arriving, and nothing tells
 * the shopkeeper that money stopped being confirmed three days ago.
 *
 * So this counts the things whose *absence* is the symptom, and shouts once
 * when a count crosses a line. It is deliberately dumb: no trends, no anomaly
 * detection, four SQL counts and a threshold. Something that runs unattended
 * for a year has to be something a volunteer can reason about.
 */

export interface Health {
  /** Paid, but nobody has dispatched them. The customer is waiting. */
  awaitingDispatch: number;
  /** Bank alerts that arrived and did not parse. Template drift looks like this. */
  unparsedAlerts: number;
  /** Credits that matched no order. Somebody paid and got nothing. */
  unmatchedCredits: number;
  /** Matched, but policy held them for a human who has not come. */
  awaitingReview: number;
  /** Hours since the last confirmed payment. Null when nothing has ever settled. */
  hoursSinceLastPayment: number | null;
}

export interface Alarm {
  key: string;
  /** What a shopkeeper should understand, in their terms, not ours. */
  message: string;
  severity: 'warn' | 'urgent';
}

export async function health(db: D1Database): Promise<Health> {
  const [dispatch, unparsed, unmatched, review, last] = await db.batch<Record<string, number>>([
    db.prepare(
      `SELECT count(*) AS n FROM orders
        WHERE status = 'paid' AND paid_at <= datetime('now', '-24 hours')`,
    ),
    db.prepare(
      `SELECT count(*) AS n FROM unparsed_alert WHERE seen_at >= datetime('now', '-7 days')`,
    ),
    db.prepare(
      `SELECT count(*) AS n FROM credit_evidence
        WHERE resolved_at IS NULL AND unmatched_reason IS NOT NULL`,
    ),
    db.prepare(
      `SELECT count(*) AS n FROM credit_evidence
        WHERE resolved_at IS NULL AND unmatched_reason IS NULL AND candidate_order IS NOT NULL`,
    ),
    db.prepare(
      `SELECT (julianday('now') - julianday(MAX(at))) * 24 AS h FROM payment_event`,
    ),
  ]);

  const n = (r: D1Result<Record<string, number>> | undefined) => Number(r?.results?.[0]?.n ?? 0);

  return {
    awaitingDispatch: n(dispatch),
    unparsedAlerts: n(unparsed),
    unmatchedCredits: n(unmatched),
    awaitingReview: n(review),
    hoursSinceLastPayment: (last?.results?.[0]?.h as number | null) ?? null,
  };
}

/**
 * Turn counts into things worth waking someone for.
 *
 * `quietHours` exists because the most important alarm here — "payments have
 * stopped confirming" — is indistinguishable from "it is Tuesday and this is a
 * small shop". A church stall that sells four frames a month would otherwise be
 * alarmed at continuously. The threshold is therefore relative to the shop's
 * own rhythm, supplied by the caller, rather than a number we invent.
 */
export function alarms(h: Health, quietHours: number): Alarm[] {
  const out: Alarm[] = [];

  if (h.awaitingDispatch > 0) {
    out.push({
      key: 'awaiting_dispatch',
      severity: h.awaitingDispatch > 5 ? 'urgent' : 'warn',
      message:
        `${h.awaitingDispatch} paid ${plural(h.awaitingDispatch, 'order has', 'orders have')} ` +
        `not been dispatched in over a day. Those customers are waiting.`,
    });
  }

  if (h.unmatchedCredits > 0) {
    out.push({
      key: 'unmatched_credits',
      severity: 'urgent',
      message:
        `${h.unmatchedCredits} payment${plural(h.unmatchedCredits, '', 's')} arrived that ` +
        `no order matched. Somebody has paid and has not received anything.`,
    });
  }

  if (h.awaitingReview > 0) {
    out.push({
      key: 'awaiting_review',
      severity: 'warn',
      message:
        `${h.awaitingReview} payment${plural(h.awaitingReview, '', 's')} ` +
        `${plural(h.awaitingReview, 'is', 'are')} waiting for you to confirm ` +
        `${plural(h.awaitingReview, 'it', 'them')}. The customer's order is on hold until you do.`,
    });
  }

  if (h.unparsedAlerts > 0) {
    out.push({
      key: 'unparsed_alerts',
      severity: h.unparsedAlerts > 3 ? 'urgent' : 'warn',
      message:
        `${h.unparsedAlerts} bank email${plural(h.unparsedAlerts, '', 's')} could not be read ` +
        `this week. If your bank has changed the wording of its alerts, payments will stop ` +
        `confirming by themselves until it is fixed.`,
    });
  }

  if (h.hoursSinceLastPayment !== null && h.hoursSinceLastPayment > quietHours) {
    out.push({
      key: 'no_payments',
      severity: 'urgent',
      message:
        `No payment has been confirmed for ${Math.floor(h.hoursSinceLastPayment)} hours, ` +
        `which is longer than usual for your shop. Either it has been quiet, or ` +
        `confirmations have stopped arriving — worth checking one recent order.`,
    });
  }

  return out;
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);
