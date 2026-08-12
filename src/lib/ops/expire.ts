/**
 * Release orders that were never paid.
 *
 * An unpaid order holds two scarce things: reserved stock, and its minor-unit
 * slot. There are only 100 slots per amount per currency, so a shop that sells
 * the same item repeatedly runs out of slots long before it runs out of stock,
 * and every abandoned checkout is one fewer customer who can buy that thing.
 *
 * This is the cheapest cron in the system and the one whose absence would be
 * noticed first — not as an error, but as "the shop says sold out and the shelf
 * is full".
 */

export interface Expired {
  scanned: number;
  cancelled: string[];
}

/**
 * Cancel everything past its hold and give back what it was holding.
 *
 * Per order, not in one sweeping UPDATE, and deliberately so: releasing stock
 * requires the order's own lines, and a partial failure on one order must not
 * take the others down with it. A stuck order is a support ticket; a sweeper
 * that dies on the first bad row is a shop that silently stops selling.
 */
export async function expireUnpaid(db: D1Database, limit = 50): Promise<Expired> {
  const { results: due } = await db
    .prepare(
      `SELECT id FROM orders
        WHERE status = 'awaiting_payment' AND expires_at <= datetime('now')
        ORDER BY expires_at
        LIMIT ?1`,
    )
    .bind(limit)
    .all<{ id: string }>();

  const cancelled: string[] = [];

  for (const { id } of due) {
    const { results: lines } = await db
      .prepare(`SELECT sku, qty FROM order_item WHERE order_id = ?1`)
      .bind(id)
      .all<{ sku: string; qty: number }>();

    try {
      await db.batch([
        // Status first. It is the guard: if another path settled this order
        // between the SELECT above and now, this matches zero rows — and,
        // because D1 does not roll back on zero rows, the releases below would
        // still run and hand back stock the customer has already paid for.
        // Hence the re-check immediately after, and the throw.
        db
          .prepare(
            `UPDATE orders SET status = 'cancelled'
              WHERE id = ?1 AND status = 'awaiting_payment'`,
          )
          .bind(id),
        ...lines.map((l) =>
          db
            .prepare(
              `UPDATE stock_item
                  SET reserved   = CASE WHEN tracked = 1
                                        THEN MAX(0, reserved - ?2) ELSE reserved END,
                      updated_at = datetime('now')
                WHERE sku = ?1`,
            )
            .bind(l.sku, l.qty),
        ),
      ]);

      const now = await db
        .prepare(`SELECT status FROM orders WHERE id = ?1`)
        .bind(id)
        .first<{ status: string }>();

      if (now?.status !== 'cancelled') {
        // It settled underneath us. The stock release above already ran, so
        // put it back rather than leaving the count short.
        await db.batch(
          lines.map((l) =>
            db
              .prepare(
                `UPDATE stock_item
                    SET reserved = CASE WHEN tracked = 1 THEN reserved + ?2 ELSE reserved END
                  WHERE sku = ?1`,
              )
              .bind(l.sku, l.qty),
          ),
        );
        continue;
      }

      cancelled.push(id);
    } catch {
      // One bad order must not stop the sweep. It stays awaiting_payment and
      // is retried in five minutes; if it is genuinely stuck, the watchdog
      // notices the growing backlog.
      continue;
    }
  }

  return { scanned: due.length, cancelled };
}
