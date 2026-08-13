import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  isSecure, isUnclaimed, issueChallenge, relyingParty,
} from '../../../../lib/admin/auth';
import { newChallenge, supportedAlgorithms, toB64url } from '../../../../lib/admin/webauthn';

/**
 * Begin registering a passkey.
 *
 * Only reachable while the shop is unclaimed. Adding a SECOND passkey to an
 * existing account is a different route behind a session; conflating the two is
 * how a public endpoint quietly becomes an account-creation endpoint.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const db = env.DB;

  if (!(await isUnclaimed(db))) {
    return bad('This shop already has an owner.', 409);
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  // Constant-time compare: the token is the only thing standing between a
  // freshly deployed shop and whoever finds its URL first.
  if (env.ADMIN_SETUP_TOKEN) {
    const given = String(body.token ?? '');
    if (!equal(given, env.ADMIN_SETUP_TOKEN)) {
      return bad('That setup token is not right.', 403);
    }
  }

  const email = String(body.email ?? '').trim();
  const name = String(body.name ?? '').trim();
  if (!email.includes('@') || !name) {
    return bad('A name and a working email address are both needed.');
  }

  if (!env.SESSION_SECRET) {
    return bad(
      'This shop has no SESSION_SECRET set, so it cannot sign you in. ' +
        'Set it as a secret and redeploy.',
      500,
    );
  }

  const challenge = newChallenge();
  // The email and name travel in the signed challenge, not back through the
  // client, so `finish` creates exactly the identity this token authorised.
  await issueChallenge(cookies, env.SESSION_SECRET, challenge, 'register', isSecure(request), {
    email,
    name,
  });

  const { rpId } = relyingParty(request);

  return json({
    publicKey: {
      challenge,
      rp: { id: rpId, name: 'thela' },
      user: {
        // Random, not the email: a WebAuthn user handle is stored on the
        // authenticator, and putting an email there leaks it to any site that
        // can trigger a conditional UI prompt.
        id: toB64url(crypto.getRandomValues(new Uint8Array(16))),
        name: email,
        displayName: name,
      },
      pubKeyCredParams: supportedAlgorithms.map((alg) => ({ type: 'public-key', alg })),
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'preferred',
      },
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

const bad = (error: string, status = 400) => json({ error }, status);

function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
