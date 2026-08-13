import { beforeEach, describe, expect, it } from 'vitest';
import { issueCode, redeemCode, revokeAllCredentials } from '../../src/lib/admin/recovery';
import { migrate } from './helpers';

/**
 * Recovery is the sharp edge of choosing passkeys.
 *
 * It is the one path that hands out a session without one, so it is also the
 * most attractive thing in the admin to attack. And it is the path a volunteer
 * with a drowned phone depends on completely — there is no password to fall
 * back on, so "mostly works" means "locked out of your own shop while orders
 * arrive".
 */

async function admin(db: D1Database, email = 'owner@example.com'): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO admin_user (id, email, name, role) VALUES (?1, ?2, 'Owner', 'owner')`)
    .bind(id, email)
    .run();
  return id;
}

describe('issueCode', () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await migrate();
  });

  it('mints a code an ordinary person can read off a screen and retype', async () => {
    await admin(db);
    const issued = await issueCode(db, 'owner@example.com');

    expect(issued?.code).toHaveLength(8);
    // No 0/O, no 1/I/L. The characters people confuse are exactly the ones that
    // turn a working code into "it says the code is wrong".
    expect(issued?.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  });

  it('never stores the code itself', async () => {
    await admin(db);
    const issued = await issueCode(db, 'owner@example.com');

    const row = await db
      .prepare(`SELECT code_hash FROM admin_recovery`)
      .first<{ code_hash: string }>();

    // A code in plain text is a password that expires — worse than a password,
    // because nobody thinks to rotate it after a leaked backup.
    expect(row?.code_hash).not.toBe(issued?.code);
    expect(row?.code_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns nothing for an address that is not an admin', async () => {
    await admin(db);
    expect(await issueCode(db, 'nobody@example.com')).toBeNull();
  });

  it('is not case-sensitive about the address', async () => {
    await admin(db, 'Owner@Example.com');
    expect(await issueCode(db, 'owner@example.COM')).not.toBeNull();
  });

  it('stops after three requests in an hour', async () => {
    await admin(db);
    expect(await issueCode(db, 'owner@example.com')).not.toBeNull();
    expect(await issueCode(db, 'owner@example.com')).not.toBeNull();
    expect(await issueCode(db, 'owner@example.com')).not.toBeNull();
    // Enough for a fumbled attempt, not enough to farm codes out of a mailbox
    // somebody else has access to.
    expect(await issueCode(db, 'owner@example.com')).toBeNull();
  });

  it('gives every code a different value', async () => {
    await admin(db);
    const codes = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const issued = await issueCode(db, 'owner@example.com');
      if (issued) codes.add(issued.code);
    }
    expect(codes.size).toBe(3);
  });
});

describe('redeemCode', () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await migrate();
  });

  it('accepts a fresh code once', async () => {
    const id = await admin(db);
    const issued = await issueCode(db, 'owner@example.com');

    const redeemed = await redeemCode(db, issued!.code);
    expect(redeemed).toMatchObject({ userId: id, email: 'owner@example.com' });
  });

  it('forgives the case and spacing somebody types', async () => {
    await admin(db);
    const issued = await issueCode(db, 'owner@example.com');
    expect(await redeemCode(db, `  ${issued!.code.toLowerCase()}  `)).not.toBeNull();
  });

  it('refuses the same code a second time', async () => {
    await admin(db);
    const issued = await issueCode(db, 'owner@example.com');

    expect(await redeemCode(db, issued!.code)).not.toBeNull();
    // Single use. Otherwise a code lingering in a mailbox is a permanent key.
    expect(await redeemCode(db, issued!.code)).toBeNull();
  });

  it('refuses an expired code', async () => {
    await admin(db);
    const issued = await issueCode(db, 'owner@example.com');
    await db
      .prepare(`UPDATE admin_recovery SET expires_at = datetime('now', '-1 minute')`)
      .run();

    expect(await redeemCode(db, issued!.code)).toBeNull();
  });

  it('refuses a code that was never issued', async () => {
    await admin(db);
    expect(await redeemCode(db, 'ABCD2345')).toBeNull();
  });

  it('lets only one of two racing redemptions win', async () => {
    await admin(db);
    const issued = await issueCode(db, 'owner@example.com');

    const [a, b] = await Promise.all([
      redeemCode(db, issued!.code),
      redeemCode(db, issued!.code),
    ]);

    // Two browsers, one code. Exactly one gets a session.
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
});

describe('revokeAllCredentials', () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await migrate();
  });

  it('removes every passkey on the account and no other', async () => {
    const mine = await admin(db, 'mine@example.com');
    const theirs = await admin(db, 'theirs@example.com');

    await db.batch([
      db.prepare(`INSERT INTO admin_credential (id, user_id, public_key, algorithm)
                  VALUES ('a', ?1, 'k', -7)`).bind(mine),
      db.prepare(`INSERT INTO admin_credential (id, user_id, public_key, algorithm)
                  VALUES ('b', ?1, 'k', -7)`).bind(mine),
      db.prepare(`INSERT INTO admin_credential (id, user_id, public_key, algorithm)
                  VALUES ('c', ?1, 'k', -7)`).bind(theirs),
    ]);

    expect(await revokeAllCredentials(db, mine, 'mine@example.com')).toBe(2);

    const left = await db
      .prepare(`SELECT id FROM admin_credential`)
      .all<{ id: string }>();
    expect(left.results.map((r) => r.id)).toEqual(['c']);
  });
});
