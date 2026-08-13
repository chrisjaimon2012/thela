import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { revokeAllCredentials } from '../../../lib/admin/recovery';

export const POST: APIRoute = async ({ locals }) => {
  const admin = locals.admin;
  if (!admin) return back('/admin/login');

  await revokeAllCredentials(env.DB, admin.id, admin.email);

  // The session survives on purpose. Revoking every passkey while signed in and
  // then ending the session would lock the person out mid-task with nothing to
  // sign in with — they are sent to add a new one instead.
  return back('/admin/passkeys?done=revoked');
};

const back = (to: string) => new Response(null, { status: 303, headers: { Location: to } });
