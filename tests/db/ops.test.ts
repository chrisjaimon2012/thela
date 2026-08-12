import { beforeEach, describe, expect, it } from 'vitest';
import { expireUnpaid } from '../../src/lib/ops/expire';
import { alarms, health } from '../../src/lib/ops/watchdog';
import { resolve } from '../../src/lib/payments/resolve';
import { migrate, openOrder, orderStatus, seedShop, stock } from './helpers';

/**
 * The sweeper is the cheapest cron in the system and the one whose absence
 * would be noticed first — not as an error, but as "the shop says sold out and
 * the shelf is full". There are only 100 minor-unit slots per amount per
 * currency, so abandoned checkouts exhaust slots long before stock.
 *
 * Its subtlety is the race with settlement: D1 does not roll back a statement
 * that merely affects zero rows, so an order that settles between the sweeper's
 * SELECT and its UPDATE would have its stock released while the customer's
 * payment stands. That is the case worth being certain about.
 */

const past = '2020-01-01 00:00:00';

describe('expireUnpaid', () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await migrate();
    await seedShop(db);
  });

  it('cancels an expired order and gives its stock back', async () => {
    await openOrder(db, { id: 'OLD', amountMinor: 139937, qty: 3, expiresAt: past });
    expect(await stock(db)).toMatchObject({ on_hand: 10, reserved: 3 });

    const out = await expireUnpaid(db);

    expect(out.cancelled).toEqual(['OLD']);
    expect((await orderStatus(db, 'OLD'))?.status).toBe('cancelled');
    // Reserved released; on_hand untouched, because nothing was ever sold.
    expect(await stock(db)).toMatchObject({ on_hand: 10, reserved: 0 });
  });

  it('frees the minor-unit slot, which is the actual scarce resource', async () => {
    await openOrder(db, { id: 'OLD', amountMinor: 139937, expiresAt: past });
    // While it is open, nothing else can ask for that amount.
    await expect(openOrder(db, { id: 'NEW', amountMinor: 139937 })).rejects.toThrow();

    await expireUnpaid(db);

    await expect(openOrder(db, { id: 'NEW', amountMinor: 139937 })).resolves.not.toThrow();
  });

  it('leaves an order that has not expired alone', async () => {
    await openOrder(db, { id: 'FRESH', amountMinor: 139937, qty: 2 });

    const out = await expireUnpaid(db);

    expect(out.scanned).toBe(0);
    expect((await orderStatus(db, 'FRESH'))?.status).toBe('awaiting_payment');
    expect(await stock(db)).toMatchObject({ reserved: 2 });
  });

  it('never touches an order that was already paid', async () => {
    // Expired by the clock, but settled before the sweep ran. Releasing this
    // stock would take goods back from someone who paid for them.
    await openOrder(db, { id: 'PAID', amountMinor: 139937, qty: 2, expiresAt: past });
    await resolve(db, {
      source: 'statement', confidence: 'ledger', reference: 'R1',
      amountMinor: 139937, currency: 'INR', at: new Date().toISOString(),
    });
    expect(await stock(db)).toMatchObject({ on_hand: 8, reserved: 0 });

    const out = await expireUnpaid(db);

    expect(out.cancelled).toEqual([]);
    expect((await orderStatus(db, 'PAID'))?.status).toBe('paid');
    // The decrement stands and nothing was handed back.
    expect(await stock(db)).toMatchObject({ on_hand: 8, reserved: 0 });
  });

  it('releases each expired order exactly once, however often it runs', async () => {
    await openOrder(db, { id: 'A', amountMinor: 100001, qty: 2, expiresAt: past });
    await openOrder(db, { id: 'B', amountMinor: 100002, qty: 3, expiresAt: past });

    await expireUnpaid(db);
    await expireUnpaid(db);
    await expireUnpaid(db);

    // Five units back, not fifteen. A cron that double-releases would inflate
    // stock silently until the shop oversold.
    expect(await stock(db)).toMatchObject({ on_hand: 10, reserved: 0 });
  });

  it('does not drive reserved negative when stock has already moved', async () => {
    await openOrder(db, { id: 'A', amountMinor: 100001, qty: 2, expiresAt: past });
    // Something else released the reservation first — a manual correction in
    // the admin, say. The sweeper must not take it below zero and trip the
    // CHECK, which would abort the whole batch and strand the order.
    await db.prepare(`UPDATE stock_item SET reserved = 0 WHERE sku = 'blank-a'`).run();

    await expireUnpaid(db);

    expect((await orderStatus(db, 'A'))?.status).toBe('cancelled');
    expect(await stock(db)).toMatchObject({ reserved: 0 });
  });

  it('leaves an untracked item alone, since it never reserved anything', async () => {
    await db
      .prepare(`INSERT INTO variant (id, product_id, sku, option_1, price_minor)
                VALUES ('v2', 'p1', 'mto', 'Made to order', 100000)`)
      .run();
    await openOrder(db, { id: 'M', amountMinor: 100003, expiresAt: past });

    await expect(expireUnpaid(db)).resolves.toMatchObject({ cancelled: ['M'] });
  });

  it('honours its limit, so one sweep cannot run past its budget', async () => {
    for (let i = 0; i < 5; i++) {
      await openOrder(db, { id: `O${i}`, amountMinor: 200000 + i, qty: 1, expiresAt: past });
    }

    const out = await expireUnpaid(db, 2);

    expect(out.scanned).toBe(2);
    expect(out.cancelled).toHaveLength(2);
    // The rest are picked up on the next run five minutes later.
    expect((await expireUnpaid(db, 10)).cancelled).toHaveLength(3);
  });
});

