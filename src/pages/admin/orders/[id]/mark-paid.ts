import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { audit } from '../../../../lib/admin/auth';
import { resolve } from '../../../../lib/payments/resolve';

/**
 * Manual verification: a human with account access says the money is there.
 *
 * This does NOT get its own settlement path. It builds an `Evidence` record at
 * the `asserted` tier and hands it to the same `resolve()` every other source
 * uses, which is what ADR-0006 is for — the idempotency guard, the stock
 * decrement and the status change are all the same code that a bank alert goes
 * through. A second path here would be a second place to get stock wrong.
 *
 * The reference matters more than it looks. When the same payment appears in
 * next month's statement upload, `resolve()` recognises it by reference alone
 * and treats it as a duplicate. Without one, the shop would decrement stock
 * twice for one sale.
 */
export const POST: APIRoute = async ({ request, params, locals }) => {
  const db = env.DB;
  const orderId = params.id;
  const admin = locals.admin;

  if (!orderId || !admin) return back('/admin');

  const form = await request.formData();
  const reference = String(form.get('reference') ?? '').trim();
  if (!reference) return back(`/admin/orders/${orderId}?e=reference`);

  const order = await db
    .prepare(
      `SELECT currency, amount_due_minor AS amount, status
         FROM orders WHERE id = ?1`,
    )
    .bind(orderId)
    .first<{ currency: string; amount: number; status: string }>();

  if (!order) return back('/admin');
  if (order.status !== 'awaiting_payment') return back(`/admin/orders/${orderId}?e=settled`);

  const result = await resolve(db, {
    source: 'manual',
    confidence: 'asserted',
    reference,
    amountMinor: order.amount,
    // From the ORDER, not from settings. An order records the currency it was
    // placed in, and a shop that changed currency last week must not have its
    // older orders reinterpreted.
    currency: order.currency,
    // Now, not when the money moved — we do not know that, and claiming to
    // would put a false timestamp in the one record an auditor would read.
    at: new Date().toISOString(),
    actor: admin.email,
    narration: `Marked paid in the admin by ${admin.email}`,
  });

  await audit(db, admin.email, 'order.marked_paid', orderId, `${result.outcome} · ${reference}`);

  // `duplicate` means this reference already settled something — usually this
  // very order, from a bank alert that arrived while the form was open.
  const query =
    result.outcome === 'settled' ? '?done=paid'
      : result.outcome === 'duplicate' ? '?e=settled'
        : `?e=${result.outcome}`;

  return back(`/admin/orders/${orderId}${query}`);
};

const back = (to: string) => new Response(null, { status: 303, headers: { Location: to } });
