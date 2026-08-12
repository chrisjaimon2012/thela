import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { findVariant } from '../../../lib/catalogue';
import { addLine, isSecure, parseQty, readCartLines, writeCart } from '../../../lib/cart';

/**
 * Add to cart. A plain form POST, so it works with JavaScript switched off,
 * on a feature phone, and behind a proxy that strips scripts.
 *
 * Replies 303 rather than 200 so a refresh on the cart page does not re-post
 * the form and add the item twice.
 *
 * No CSRF token, and two independent reasons why not. Astro checks the `Origin`
 * header on form POSTs by default and returns 403 without a matching one —
 * verified by watching this endpoint reject a curl that omitted it. And the
 * cart cookie is `SameSite=Lax`, so a cross-site POST would not carry it even
 * if the first check were somehow bypassed. Checkout creates a real order and
 * is a different matter; it carries a token of its own.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const db = env.DB;
  const form = await request.formData();

  const slug = String(form.get('slug') ?? '');
  if (!slug) return back('/', 'missing');

  const options: [string | null, string | null, string | null] = [
    str(form.get('option1')),
    str(form.get('option2')),
    str(form.get('option3')),
  ];

  const variant = await findVariant(db, slug, options);

  // A combination that does not exist means the page was stale — the
  // shopkeeper archived a variant while it sat open in a tab.
  if (!variant) return back(`/p/${slug}`, 'gone');
  if (!variant.available) return back(`/p/${slug}`, 'soldout');

  const lines = await readCartLines(db, cookies);
  await writeCart(
    db,
    cookies,
    addLine(lines, variant.id, parseQty(form.get('qty')) || 1),
    isSecure(request),
  );

  return back('/cart');
};

const str = (v: FormDataEntryValue | null): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

const back = (path: string, error?: string): Response =>
  new Response(null, {
    status: 303,
    headers: { Location: error ? `${path}?e=${error}` : path },
  });
