import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  isSecure, parseQty, readCartLines, removeLine, setLine, writeCart,
} from '../../../lib/cart';

/**
 * Change a quantity or remove a line.
 *
 * One endpoint for both, because without JavaScript a row is one form and the
 * button the customer pressed is the only signal of intent. A submit button
 * named `remove` puts its value in the form data; a quantity change does not.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const db = env.DB;
  const form = await request.formData();

  const variantId = String(form.get('variantId') ?? '');
  if (!variantId) return see('/cart');

  const lines = await readCartLines(db, cookies);

  const next = form.has('remove')
    ? removeLine(lines, variantId)
    : setLine(lines, variantId, parseQty(form.get('qty')));

  await writeCart(db, cookies, next, isSecure(request));
  return see('/cart');
};

const see = (path: string): Response =>
  new Response(null, { status: 303, headers: { Location: path } });
