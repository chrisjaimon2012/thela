import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { isSecure, issueChallenge, relyingParty } from '../../../../lib/admin/auth';
import { newChallenge, supportedAlgorithms, toB64url } from '../../../../lib/admin/webauthn';

/**
 * Add a passkey to the account that is already signed in.
 *
 * Separate from the setup route on purpose. That one is public and only works
 * while a shop is unclaimed; this one requires a session and adds to whoever
 * holds it. Conflating them is how a public endpoint quietly becomes a way to
 * attach a device to somebody else's account.
 */
export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const admin = locals.admin;
  const secret = env.SESSION_SECRET;
  if (!admin || !secret) return json({ error: 'Sign in first.' }, 401);

  const existing = await env.DB
    .prepare(`SELECT id FROM admin_credential WHERE user_id = ?1`)
    .bind(admin.id)
    .all<{ id: string }>();

  const challenge = newChallenge();
  await issueChallenge(cookies, secret, challenge, 'register', isSecure(request), {
    uid: admin.id,
  });

  const { rpId } = relyingParty(request);

  return json({
    publicKey: {
      challenge,
      rp: { id: rpId, name: 'thela' },
      user: {
        id: toB64url(new TextEncoder().encode(admin.id)),
        name: admin.email,
        displayName: admin.name || admin.email,
      },
      pubKeyCredParams: supportedAlgorithms.map((alg) => ({ type: 'public-key', alg })),
      // Stops a device that is already registered being added a second time,
      // which would otherwise produce a duplicate row and a confusing list.
      excludeCredentials: existing.results.map((c) => ({ type: 'public-key', id: c.id })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      timeout: 120_000,
      attestation: 'none',
    },
  });
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
