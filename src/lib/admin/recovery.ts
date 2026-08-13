/**
 * Getting back in when every passkey is gone.
 *
 * This is the sharp edge of choosing passkeys (ADR-0022). A volunteer whose
 * phone is in a river has no password to fall back on, and if this does not
 * work they are locked out of their own shop with orders arriving.
 *
 * It is also the most attractive thing in the admin to attack, because it is
 * the one path that hands out a session without a passkey. So: short-lived,
 * single-use, hashed at rest, rate-limited, and it does not by itself let
 * anybody in — it lets them REGISTER A NEW PASSKEY, and the session it grants
 * says `via: 'recovery'` so an audit trail can tell the two apart.
 */

import { audit } from './auth';

/**
 * No 0/O, no 1/I/L. A shopkeeper is going to read this off a phone screen and
 * type it on a laptop, and the characters people confuse are the ones that turn
 * a working code into "it says the code is wrong".
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

/** Long enough to fetch a phone, short enough that a leaked email ages out. */
const TTL_MINUTES = 20;

/** Per address, per hour. Enough for a fumbled attempt, not enough to farm. */
const MAX_PER_HOUR = 3;

export interface Issued {
  /** Only ever returned here. What is stored is its hash. */
  code: string;
  expiresAt: string;
}

/**
 * Mint a code, or refuse because too many have been asked for.
 *
 * Returns null when the address is not an admin — and the CALLER must not
 * reveal which case it was. "If that address belongs to an admin, a code is on
 * its way" is the only safe wording, because anything else turns this into a
 * way to test whether a person runs a shop.
 */
export async function issueCode(db: D1Database, email: string): Promise<Issued | null> {
  const user = await db
    .prepare(`SELECT id FROM admin_user WHERE email = ?1 COLLATE NOCASE`)
    .bind(email.trim())
    .first<{ id: string }>();
  if (!user) return null;

  const recent = await db
    .prepare(
      `SELECT count(*) AS n FROM admin_recovery
        WHERE user_id = ?1 AND created_at > datetime('now', '-1 hour')`,
    )
    .bind(user.id)
    .first<{ n: number }>();

  if ((recent?.n ?? 0) >= MAX_PER_HOUR) return null;

  const code = Array.from(crypto.getRandomValues(new Uint8Array(CODE_LENGTH)))
    // Modulo bias here is irrelevant: the alphabet is 31 characters against 256,
    // and the code lives for twenty minutes behind a three-per-hour cap.
    .map((b) => ALPHABET[b % ALPHABET.length])
    .join('');

  // Only the hash is stored. A code sitting in plain text is a password that
  // expires — worse than a password, because nobody thinks to rotate it after a
  // leaked backup.
  await db
    .prepare(
      `INSERT INTO admin_recovery (code_hash, user_id, expires_at)
       VALUES (?1, ?2, datetime('now', '+${TTL_MINUTES} minutes'))`,
    )
    .bind(await sha256(code), user.id)
    .run();

  await audit(db, email, 'recovery.requested', user.id);

  return { code, expiresAt: `${TTL_MINUTES} minutes` };
}

export interface Redeemed {
  userId: string;
  email: string;
}

/**
 * Spend a code.
 *
 * Marked used before anything else happens, so two browsers racing the same
 * code cannot both get in. A code that is expired, already spent, or simply
 * wrong is one indistinguishable answer.
 */
export async function redeemCode(db: D1Database, code: string): Promise<Redeemed | null> {
  const hash = await sha256(code.trim().toUpperCase());

  const row = await db
    .prepare(
      `SELECT r.user_id AS userId, u.email
         FROM admin_recovery r JOIN admin_user u ON u.id = r.user_id
        WHERE r.code_hash = ?1 AND r.used_at IS NULL AND r.expires_at > datetime('now')`,
    )
    .bind(hash)
    .first<Redeemed>();

  if (!row) return null;

  const spent = await db
    .prepare(`UPDATE admin_recovery SET used_at = datetime('now')
               WHERE code_hash = ?1 AND used_at IS NULL`)
    .bind(hash)
    .run();

  // Somebody else spent it between the SELECT and the UPDATE.
  if (spent.meta.changes === 0) return null;

  await audit(db, row.email, 'recovery.used', row.userId);
  return row;
}

/**
 * Retire every passkey on an account.
 *
 * Offered after a successful recovery, because the usual reason for being here
 * is that a device is gone — and a passkey on a phone somebody else now has is
 * a passkey somebody else now has. Deliberately a choice rather than automatic:
 * the other reason for being here is a laptop left at the office, and wiping
 * its passkey would turn an inconvenience into an afternoon.
 */
export async function revokeAllCredentials(
  db: D1Database,
  userId: string,
  actor: string,
): Promise<number> {
  const res = await db
    .prepare(`DELETE FROM admin_credential WHERE user_id = ?1`)
    .bind(userId)
    .run();

  await audit(db, actor, 'recovery.revoked_all', userId, `${res.meta.changes} removed`);
  return res.meta.changes ?? 0;
}

export const recoveryEmail = (code: string, shopName: string) => ({
  subject: `Your ${shopName} sign-in code`,
  text:
    `Somebody asked to get back into the admin for ${shopName}.\n\n` +
    `    ${code}\n\n` +
    `It works once, and only for the next ${TTL_MINUTES} minutes.\n\n` +
    `If that was not you, you can ignore this — the code is useless without\n` +
    `access to this mailbox, and nothing has changed on your shop.\n`,
});

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
