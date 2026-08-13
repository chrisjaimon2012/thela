import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { settleCredit } from '../../../../lib/admin/credits';

export const POST: APIRoute = async ({ request, params, locals }) => {
  const admin = locals.admin;
  const reference = params.reference;
  if (!admin || !reference) return back('/admin/payments');

  const form = await request.formData();
  const orderId = String(form.get('orderId') ?? '');
  if (!orderId) return back('/admin/payments');

  const result = await settleCredit(env.DB, decodeURIComponent(reference), orderId, admin.email);

  return back(
    result.ok
      ? '/admin/payments?done=settled'
      : `/admin/payments?e=${encodeURIComponent(result.why ?? 'That did not work.')}`,
  );
};

const back = (to: string) => new Response(null, { status: 303, headers: { Location: to } });
