/**
 * Adding and removing the handful of people who run a shop.
 *
 * Not a user-management system. The entire need is three operations — invite,
 * list, revoke — and a small shop has between one and five people. Adopting an
 * auth framework to get them would mean inheriting its schema, its migrations
 * and its idea of what a user is, for three routes.
 *
 * An invitation is not an email with a link. It is a row: an address the owner
 * has allowed, which that person then claims by registering their own passkey,
 * or which Cloudflare Access matches against if the shop uses it. So the same
 * list serves both authentication paths, and revoking works for both at once.
 */

import { audit } from './auth';

export interface Person {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'staff';
  createdAt: string;
  lastSeen: string | null;
  /** How many passkeys they hold. Zero means they have not signed in yet. */
  passkeys: number;
}

export const listPeople = (db: D1Database) =>
  db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role,
              u.created_at AS createdAt, u.last_seen AS lastSeen,
              (SELECT count(*) FROM admin_credential c WHERE c.user_id = u.id) AS passkeys
         FROM admin_user u
        ORDER BY u.role, u.created_at`,
    )
    .all<Person>()
    .then((r) => r.results);

export interface InviteResult {
  ok: boolean;
  why?: string;
}

export async function invite(
  db: D1Database,
  email: string,
  role: 'owner' | 'staff',
  actor: string,
): Promise<InviteResult> {
  const address = email.trim();
  if (!address.includes('@')) return { ok: false, why: 'That does not look like an email address.' };

  try {
    await db
      .prepare(`INSERT INTO admin_user (id, email, name, role) VALUES (?1, ?2, '', ?3)`)
      .bind(crypto.randomUUID(), address, role)
      .run();
  } catch {
    return { ok: false, why: 'That address is already on the list.' };
  }

  await audit(db, actor, 'people.invited', address, role);
  return { ok: true };
}

/**
 * Remove somebody, and their passkeys with them.
 *
 * `ON DELETE CASCADE` on admin_credential does the second part, which matters:
 * leaving a credential behind would mean a revoked person could still sign in
 * until somebody noticed the orphan.
 */
export async function revoke(db: D1Database, id: string, actor: string): Promise<InviteResult> {
  const person = await db
    .prepare(`SELECT email, role FROM admin_user WHERE id = ?1`)
    .bind(id)
    .first<{ email: string; role: string }>();

  if (!person) return { ok: false, why: 'That person is not on the list.' };

  // A shop with no owner is a shop nobody can configure, and no amount of
  // recovery gets it back — there is no account left to recover into.
  if (person.role === 'owner') {
    const owners = await db
      .prepare(`SELECT count(*) AS n FROM admin_user WHERE role = 'owner'`)
      .first<{ n: number }>();
    if ((owners?.n ?? 0) <= 1) {
      return { ok: false, why: 'This is the only owner. Make somebody else an owner first.' };
    }
  }

  await db.prepare(`DELETE FROM admin_user WHERE id = ?1`).bind(id).run();
  await audit(db, actor, 'people.revoked', person.email, person.role);
  return { ok: true };
}

export async function setRole(
  db: D1Database,
  id: string,
  role: 'owner' | 'staff',
  actor: string,
): Promise<InviteResult> {
  if (role === 'staff') {
    const person = await db
      .prepare(`SELECT role FROM admin_user WHERE id = ?1`)
      .bind(id)
      .first<{ role: string }>();

    if (person?.role === 'owner') {
      const owners = await db
        .prepare(`SELECT count(*) AS n FROM admin_user WHERE role = 'owner'`)
        .first<{ n: number }>();
      if ((owners?.n ?? 0) <= 1) {
        return { ok: false, why: 'This is the only owner. Promote somebody else first.' };
      }
    }
  }

  await db.prepare(`UPDATE admin_user SET role = ?2 WHERE id = ?1`).bind(id, role).run();
  await audit(db, actor, 'people.role_changed', id, role);
  return { ok: true };
}
