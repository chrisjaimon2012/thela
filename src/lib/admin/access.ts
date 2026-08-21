/**
 * Verifying a Cloudflare Access identity.
 *
 * THE BUG THIS EXISTS TO FIX
 *
 * The first version of this trusted `Cf-Access-Authenticated-User-Email`
 * outright. Cloudflare's own documentation says why that is wrong, in as many
 * words: "Validation of the header alone is not sufficient — the JWT and
 * signature must be confirmed to avoid identity spoofing."
 *
 * The attack is not subtle. Access protects a hostname; the Worker is also
 * reachable at its `workers.dev` address and at any other route bound to it. A
 * request that never passes through the Access application can carry whatever
 * headers it likes, so `Cf-Access-Authenticated-User-Email: owner@shop.com`
 * would have made anyone an administrator — able to change the payee address
 * and redirect every future customer payment.
 *
 * So the header is now worthless on its own. What counts is the signed JWT in
 * `Cf-Access-Jwt-Assertion`, verified against the team's published keys, with
 * the audience pinned to this application's own AUD tag.
 *
 * SAFE BY DEFAULT
 *
 * If `ACCESS_TEAM_DOMAIN` and `ACCESS_POLICY_AUD` are not configured, Access is
 * not in use and every Access header is ignored completely. A shop that has
 * never heard of Zero Trust cannot be attacked through a feature it does not
 * use, and misconfiguration fails closed rather than open.
 *
 * NO JOSE
 *
 * WebCrypto verifies RS256 directly once the JWK is imported, so this needs no
 * dependency. The whole thing is one fetch, one importKey and one verify.
 */

export interface AccessIdentity {
  email: string;
  /** Access's own user id, useful in an audit trail. */
  sub: string;
}

interface Jwk {
  kid: string;
  kty: string;
  alg?: string;
  n: string;
  e: string;
}

/**
 * Public keys, cached for the life of the isolate.
 *
 * Cloudflare rotates these, so a `kid` we have never seen forces a refetch
 * rather than a rejection — otherwise a rotation would lock every admin out
 * until the isolates recycled.
 */
let keyCache: { fetchedAt: number; keys: Map<string, CryptoKey> } | null = null;
const KEY_TTL_MS = 60 * 60 * 1000;

async function keyFor(teamDomain: string, kid: string): Promise<CryptoKey | null> {
  const fresh = keyCache && Date.now() - keyCache.fetchedAt < KEY_TTL_MS;
  if (fresh && keyCache!.keys.has(kid)) return keyCache!.keys.get(kid)!;

  const res = await fetch(`${teamDomain.replace(/\/$/, '')}/cdn-cgi/access/certs`);
  if (!res.ok) return null;

  const { keys } = (await res.json()) as { keys: Jwk[] };
  const imported = new Map<string, CryptoKey>();

  for (const jwk of keys) {
    if (jwk.kty !== 'RSA') continue;
    try {
      imported.set(
        jwk.kid,
        await crypto.subtle.importKey(
          'jwk',
          { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
          { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
          false,
          ['verify'],
        ),
      );
    } catch {
      // A key we cannot import is one we cannot trust. Skip it rather than
      // failing the whole set, so one bad entry does not lock everybody out.
    }
  }

  keyCache = { fetchedAt: Date.now(), keys: imported };
  return imported.get(kid) ?? null;
}

export interface AccessConfig {
  /** e.g. https://myteam.cloudflareaccess.com */
  teamDomain?: string;
  /** The application's AUD tag. Pinning this stops a token minted for ANOTHER
   *  application in the same Zero Trust org being replayed at this one. */
  policyAud?: string;
}

/**
 * Returns the verified identity, or null.
 *
 * Null covers every failure — not configured, no token, bad signature, wrong
 * audience, expired — because the caller's only correct response to all of them
 * is the same: this request is not authenticated by Access.
 */
export async function verifyAccess(
  request: Request,
  config: AccessConfig,
): Promise<AccessIdentity | null> {
  const { teamDomain, policyAud } = config;
  if (!teamDomain || !policyAud) return null;

  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [rawHeader, rawPayload, rawSignature] = parts as [string, string, string];

  try {
    const header = json<{ alg: string; kid: string }>(rawHeader);
    if (header.alg !== 'RS256') return null;

    const key = await keyFor(teamDomain, header.kid);
    if (!key) return null;

    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64(rawSignature),
      new TextEncoder().encode(`${rawHeader}.${rawPayload}`),
    );
    if (!ok) return null;

    const payload = json<{
      email?: string; sub?: string; aud?: string | string[];
      iss?: string; exp?: number; nbf?: number;
    }>(rawPayload);

    // Audience, issuer and expiry are all checked. A valid signature only says
    // Cloudflare minted it — not that it was minted for THIS application.
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(policyAud)) return null;
    if (payload.iss !== teamDomain.replace(/\/$/, '')) return null;

    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp < now) return null;
    if (typeof payload.nbf === 'number' && payload.nbf > now) return null;

    if (!payload.email) return null;
    return { email: payload.email, sub: payload.sub ?? '' };
  } catch {
    return null;
  }
}

const b64 = (s: string): Uint8Array<ArrayBuffer> => {
  const p = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(p.padEnd(Math.ceil(p.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
};

const json = <T,>(part: string): T =>
  JSON.parse(new TextDecoder().decode(b64(part))) as T;
