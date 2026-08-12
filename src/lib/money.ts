/**
 * Amounts, and the paise slot that makes an order self-identifying.
 *
 * Bank credit alerts and statement rows carry no order reference, so the
 * AMOUNT is the join key: each open order is nudged up by 0..99 paise until it
 * is unique among orders awaiting payment.
 *
 * Uniqueness is enforced by a partial unique index in the schema, not here —
 * see `orders_open_amount` in migrations/0001_init.sql. This module only
 * produces candidates; the database decides which one wins. That keeps
 * allocation correct under concurrency without any locking.
 */

import type { Paise } from './payments/types';

export const PAISE_SLOTS = 100;

/**
 * Candidate amounts for an order, cheapest first.
 *
 * Callers INSERT with each in turn and stop on the first success; a unique
 * violation means another open order already holds that slot.
 */
export function* candidateAmounts(totalPaise: Paise): Generator<Paise> {
  for (let k = 0; k < PAISE_SLOTS; k++) yield totalPaise + k;
}

/** Indian digit grouping: 12,34,567.89 — not the Western 1,234,567.89. */
export function formatINR(paise: Paise): string {
  const neg = paise < 0;
  const s = Math.abs(paise).toString().padStart(3, '0');
  const rupees = s.slice(0, -2);
  const p = s.slice(-2);
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3);
  const grouped = rest
    ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`
    : last3;
  return `${neg ? '-' : ''}${grouped}.${p}`;
}

/**
 * Parse a rupee string from a bank alert or statement cell into paise.
 *
 * Handles "1,399.37", "Rs.1399.37", "INR 1,399.37", "1399". Returns null
 * rather than guessing — a misread amount silently mismatches an order, which
 * looks identical to "nobody has paid yet".
 */
export function parseINR(input: string): Paise | null {
  const m = input.match(/(\d[\d,]*)(?:\.(\d{1,2}))?/);
  if (!m) return null;
  const rupees = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(rupees)) return null;
  const paise = m[2] ? Number(m[2].padEnd(2, '0')) : 0;
  return rupees * 100 + paise;
}
