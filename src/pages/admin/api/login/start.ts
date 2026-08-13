import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { isSecure, issueChallenge } from '../../../../lib/admin/auth';
import { newChallenge } from '../../../../lib/admin/webauthn';

/**
 * Begin a sign-in.
 *
 * No `allowCredentials` list and no email field. Discoverable credentials mean
 * the authenticator already knows which passkey belongs to this site, so the
 * browser can present it directly — and, more importantly, we never have to ask
 * "who are you?" before authenticating, which would turn this endpoint into a
 * way to test whether an address has an account here.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const secret = env.SESSION_SECRET;
  if (!secret) {
    return json({ error: 'This shop has no SESSION_SECRET set, so it cannot sign anyone in.' }, 500);
  }

  const challenge = newChallenge();
  await issueChallenge(cookies, secret, challenge, 'login', isSecure(request));

  const rpId = new URL(request.url).hostname;

  return json({
    publicKey: { challenge, rpId, userVerification: 'preferred', timeout: 120_000 },
  });
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
