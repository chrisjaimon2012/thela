import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { revoke } from '../../../lib/admin/people';
import { can, refusal } from '../../../lib/admin/staff';

export const POST: APIRoute = async ({ request, locals }) => {
  const admin = locals.admin;
  if (!can(admin, 'people')) return back(`/admin/people?e=${encodeURIComponent(refusal('people'))}`);

  const form = await request.formData();
  const id = String(form.get('id') ?? '');

  // Removing yourself is not forbidden by the model, but doing it by accident
  // from a list of buttons is a bad afternoon. The page hides the control; this
  // is the second half of that.
  if (id === admin!.id) {
    return back(`/admin/people?e=${encodeURIComponent('You cannot remove yourself.')}`);
  }

  const result = await revoke(env.DB, id, admin!.email);
  return back(
    result.ok
      ? `/admin/people?done=${encodeURIComponent('Removed, along with their passkeys.')}`
      : `/admin/people?e=${encodeURIComponent(result.why ?? 'That did not work.')}`,
  );
};

const back = (to: string) => new Response(null, { status: 303, headers: { Location: to } });
