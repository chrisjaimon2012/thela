/**
 * Who is signed in, and how we know.
 *
 * Three ways in, in priority order:
 *
 *   1. **Cloudflare Access.** If a shop has put Access in front of `/admin`,
 *      the request never reaches us unauthenticated and carries a verified
 *      email header. That costs zero Worker CPU and is the right answer for a
 *      shop with several staff — but it needs a Zero Trust org, an application
 *      and a policy, none of which the Deploy button can provision, so it
 *      cannot be the default (ADR-0021).
 *   2. **A passkey**, verified once, then a signed session cookie. The default.
 *   3. **A one-time recovery code**, when every passkey is gone.
 *
 * There is no password anywhere, at any iteration count. See ADR-0022 — it is
 * a CPU-budget measurement, not a preference.
 */

import type { AstroCookies } from 'astro';
import { fromB64url, toB64url } from './webauthn';

export const SESSION_COOKIE = 'thela_admin';
export const CHALLENGE_COOKIE = 'thela_ceremony';

/** Eight hours: a working day, then sign in again. */
const SESSION_TTL_S = 8 * 60 * 60;
/** A WebAuthn ceremony is seconds of work. Two minutes is already generous. */
const CHALLENGE_TTL_S = 120;

export interface Admin {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'staff';
  /** How this request proved who it was. Recorded in the audit trail. */
  via: 'access' | 'passkey' | 'recovery';
}

// ---------------------------------------------------------------------------
// Signed cookies
// ---------------------------------------------------------------------------

const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let k = keyCache.get(secret);
  if (!k) {
    k = crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );
    keyCache.set(secret, k);
  }
  return k;
}

/**
 * Sign a payload with an expiry baked in.
 *
 * The expiry is INSIDE the signature, not just in the cookie's Max-Age. A
 * cookie's own expiry is a request from us to the browser and nothing more —
 * anyone can keep sending an expired one.
 */
async function sign(payload: object, secret: string, ttlSeconds: number): Promise<string> {
  const body = JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds });
  const bytes = new TextEncoder().encode(body);
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), bytes);
  return `${toB64url(bytes)}.${toB64url(new Uint8Array(sig))}`;
}

