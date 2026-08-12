/**
 * Money, and the minor-unit slot that makes an order self-identifying.
 *
 * Every amount in this codebase is an integer in the currency's MINOR units —
 * paise, cents, pence. Nothing is a float, and nothing is named after a
 * currency (ADR-0017).
 *
 * Bank statements and credit alerts carry no order reference, so the AMOUNT is
 * the join key: each open order is nudged up by 0..99 minor units until it is
 * unique among orders awaiting payment. That mechanism is not Indian — it works
 * anywhere with a decimal currency and a bank statement, which is the whole
 * reason it can be the project's global answer rather than one plugin per
 * country (ADR-0018).
 *
 * Uniqueness is enforced by a partial unique index in the schema, not here —
 * see `orders_open_amount`. This module only produces candidates; the database
 * decides which one wins, which keeps allocation correct under concurrency
 * without any locking.
 */

import type { Minor } from './payments/types';

/** Slots available per amount. Two decimal places is near-universal. */
export const MINOR_SLOTS = 100;

/**
 * Candidate amounts for an order, cheapest first. Callers INSERT with each in
 * turn and stop on the first success; a unique violation means another open
 * order already holds that slot.
 */
export function* candidateAmounts(total: Minor): Generator<Minor> {
  for (let k = 0; k < MINOR_SLOTS; k++) yield total + k;
}

/**
 * Format for display, in the shop's own locale.
 *
 * `Intl` is built into workerd, so this costs no bundle weight and gets Indian
 * digit grouping (12,34,567.89) right without us hand-rolling it.
 */
export function formatMoney(
  minor: Minor,
  currency: string,
  locale = 'en-IN',
  exponent = 2,
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(minor / 10 ** exponent);
}

/** Digits only, for places where the currency symbol is rendered separately. */
export function formatAmount(minor: Minor, locale = 'en-IN', exponent = 2): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(minor / 10 ** exponent);
}

/**
 * Parse an amount out of a bank alert or a statement cell.
 *
 * Handles "1,399.37", "Rs.1399.37", "INR 1,399.37", "€1.399,37" and bare
 * integers. Returns null rather than guessing — a misread amount silently
 * fails to match an order, which looks exactly like "nobody has paid yet".
 */
export function parseMoney(input: string, exponent = 2): Minor | null {
  const cleaned = input.replace(/[^\d.,-]/g, '').trim();
  if (!cleaned) return null;

  // Whichever separator appears last is the decimal point: "1.399,37" is
  // European, "1,399.37" is Indian/US. Both occur in real statements.
  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  const decimalAt = Math.max(lastDot, lastComma);

  let whole = cleaned;
  let frac = '';
  if (decimalAt > -1 && cleaned.length - decimalAt - 1 <= exponent) {
    whole = cleaned.slice(0, decimalAt);
    frac = cleaned.slice(decimalAt + 1);
  }

  const units = Number(whole.replace(/[.,]/g, ''));
  if (!Number.isFinite(units)) return null;

  return units * 10 ** exponent + Number(frac.padEnd(exponent, '0').slice(0, exponent) || 0);
}
