import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  audit, createOwner, isSecure, isUnclaimed, relyingParty, saveCredential,
  startSession, takeChallenge,
} from '../../../../lib/admin/auth';
import { WebAuthnError, verifyRegistration } from '../../../../lib/admin/webauthn';
import { applyShopIdentity } from '../../../../lib/admin/setup';

/** Finish registering, create the owner, and sign them in. */
export const POST: APIRoute = async ({ request, cookies }) => {
  const db = env.DB;
  const secret = env.SESSION_SECRET;
  if (!secret) return bad('This shop has no SESSION_SECRET set.', 500);

  // Re-checked after the challenge round trip, not only before it. Two people
  // starting setup at once must not both become owners.
  if (!(await isUnclaimed(db))) return bad('This shop already has an owner.', 409);

  const held = await takeChallenge(cookies, secret, 'register');
  if (!held) return bad('That took too long. Start again.', 400);

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
    return bad(err instanceof WebAuthnError ? err.message : 'That passkey could not be checked.');
  }

  // From the signed challenge, never from this request's body.
  const email = held.email ?? '';
  const name = held.name ?? '';
  if (!email) return bad('That setup session is incomplete. Start again.');

  const userId = crypto.randomUUID();

  try {
    await createOwner(db, { id: userId, email, name });
  } catch {
    // UNIQUE(email) or a lost race. Either way somebody else got here first.
    return bad('This shop already has an owner.', 409);
  }

  await saveCredential(db, {
    ...credential,
    userId,
    label: String(body.label ?? ''),
    transports: String(body.transports ?? ''),
  });

  // The shop's own identity, from the same signed challenge as the owner's.
  // Written before the session starts, so the first page they see is a
  // configured shop rather than one still asking to be set up.
  if (held.shop) await applyShopIdentity(db, held.shop);

  await audit(db, email, 'admin.claimed', userId, 'first passkey registered');
  await startSession(cookies, secret, userId, 'passkey', isSecure(request));

  return json({ ok: true });
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
const bad = (error: string, status = 400) => json({ error }, status);