async function open<T>(token: string | undefined, secret: string): Promise<T | null> {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;

  try {
    const bytes = fromB64url(token.slice(0, dot));
    const sig = fromB64url(token.slice(dot + 1));

    // crypto.subtle.verify is constant-time; comparing the strings would not be.
    if (!(await crypto.subtle.verify('HMAC', await hmacKey(secret), sig, bytes))) return null;

    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as T & { exp?: number };
    if (typeof parsed.exp !== 'number' || parsed.exp < Date.now() / 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

const cookieOptions = (secure: boolean, maxAge: number) =>
  ({
    path: '/',
    httpOnly: true,
    // Strict, unlike the cart. Nothing should ever navigate INTO the admin from
    // another site, so there is no reason to send this cookie cross-site.
    sameSite: 'strict' as const,
    secure,
    maxAge,
  });

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

interface SessionPayload {
  uid: string;
  via: Admin['via'];
}

export async function startSession(
  cookies: AstroCookies,
  secret: string,
  userId: string,
  via: Admin['via'],
  secure: boolean,
): Promise<void> {
  cookies.set(
    SESSION_COOKIE,
    await sign({ uid: userId, via } satisfies SessionPayload, secret, SESSION_TTL_S),
    cookieOptions(secure, SESSION_TTL_S),
  );
}

export function endSession(cookies: AstroCookies): void {
  cookies.delete(SESSION_COOKIE, { path: '/' });
}

/**
 * Resolve the signed-in admin, or null.
 *
 * Access is checked first and short-circuits: if the platform has already
 * authenticated this request there is nothing for us to verify and no reason to
 * spend CPU doing it again.
 */
export async function currentAdmin(
  db: D1Database,
  cookies: AstroCookies,
  request: Request,
  secret: string | undefined,
): Promise<Admin | null> {
  const accessEmail = request.headers.get('cf-access-authenticated-user-email');
  if (accessEmail) {
    const user = await userByEmail(db, accessEmail);
    // A verified Access identity that is not an admin here is not an error —
    // it is somebody in the organisation who has no business in this shop.
    return user ? { ...user, via: 'access' } : null;
  }

  if (!secret) return null;

  const session = await open<SessionPayload>(cookies.get(SESSION_COOKIE)?.value, secret);
  if (!session) return null;

  const user = await userById(db, session.uid);
  return user ? { ...user, via: session.via } : null;
}

// ---------------------------------------------------------------------------
// Ceremony challenges
// ---------------------------------------------------------------------------

interface ChallengePayload {
  challenge: string;
  purpose: 'register' | 'login';
  /** Present when registering onto an existing account. */
  uid?: string;
  /**
   * Carried from `start` to `finish` rather than re-sent by the client.
   *
   * `start` is where the setup token is checked and the address validated, so
   * letting `finish` take an email from its own request body would mean the
   * token gated one identity and a different one got created.
   */
  email?: string;
  name?: string;
  /** Answered at `start`, applied at `finish`. See the note above. */
  shop?: { name: string; country: string; currency: string };
}

/**
 * Hold the challenge in a signed cookie rather than a table.
 *
 * A challenge is single-use and lives for two minutes. Putting it in D1 would
 * mean a write on every visit to the login page — the most-hit admin route —
 * plus a sweeper for the ones nobody completes. The cookie costs nothing and
 * expires by itself.
 */
export async function issueChallenge(
  cookies: AstroCookies,
  secret: string,
  challenge: string,
  purpose: ChallengePayload['purpose'],
  secure: boolean,
  carry: {
    uid?: string;
    email?: string;
    name?: string;
    shop?: { name: string; country: string; currency: string };
  } = {},
): Promise<void> {
  cookies.set(
    CHALLENGE_COOKIE,
    await sign({ challenge, purpose, ...carry } satisfies ChallengePayload, secret, CHALLENGE_TTL_S),
    cookieOptions(secure, CHALLENGE_TTL_S),
  );
}

export type { ChallengePayload };

export async function takeChallenge(
  cookies: AstroCookies,
  secret: string,
  purpose: ChallengePayload['purpose'],
): Promise<ChallengePayload | null> {
  const payload = await open<ChallengePayload>(cookies.get(CHALLENGE_COOKIE)?.value, secret);
  // Single use, whatever the outcome. Deleted before the caller can fail in a
  // way that would leave it replayable.
  cookies.delete(CHALLENGE_COOKIE, { path: '/' });
  return payload && payload.purpose === purpose ? payload : null;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type UserRow = { id: string; email: string; name: string; role: 'owner' | 'staff' };

const userById = (db: D1Database, id: string) =>
  db.prepare(`SELECT id, email, name, role FROM admin_user WHERE id = ?1`).bind(id).first<UserRow>();

const userByEmail = (db: D1Database, email: string) =>
  db
    .prepare(`SELECT id, email, name, role FROM admin_user WHERE email = ?1 COLLATE NOCASE`)
    .bind(email)
    .first<UserRow>();

/** True before anybody has claimed this shop. Gates the setup wizard. */
export async function isUnclaimed(db: D1Database): Promise<boolean> {
  const row = await db.prepare(`SELECT count(*) AS n FROM admin_user`).first<{ n: number }>();
  return (row?.n ?? 0) === 0;
}

export async function createOwner(
  db: D1Database,
  user: { id: string; email: string; name: string },
): Promise<void> {
  await db
    .prepare(`INSERT INTO admin_user (id, email, name, role) VALUES (?1, ?2, ?3, 'owner')`)
    .bind(user.id, user.email.trim(), user.name.trim())
    .run();
}

export interface CredentialRow {
  id: string;
  userId: string;
  publicKey: string;
  algorithm: number;
  signCount: number;
}

export const credentialById = (db: D1Database, id: string) =>
  db
    .prepare(
      `SELECT id, user_id AS userId, public_key AS publicKey,
              algorithm, sign_count AS signCount
         FROM admin_credential WHERE id = ?1`,
    )
    .bind(id)
    .first<CredentialRow>();

export async function saveCredential(
  db: D1Database,
  c: CredentialRow & { label?: string; transports?: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO admin_credential
         (id, user_id, public_key, algorithm, sign_count, label, transports)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(
      c.id, c.userId, c.publicKey, c.algorithm, c.signCount,
      c.label ?? '', c.transports ?? '',
    )
    .run();
}

/**
 * Record the counter and the sighting.
 *
 * Guarded on the counter not going backwards, so a replayed assertion cannot
 * quietly rewind it and make the next genuine login look like a clone.
 */
export const touchCredential = (db: D1Database, id: string, signCount: number) =>
  db
    .prepare(
      `UPDATE admin_credential
          SET sign_count = MAX(sign_count, ?2), last_used_at = datetime('now')
        WHERE id = ?1`,
    )
    .bind(id, signCount)
    .run();

/** Append-only. The first thing anyone wants when an order was marked paid and nobody remembers doing it. */
export const audit = (
  db: D1Database,
  actor: string,
  action: string,
  subject?: string,
  detail?: string,
) =>
  db
    .prepare(`INSERT INTO admin_action (actor, action, subject, detail) VALUES (?1, ?2, ?3, ?4)`)
    .bind(actor, action, subject ?? null, detail ?? null)
    .run();

export const isSecure = (request: Request): boolean =>
  new URL(request.url).protocol === 'https:';

/**
 * The relying party this shop is, derived from the request.
 *
 * Taken from the request rather than a setting deliberately: a passkey is bound
 * to the origin it was created on, so a mismatch between a configured value and
 * the actual hostname produces credentials that register and then never work.
 * The request cannot be wrong about where it arrived.
 */
export function relyingParty(request: Request): { origin: string; rpId: string } {
  const url = new URL(request.url);
  return { origin: url.origin, rpId: url.hostname };
}
