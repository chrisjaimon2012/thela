import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { invite } from '../../../lib/admin/people';
import { can, refusal } from '../../../lib/admin/staff';

export const POST: APIRoute = async ({ request, locals }) => {
  const admin = locals.admin;
  // Checked here as well as hidden in the page. A form that is not rendered is
  // not a form that cannot be submitted.
  if (!can(admin, 'people')) return back(`/admin/people?e=${encodeURIComponent(refusal('people'))}`);

  const form = await request.formData();
  const role = form.get('role') === 'owner' ? 'owner' : 'staff';
  const result = await invite(env.DB, String(form.get('email') ?? ''), role, admin!.email);

  return back(
    result.ok
      ? `/admin/people?done=${encodeURIComponent('Added. Tell them the address you used, and they can sign in.')}`
      : `/admin/people?e=${encodeURIComponent(result.why ?? 'That did not work.')}`,
  );
};

const back = (to: string) => new Response(null, { status: 303, headers: { Location: to } });
