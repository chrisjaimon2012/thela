/**
 * The cart is a signed cookie. There is no server-side session.
 *
 * WHY NOT A ROW IN D1
 *
 * An anonymous cart in the database means a write on every "add to cart" — the
 * single most-clicked button in a shop — against a free-tier budget of 100,000
 * writes a day, plus a sweeper for the carts nobody ever checks out. A cookie
 * costs nothing, expires by itself, and survives a Worker with no state at all.
 *
 * WHAT THE SIGNATURE IS FOR, AND WHAT IT IS NOT
 *
 * It detects tampering and corruption. It is NOT an authorisation boundary,
 * because there is nothing here to authorise: a forged cookie can only put
 * items in the forger's own cart, which the "Add to cart" button also does.
 * Prices and availability are read from D1 on every render and again at
 * checkout (`priceLines`), so no number the customer holds is ever trusted.
 *
 * That distinction decides where the key lives. This one is generated into the
 * `setting` table on first use, so a one-click deploy needs no terminal step.
 * Admin sessions are a real authorisation boundary and use `SESSION_SECRET`,
 * a Worker secret, which is a different key for a different job.
 *
 * SIZE
 *
 * Browsers cap a cookie at about 4 KB. Lines are `[variantId, qty]` pairs and
 * variant ids are short, so MAX_LINES of 40 leaves generous headroom. The cap
 * is enforced on write, not hoped for.
 */

export const CART_COOKIE = 'thela_cart';

export const MAX_LINES = 40;
export const MAX_QTY = 99;

const KEY_SETTING = 'security.cart_key';
const SIG_BYTES = 32;

export interface CartLine {
  variantId: string;
  qty: number;
}

/**
 * Imported `CryptoKey`s, cached for the life of the isolate.
 *
 * `importKey` is not free and the key never changes. Keyed by the raw secret so
 * a rotated key is picked up rather than served stale from a warm isolate.
 */
const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(raw: string): Promise<CryptoKey> {
  let k = keyCache.get(raw);
  if (!k) {
    k = crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(raw),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );
    keyCache.set(raw, k);
  }
  return k;
}

/**
 * The cart signing key, generated on first use.
 *
 * `INSERT OR IGNORE` then re-read, rather than read-then-insert: two concurrent
 * first requests would otherwise generate two keys and each invalidate the
 * other's carts. The insert decides; whoever loses reads the winner's key.
 */
export async function cartKey(db: D1Database): Promise<string> {
  const existing = await db
    .prepare(`SELECT value FROM setting WHERE key = ?1`)
    .bind(KEY_SETTING)
    .first<{ value: string }>();
  if (existing?.value) return existing.value;

  const generated = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await db
    .prepare(`INSERT OR IGNORE INTO setting (key, value) VALUES (?1, ?2)`)
    .bind(KEY_SETTING, generated)
    .run();

  const settled = await db
    .prepare(`SELECT value FROM setting WHERE key = ?1`)
    .bind(KEY_SETTING)
    .first<{ value: string }>();
  return settled?.value ?? generated;
}

export async function encodeCart(lines: CartLine[], key: string): Promise<string> {
  // Tuples, not objects: `[["v1",2]]` against `[{"variantId":"v1","qty":2}]` is
  // a third of the bytes, and the cookie budget is the binding constraint.
  const payload = JSON.stringify(lines.map((l) => [l.variantId, l.qty]));
  const bytes = new TextEncoder().encode(payload);
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(key), bytes);
  return `${b64url(bytes)}.${b64url(new Uint8Array(sig))}`;
}

/**
 * Decode and verify. Any failure — bad signature, truncated cookie, a shape
 * that is not what we wrote — returns an empty cart.
 *
 * An unreadable cart must never be an error page. The customer loses items they
 * can add again; a 500 loses the sale.
 */
export async function decodeCart(raw: string | undefined, key: string): Promise<CartLine[]> {
  if (!raw) return [];

  const dot = raw.indexOf('.');
  if (dot < 1) return [];

  try {
    const bytes = unb64url(raw.slice(0, dot));
    const sig = unb64url(raw.slice(dot + 1));
    if (sig.length !== SIG_BYTES) return [];

    // `crypto.subtle.verify` is constant-time. Comparing signature strings
    // ourselves would not be.
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(key), sig, bytes);
    if (!ok) return [];

    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(parsed)) return [];

    return normalise(
      parsed.flatMap((entry) => {
        if (!Array.isArray(entry) || entry.length !== 2) return [];
        const [id, qty] = entry as [unknown, unknown];
        if (typeof id !== 'string' || !id) return [];
        if (typeof qty !== 'number' || !Number.isInteger(qty)) return [];
        return [{ variantId: id, qty }];
      }),
    );
  } catch {
    return [];
  }
}

/**
 * The one place cart shape is enforced: quantities clamped, duplicates merged,
 * zero-or-less dropped, and the line count capped.
 *
 * Every mutation runs through this, so an endpoint cannot forget a bound.
 */
export function normalise(lines: CartLine[]): CartLine[] {
  const merged = new Map<string, number>();
  for (const l of lines) {
    const qty = Math.min(MAX_QTY, Math.trunc(l.qty));
    if (qty <= 0) continue;
    merged.set(l.variantId, Math.min(MAX_QTY, (merged.get(l.variantId) ?? 0) + qty));
  }
  return [...merged].slice(0, MAX_LINES).map(([variantId, qty]) => ({ variantId, qty }));
}

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// `Uint8Array<ArrayBuffer>`, not a bare `Uint8Array`. Since TypeScript 5.7 the
// typed arrays are generic over their backing buffer, and the bare form widens
// to `ArrayBufferLike` — which includes SharedArrayBuffer and so is rejected
// by every WebCrypto signature.
const unb64url = (s: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(
    atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')),
    (c) => c.charCodeAt(0),
  );
