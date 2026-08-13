import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { isSecure, startSession } from '../../../lib/admin/auth';
import { redeemCode } from '../../../lib/admin/recovery';

/**
 * Spend a code and start a session.
 *
 * The session is marked `via: 'recovery'`, which is why this is not simply
 * "being signed in": the point of arriving here is that a device is gone, so
 * the next thing to do is add a new passkey, and the audit trail should be able
 * to tell a recovered session from an ordinary one for as long as it lasts.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const secret = env.SESSION_SECRET;
  if (!secret) {
    return back('/admin/recover?e=' + encodeURIComponent('This shop has no SESSION_SECRET set.'));
  }

  const form = await request.formData();
  const code = String(form.get('code') ?? '');

  const user = await redeemCode(env.DB, code);
  if (!user) {
    // Expired, spent, or wrong — one answer for all three.
    return back(
      '/admin/recover?sent=1&e=' +
        encodeURIComponent('That code did not work. It may have expired, or already been used.'),
    );
  }

  await startSession(cookies, secret, user.userId, 'recovery', isSecure(request));
  return back('/admin/passkeys?recovered=1');
};

const back = (to: string) => new Response(null, { status: 303, headers: { Location: to } });
