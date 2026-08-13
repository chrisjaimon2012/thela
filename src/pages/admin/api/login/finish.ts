import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  audit, credentialById, isSecure, relyingParty, startSession, takeChallenge, touchCredential,
} from '../../../../lib/admin/auth';
import { WebAuthnError, verifyAssertion } from '../../../../lib/admin/webauthn';

export const POST: APIRoute = async ({ request, cookies }) => {
  const db = env.DB;
  const secret = env.SESSION_SECRET;
  if (!secret) return bad('This shop has no SESSION_SECRET set.', 500);

  const held = await takeChallenge(cookies, secret, 'login');
  if (!held) return bad('That took too long. Try again.');

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const credentialId = String(body.credentialId ?? '');

  const stored = await credentialById(db, credentialId);
  // Deliberately the same wording as a failed signature. Distinguishing "no
  // such passkey" from "wrong signature" tells an attacker which credential
  // ids exist on this shop.
  if (!stored) return bad('That passkey was not accepted.', 401);

  const { origin, rpId } = relyingParty(request);

  let result;
  try {
    result = await verifyAssertion(
      {
        credentialId,
        clientDataJSON: String(body.clientDataJSON ?? ''),
        authenticatorData: String(body.authenticatorData ?? ''),
        signature: String(body.signature ?? ''),
      },
      stored,
      { challenge: held.challenge, origin, rpId },
    );
  } catch (err) {
    return bad(err instanceof WebAuthnError ? err.message : 'That passkey was not accepted.', 401);
  }

  await touchCredential(db, credentialId, result.signCount);

  if (result.cloneSuspected) {
    // Signed in anyway, and recorded loudly. Refusing would lock out a
    // legitimate owner over an authenticator quirk; saying nothing would hide
    // the one signal that a credential has been copied.
    await audit(db, stored.userId, 'admin.clone_suspected', credentialId,
      `counter went backwards to ${result.signCount}`);
  }

  await startSession(cookies, secret, stored.userId, 'passkey', isSecure(request));
  await audit(db, stored.userId, 'admin.signed_in', credentialId);

  return json({ ok: true });
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
const bad = (error: string, status = 400) => json({ error }, status);
