import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { setRole } from '../../../lib/admin/people';
import { can, refusal } from '../../../lib/admin/staff';

export const POST: APIRoute = async ({ request, locals }) => {
  const admin = locals.admin;
  if (!can(admin, 'people')) return back(`/admin/people?e=${encodeURIComponent(refusal('people'))}`);

  const form = await request.formData();
  const role = form.get('role') === 'owner' ? 'owner' : 'staff';
  const result = await setRole(env.DB, String(form.get('id') ?? ''), role, admin!.email);

  return back(
    result.ok
      ? `/admin/people?done=${encodeURIComponent(`Changed to ${role}.`)}`
      : `/admin/people?e=${encodeURIComponent(result.why ?? 'That did not work.')}`,
  );
};

const back = (to: string) => new Response(null, { status: 303, headers: { Location: to } });
