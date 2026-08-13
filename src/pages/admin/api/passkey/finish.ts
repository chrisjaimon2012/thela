import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  audit, relyingParty, saveCredential, takeChallenge,
} from '../../../../lib/admin/auth';
import { WebAuthnError, verifyRegistration } from '../../../../lib/admin/webauthn';

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const admin = locals.admin;
  const secret = env.SESSION_SECRET;
  if (!admin || !secret) return json({ error: 'Sign in first.' }, 401);

  const held = await takeChallenge(cookies, secret, 'register');
  if (!held) return json({ error: 'That took too long. Try again.' }, 400);

  // The challenge names whose account this ceremony was started for. If the
  // session changed underneath it, the passkey would land on the wrong one.
  if (held.uid !== admin.id) {
    return json({ error: 'That sign-in changed while you were adding a passkey. Try again.' }, 409);
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { origin, rpId } = relyingParty(request);

  let credential;
  try {
    credential = await verifyRegistration(
      {
        credentialId: String(body.credentialId ?? ''),
        publicKey: String(body.publicKey ?? ''),
        algorithm: Number(body.algorithm ?? 0),
        clientDataJSON: String(body.clientDataJSON ?? ''),
        authenticatorData: String(body.authenticatorData ?? ''),
      },
      { challenge: held.challenge, origin, rpId },
    );
  } catch (err) {
    return json(
      { error: err instanceof WebAuthnError ? err.message : 'That passkey could not be checked.' },
      400,
    );
  }

  try {
    await saveCredential(env.DB, {
      ...credential,
      userId: admin.id,
      label: String(body.label ?? ''),
      transports: String(body.transports ?? ''),
    });
  } catch {
    return json({ error: 'That device is already registered here.' }, 409);
  }

  await audit(env.DB, admin.email, 'passkey.added', credential.id, `via ${admin.via}`);
  return json({ ok: true });
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
