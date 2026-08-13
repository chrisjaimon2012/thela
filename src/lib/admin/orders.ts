/**
 * Order reads for the admin.
 *
 * Every SQL statement about orders lives here; pages never write SQL. Same rule
 * as the catalogue, and for the same reason — the awkward parts (what counts as
 * needing attention, what a review queue actually contains) belong in one place.
 */

import type { Minor } from '../payments/types';

export type OrderStatus =
  | 'awaiting_payment' | 'paid' | 'packed' | 'shipped'
  | 'delivered' | 'cancelled' | 'refunded';

export interface OrderRow {
  id: string;
  status: OrderStatus;
  currency: string;
  amountDueMinor: Minor;
  customerName: string;
  customerEmail: string;
  fulfilment: 'pickup' | 'carrier' | 'digital';
  createdAt: string;
  paidAt: string | null;
  expiresAt: string;
  itemCount: number;
  /** Set once dispatched. Null means it has not shipped. */
  tracking: string | null;
}

/**
 * The list, newest first.
 *
 * `awaiting_payment` rows that have already expired are excluded rather than
 * shown greyed out: the sweeper cancels them within five minutes, and a list
 * that shows rows about to vanish teaches a shopkeeper to distrust it.
 */
export async function listOrders(
  db: D1Database,
  opts: { status?: OrderStatus | 'attention'; limit?: number } = {},
): Promise<OrderRow[]> {
  const limit = Math.min(opts.limit ?? 50, 200);

  const where =
    opts.status === 'attention'
      ? `(o.status = 'paid' OR (o.status = 'awaiting_payment' AND o.expires_at > datetime('now')))`
      : opts.status
        ? `o.status = ?2`
        : `NOT (o.status = 'awaiting_payment' AND o.expires_at <= datetime('now'))`;

  const stmt = db.prepare(
    `SELECT o.id, o.status, o.currency,
            o.amount_due_minor AS amountDueMinor,
            o.customer_name    AS customerName,
            o.customer_email   AS customerEmail,
            o.fulfilment,
            o.created_at       AS createdAt,
            o.paid_at          AS paidAt,
            o.expires_at       AS expiresAt,
            (SELECT COALESCE(SUM(qty), 0) FROM order_item i WHERE i.order_id = o.id) AS itemCount,
            (SELECT s.tracking_ref FROM shipment s
              WHERE s.order_id = o.id ORDER BY s.created_at DESC LIMIT 1) AS tracking
       FROM orders o
      WHERE ${where}
      ORDER BY o.created_at DESC
      LIMIT ?1`,
  );

  const { results } = await (
    opts.status && opts.status !== 'attention' ? stmt.bind(limit, opts.status) : stmt.bind(limit)
  ).all<OrderRow>();

  return results;
}

export interface OrderLine {
  lineNo: number;
  title: string;
  optionLabel: string;
  sku: string;
  qty: number;
  unitMinor: Minor;
}

export interface OrderDetail extends OrderRow {
  subtotalMinor: Minor;
  shippingMinor: Minor;
  taxMinor: Minor;
  customerPhone: string | null;
  note: string | null;
  adminNote: string | null;
  ship: {
    line1: string | null; line2: string | null; city: string | null;
    region: string | null; postcode: string | null; country: string | null;
  };
  lines: OrderLine[];
  /** Every piece of evidence, newest first. The audit trail for this money. */
  payments: {
    source: string; confidence: string; reference: string;
    amountMinor: Minor; actor: string | null; at: string;
  }[];
}