describe('the dead man’s switch', () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await migrate();
    await seedShop(db);
  });

  it('says nothing about a shop where nothing is wrong', async () => {
    const h = await health(db);
    expect(alarms(h, 48)).toEqual([]);
  });

  it('raises the loudest alarm for money that arrived and matched nothing', async () => {
    // Somebody has paid and received nothing. There is no worse state.
    await resolve(db, {
      source: 'statement', confidence: 'ledger', reference: 'X1',
      amountMinor: 99999, currency: 'INR', at: new Date().toISOString(),
    });

    const raised = alarms(await health(db), 48);
    const a = raised.find((x) => x.key === 'unmatched_credits');
    expect(a?.severity).toBe('urgent');
    expect(a?.message).toMatch(/has paid and has not received/);
  });

  it('counts a held payment as waiting for the shopkeeper, not as an error', async () => {
    await openOrder(db, { id: 'O1', amountMinor: 139937 });
    await resolve(db, {
      source: 'claim', confidence: 'claimed', reference: 'C1',
      amountMinor: 139937, currency: 'INR', at: new Date().toISOString(),
    });

    const a = alarms(await health(db), 48).find((x) => x.key === 'awaiting_review');
    expect(a?.severity).toBe('warn');
    expect(a?.message).toMatch(/waiting for you to confirm/);
  });

  it('notices when bank emails stop parsing, which is how confirmations die', async () => {
    await db.batch(
      [1, 2, 3, 4].map((i) =>
        db
          .prepare(`INSERT INTO unparsed_alert (from_addr, subject, reason)
                    VALUES (?1, 'Credited', 'fields_missing')`)
          .bind(`alerts${i}@bank.example`),
      ),
    );

    const a = alarms(await health(db), 48).find((x) => x.key === 'unparsed_alerts');
    expect(a?.severity).toBe('urgent');
    expect(a?.message).toMatch(/changed the wording/);
  });

  it('writes for a shopkeeper, not for us', async () => {
    await openOrder(db, { id: 'O1', amountMinor: 139937 });
    await resolve(db, {
      source: 'claim', confidence: 'claimed', reference: 'C1',
      amountMinor: 139937, currency: 'INR', at: new Date().toISOString(),
    });

    for (const a of alarms(await health(db), 48)) {
      // No table names, no column names, no jargon. Someone woken by this at
      // 7am has to know what to do without reading the source.
      expect(a.message).not.toMatch(/credit_evidence|payment_event|NULL|SQL|D1/);
      expect(a.message.length).toBeGreaterThan(30);
    }
  });
});
