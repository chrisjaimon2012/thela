import { beforeEach, describe, expect, it } from 'vitest';
import { invite, listPeople, revoke, setRole } from '../../src/lib/admin/people';
import { migrate } from './helpers';

/**
 * A small shop's whole user-management need, and the one way it can go
 * irrecoverably wrong: removing the last owner. There is no account left to
 * recover into, so no amount of email recovery gets the shop back — somebody
 * would have to edit D1 by hand.
 */

const owner = async (db: D1Database, email = 'owner@shop.example') => {
  const id = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO admin_user (id, email, name, role) VALUES (?1, ?2, 'O', 'owner')`)
    .bind(id, email)
    .run();
  return id;
};

describe('people', () => {
  let db: D1Database;
  beforeEach(async () => { db = await migrate(); });

  it('invites somebody as staff by default', async () => {
    await owner(db);
    expect(await invite(db, 'volunteer@shop.example', 'staff', 'owner@shop.example')).toEqual({ ok: true });

    const people = await listPeople(db);
    expect(people).toHaveLength(2);
    const invited = people.find((p) => p.email === 'volunteer@shop.example');
    expect(invited?.role).toBe('staff');
    // Not signed in yet — the invitation is a row, not an email with a link.
    expect(invited?.passkeys).toBe(0);
  });

  it('refuses a duplicate address', async () => {
    await owner(db);
    await invite(db, 'v@shop.example', 'staff', 'owner@shop.example');
    expect(await invite(db, 'v@shop.example', 'staff', 'owner@shop.example'))
      .toMatchObject({ ok: false });
  });

  it('takes their passkeys away when it takes their access away', async () => {
    const id = await owner(db, 'a@shop.example');
    await owner(db, 'b@shop.example');
    await db
      .prepare(`INSERT INTO admin_credential (id, user_id, public_key, algorithm)
                VALUES ('cred', ?1, 'k', -7)`)
      .bind(id)
      .run();

    expect(await revoke(db, id, 'b@shop.example')).toEqual({ ok: true });

    // A credential left behind is a revoked person who can still sign in.
    const left = await db
      .prepare(`SELECT count(*) AS n FROM admin_credential WHERE user_id = ?1`)
      .bind(id)
      .first<{ n: number }>();
    expect(left?.n).toBe(0);
  });

  it('refuses to remove the last owner', async () => {
    const id = await owner(db);
    await invite(db, 'staff@shop.example', 'staff', 'owner@shop.example');

    // Staff present, but no other OWNER. Removing this one leaves a shop
    // nobody can configure and nobody can recover into.
    const result = await revoke(db, id, 'owner@shop.example');
    expect(result.ok).toBe(false);
    expect(result.why).toMatch(/only owner/i);
    expect(await listPeople(db)).toHaveLength(2);
  });

  it('allows removing an owner once there are two', async () => {
    const a = await owner(db, 'a@shop.example');
    await owner(db, 'b@shop.example');
    expect(await revoke(db, a, 'b@shop.example')).toEqual({ ok: true });
  });

  it('refuses to demote the last owner', async () => {
    const id = await owner(db);
    const result = await setRole(db, id, 'staff', 'owner@shop.example');
    expect(result.ok).toBe(false);
    expect(result.why).toMatch(/only owner/i);
  });

  it('records who did what', async () => {
    await owner(db);
    await invite(db, 'v@shop.example', 'staff', 'owner@shop.example');

    const row = await db
      .prepare(`SELECT actor, action, subject FROM admin_action ORDER BY id DESC LIMIT 1`)
      .first<{ actor: string; action: string; subject: string }>();
    expect(row).toMatchObject({
      actor: 'owner@shop.example',
      action: 'people.invited',
      subject: 'v@shop.example',
    });
  });
});
