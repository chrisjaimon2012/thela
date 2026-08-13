import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { dismissCredit } from '../../../../lib/admin/credits';

export const POST: APIRoute = async ({ request, params, locals }) => {
  const admin = locals.admin;
  const reference = params.reference;
  if (!admin || !reference) return back('/admin/payments');

  const form = await request.formData();
  const reason = String(form.get('reason') ?? '').trim();
  if (!reason) {
    return back(
      '/admin/payments?e=' +
        encodeURIComponent('Say what the payment was, so the record means something later.'),
    );
  }

  const result = await dismissCredit(env.DB, decodeURIComponent(reference), admin.email, reason);

  return back(
    result.ok
      ? '/admin/payments?done=dismissed'
      : `/admin/payments?e=${encodeURIComponent(result.why ?? 'That did not work.')}`,
  );
};

const back = (to: string) => new Response(null, { status: 303, headers: { Location: to } });
