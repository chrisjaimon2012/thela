/**
 * Cart operations.
 *
 * Pages and endpoints call these; nobody outside this directory touches the
 * cookie or its signature. The cookie mechanics live in `./cookie`, the money
 * in `../money`, and the catalogue reads in `../catalogue` — this file is the
 * seam that joins them.
 */

import type { AstroCookies } from 'astro';
import {
  CART_COOKIE, MAX_QTY, cartKey, decodeCart, encodeCart, normalise,
  type CartLine,
} from './cookie';
import { priceLines, type PricedLine } from '../catalogue';
import type { Minor } from '../payments/types';

export { MAX_QTY } from './cookie';
export type { CartLine } from './cookie';

/** A month. Long enough that a customer can come back after payday. */
const MAX_AGE = 60 * 60 * 24 * 30;

export interface Cart {
  lines: PricedLine[];
  /** Sum of every line, before shipping and tax. */
  subtotalMinor: Minor;
  itemCount: number;
  /** True when a line was silently dropped because its variant no longer exists. */
  dropped: boolean;
  /** Lines the customer must fix before checkout: sold out, or more than remains. */
  problems: PricedLine[];
}

export async function readCart(db: D1Database, cookies: AstroCookies): Promise<Cart> {
  const key = await cartKey(db);
  const stored = await decodeCart(cookies.get(CART_COOKIE)?.value, key);
  const lines = await priceLines(db, stored);

  return {
    lines,
    subtotalMinor: lines.reduce((sum, l) => sum + l.lineMinor, 0),
    itemCount: lines.reduce((sum, l) => sum + l.qty, 0),
    dropped: lines.length !== stored.length,
    problems: lines.filter((l) => !l.available || (l.maxQty !== null && l.qty > l.maxQty)),
  };
}

/** The raw lines, without a catalogue read. For endpoints that only mutate. */
export async function readCartLines(db: D1Database, cookies: AstroCookies): Promise<CartLine[]> {
  return decodeCart(cookies.get(CART_COOKIE)?.value, await cartKey(db));
}

export async function writeCart(
  db: D1Database,
  cookies: AstroCookies,
  lines: CartLine[],
  secure: boolean,
): Promise<void> {
  const clean = normalise(lines);

  if (clean.length === 0) {
    cookies.delete(CART_COOKIE, { path: '/' });
    return;
  }

  cookies.set(CART_COOKIE, await encodeCart(clean, await cartKey(db)), {
    path: '/',
    // No script needs to read the cart, so no script should be able to.
    httpOnly: true,
    // Lax, not Strict: a customer arriving from their own order email should
    // still have their cart. Our own form POSTs are same-origin either way.
    sameSite: 'lax',
    // Off on plain-HTTP local dev, or the cookie is set and never sent back.
    secure,
    maxAge: MAX_AGE,
  });
}

/** True when this request arrived over TLS, which every deployed shop does. */
export const isSecure = (request: Request): boolean =>
  new URL(request.url).protocol === 'https:';

export function addLine(lines: CartLine[], variantId: string, qty: number): CartLine[] {
  return normalise([...lines, { variantId, qty }]);
}

/** Setting a quantity to zero removes the line — that is what `normalise` does. */
export function setLine(lines: CartLine[], variantId: string, qty: number): CartLine[] {
  return normalise([
    ...lines.filter((l) => l.variantId !== variantId),
    { variantId, qty },
  ]);
}

export function removeLine(lines: CartLine[], variantId: string): CartLine[] {
  return lines.filter((l) => l.variantId !== variantId);
}

/**
 * Read a quantity from a form field.
 *
 * Returns 1 for anything unparseable. A customer who typed "two" wanted at
 * least one of the thing; refusing the whole request teaches them nothing.
 */
export function parseQty(raw: FormDataEntryValue | null): number {
  const n = Number(typeof raw === 'string' ? raw.trim() : NaN);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(MAX_QTY, Math.trunc(n)));
}