export async function getOrder(db: D1Database, id: string): Promise<OrderDetail | null> {
  const order = await db
    .prepare(
      `SELECT o.id, o.status, o.currency,
              o.subtotal_minor   AS subtotalMinor,
              o.shipping_minor   AS shippingMinor,
              o.tax_minor        AS taxMinor,
              o.amount_due_minor AS amountDueMinor,
              o.customer_name    AS customerName,
              o.customer_email   AS customerEmail,
              o.customer_phone   AS customerPhone,
              o.fulfilment, o.note, o.admin_note AS adminNote,
              o.ship_line1 AS shipLine1, o.ship_line2 AS shipLine2,
              o.ship_city AS shipCity, o.ship_region AS shipRegion,
              o.ship_postal_code AS shipPostcode, o.ship_country AS shipCountry,
              o.created_at AS createdAt, o.paid_at AS paidAt, o.expires_at AS expiresAt,
              (SELECT s.tracking_ref FROM shipment s
                WHERE s.order_id = o.id ORDER BY s.created_at DESC LIMIT 1) AS tracking
         FROM orders o WHERE o.id = ?1`,
    )
    .bind(id)
    .first<Record<string, string | number | null>>();

  if (!order) return null;

  const batch = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT line_no AS lineNo, title, sku, qty, unit_minor AS unitMinor,
                option_1 AS o1, option_2 AS o2, option_3 AS o3
           FROM order_item WHERE order_id = ?1 ORDER BY line_no`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT source, confidence, reference, amount_minor AS amountMinor, actor, at
           FROM payment_event WHERE order_id = ?1 ORDER BY at DESC`,
      )
      .bind(id),
  ]);

  // `batch()` returns one result per statement, in order.
  const rows = <T,>(i: number): T[] => (batch[i]?.results ?? []) as unknown as T[];

  const lines = rows<OrderLine & { o1: string | null; o2: string | null; o3: string | null }>(0).map(
    (l) => ({
      lineNo: l.lineNo,
      title: l.title,
      sku: l.sku,
      qty: l.qty,
      unitMinor: l.unitMinor,
      optionLabel: [l.o1, l.o2, l.o3].filter(Boolean).join(' · '),
    }),
  );

  return {
    id: String(order.id),
    status: order.status as OrderStatus,
    currency: String(order.currency),
    subtotalMinor: Number(order.subtotalMinor),
    shippingMinor: Number(order.shippingMinor),
    taxMinor: Number(order.taxMinor),
    amountDueMinor: Number(order.amountDueMinor),
    customerName: String(order.customerName),
    customerEmail: String(order.customerEmail),
    customerPhone: (order.customerPhone as string | null) ?? null,
    fulfilment: order.fulfilment as OrderDetail['fulfilment'],
    note: (order.note as string | null) ?? null,
    adminNote: (order.adminNote as string | null) ?? null,
    createdAt: String(order.createdAt),
    paidAt: (order.paidAt as string | null) ?? null,
    expiresAt: String(order.expiresAt),
    tracking: (order.tracking as string | null) ?? null,
    itemCount: lines.reduce((n, l) => n + l.qty, 0),
    ship: {
      line1: (order.shipLine1 as string | null) ?? null,
      line2: (order.shipLine2 as string | null) ?? null,
      city: (order.shipCity as string | null) ?? null,
      region: (order.shipRegion as string | null) ?? null,
      postcode: (order.shipPostcode as string | null) ?? null,
      country: (order.shipCountry as string | null) ?? null,
    },
    lines,
    payments: rows<OrderDetail['payments'][number]>(1),
  };
}

/**
 * Credits waiting on a human.
 *
 * Two different problems in one list, deliberately. A credit that matched no
 * order and one held for review both mean somebody's money is sitting
 * unaccounted for, and a shopkeeper should not have to know which queue to look
 * in to find out.
 */
export interface PendingCredit {
  reference: string;
  currency: string;
  amountMinor: Minor;
  creditedAt: string;
  payerRef: string | null;
  narration: string | null;
  source: string;
  confidence: string;
  candidateOrder: string | null;
  unmatchedReason: string | null;
  seenAt: string;
}

export const pendingCredits = (db: D1Database, limit = 100) =>
  db
    .prepare(
      `SELECT reference, currency, amount_minor AS amountMinor,
              credited_at AS creditedAt, payer_ref AS payerRef, narration,
              source, confidence, candidate_order AS candidateOrder,
              unmatched_reason AS unmatchedReason, seen_at AS seenAt
         FROM credit_evidence
        WHERE resolved_at IS NULL
        ORDER BY credited_at DESC
        LIMIT ?1`,
    )
    .bind(Math.min(limit, 500))
    .all<PendingCredit>()
    .then((r) => r.results);

/** Mark a piece of evidence dealt with, so it leaves the queue. */
export const resolveCredit = (db: D1Database, reference: string) =>
  db
    .prepare(`UPDATE credit_evidence SET resolved_at = datetime('now') WHERE reference = ?1`)
    .bind(reference)
    .run();
