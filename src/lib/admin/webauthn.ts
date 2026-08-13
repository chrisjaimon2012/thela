/**
 * Passkeys, with no CBOR decoder and no dependency.
 *
 * WHY PASSKEYS AT ALL — it is arithmetic, not fashion. Verifying a passkey is
 * one ECDSA check at 0.044 ms. PBKDF2 at OWASP's recommended 600,000 iterations
 * costs 45 ms against the Workers free plan's 10 ms budget; even 100,000 costs
 * 7.5 ms and leaves nothing for the page being logged into. Measured, not
 * assumed — see ADR-0022.
 *
 * WHY THERE IS NO CBOR DECODER HERE
 *
 * The usual WebAuthn server parses `attestationObject`, which is CBOR, to dig
 * out a COSE key and convert it. Browsers have offered
 * `AuthenticatorAttestationResponse.getPublicKey()` for years, which hands back
 * the same key already in SPKI DER — exactly what `crypto.subtle.importKey`
 * wants. Taking that path removes a CBOR decoder, a COSE-to-JWK converter, and
 * every bug in both, at the cost of refusing an authenticator whose algorithm
 * the browser cannot express that way. That refusal is explicit and says so.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * Attestation is not verified. It answers "is this authenticator model genuine",
 * which matters to a bank deciding whether to trust hardware, and not at all to
 * a shop deciding whether the person holding the phone is the person who
 * registered it. Verifying it would mean shipping and maintaining a metadata
 * blob for no gain here.
 */

export interface StoredCredential {
  id: string;
  userId: string;
  /** SPKI DER, base64url. */
  publicKey: string;
  /** COSE identifier: -7 ES256, -257 RS256. */
  algorithm: number;
  signCount: number;
}

export interface RegistrationInput {
  credentialId: string;
  /** base64url SPKI, from `response.getPublicKey()`. */
  publicKey: string;
  algorithm: number;
  clientDataJSON: string;
  /** base64url. Parsed for flags and the counter; never for a COSE key. */
  authenticatorData: string;
}

export interface AssertionInput {
  credentialId: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
}

export interface Expectation {
  /** The exact challenge we issued, base64url. */
  challenge: string;
  /** Scheme, host and port, e.g. `https://shop.example`. Compared exactly. */
  origin: string;
  /** The registrable domain, e.g. `shop.example`. */
  rpId: string;
}

export class WebAuthnError extends Error {}

/** ES256 and RS256. Everything a browser will hand us as SPKI in practice. */
interface Algorithm {
  name: string;
  params: EcKeyImportParams | RsaHashedImportParams;
  verify: EcdsaParams | AlgorithmIdentifier;
}

// A Map rather than an object: COSE identifiers are negative numbers, and an
// object indexed by them is a string lookup pretending to be numeric.
const ALGORITHMS = new Map<number, Algorithm>([
  [-7, {
    name: 'ECDSA',
    params: { name: 'ECDSA', namedCurve: 'P-256' },
    verify: { name: 'ECDSA', hash: 'SHA-256' },
  }],
  [-257, {
    name: 'RSASSA-PKCS1-v1_5',
    params: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    verify: { name: 'RSASSA-PKCS1-v1_5' },
  }],
]);

export const supportedAlgorithms = [...ALGORITHMS.keys()];

/**
 * Check a registration and return what to store.
 *
 * There is no signature to verify here — that is what attestation would be, and
 * we do not do attestation. What IS verified is that the ceremony was ours: our
 * challenge, our origin, our relying party, and a user who was actually present.
 */
export async function verifyRegistration(
  input: RegistrationInput,
  expect: Expectation,
): Promise<Omit<StoredCredential, 'userId'>> {
  checkClientData(input.clientDataJSON, expect, 'webauthn.create');

  const auth = parseAuthenticatorData(fromB64url(input.authenticatorData));
  await checkRpId(auth.rpIdHash, expect.rpId);

  if (!auth.userPresent) {
    throw new WebAuthnError('The authenticator reported nobody was there.');
  }

  if (!ALGORITHMS.has(input.algorithm)) {
    throw new WebAuthnError(
      `This device offered an algorithm thela cannot check (${input.algorithm}). ` +
        `Try a different device, or a phone as a passkey.`,
    );
  }

  // Fail here rather than at first login. `getPublicKey()` returns null when
  // the browser cannot express the key as SPKI, and a credential stored without
  // one is a device that registers happily and can never sign in.
  if (!input.publicKey) {
    throw new WebAuthnError('This browser did not provide a usable public key for that device.');
  }
  await importKey(input.publicKey, input.algorithm);

  return {
    id: input.credentialId,
    publicKey: input.publicKey,
    algorithm: input.algorithm,
    signCount: auth.signCount,
  };
}

export interface AssertionResult {
  /** Store this. It must never decrease. */
  signCount: number;
  /**
   * True when the authenticator's counter went backwards, which means the
   * credential has been cloned. Rare, and the caller decides what to do.
   */
  cloneSuspected: boolean;
}

/**
 * Verify a login.
 *
 * The signature covers `authenticatorData || sha256(clientDataJSON)`, so
 * tampering with either the challenge or the origin invalidates it. That is the
 * property that makes a passkey phishing-resistant and a password not.
 */
export async function verifyAssertion(
  input: AssertionInput,
  credential: StoredCredential,
  expect: Expectation,
): Promise<AssertionResult> {
  if (input.credentialId !== credential.id) {
    throw new WebAuthnError('That passkey does not match the one being checked.');
  }

  checkClientData(input.clientDataJSON, expect, 'webauthn.get');

  const authBytes = fromB64url(input.authenticatorData);
  const auth = parseAuthenticatorData(authBytes);
  await checkRpId(auth.rpIdHash, expect.rpId);

  if (!auth.userPresent) {
    throw new WebAuthnError('The authenticator reported nobody was there.');
  }

  const clientHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', fromB64url(input.clientDataJSON)),
  );
  const signed = new Uint8Array(authBytes.length + clientHash.length);
  signed.set(authBytes, 0);
  signed.set(clientHash, authBytes.length);

  const algo = ALGORITHMS.get(credential.algorithm);
  if (!algo) throw new WebAuthnError(`Unsupported algorithm ${credential.algorithm}.`);

  const key = await importKey(credential.publicKey, credential.algorithm);

  // ECDSA signatures arrive DER-encoded from WebAuthn; WebCrypto wants raw r‖s.
  const signature =
    algo.name === 'ECDSA' ? derToRaw(fromB64url(input.signature)) : fromB64url(input.signature);

  const ok = await crypto.subtle.verify(algo.verify, key, signature, signed);
  if (!ok) throw new WebAuthnError('That passkey signature did not check out.');

  return {
    signCount: auth.signCount,
    // Both at zero means the authenticator has opted out of counting, which is
    // legitimate and common. Only a genuine decrease is suspicious.
    cloneSuspected: auth.signCount !== 0 && auth.signCount <= credential.signCount,
  };
}

// ---------------------------------------------------------------------------

interface ClientData {
  type: string;
  challenge: string;
  origin: string;
  crossOrigin?: boolean;
}

function checkClientData(b64: string, expect: Expectation, type: string): void {
  let data: ClientData;
  try {
    data = JSON.parse(new TextDecoder().decode(fromB64url(b64))) as ClientData;
  } catch {
    throw new WebAuthnError('The browser sent something we could not read.');
  }

  if (data.type !== type) {
    throw new WebAuthnError(`Expected a ${type} ceremony, got ${data.type}.`);
  }

  // Constant-time, because a timing oracle on the challenge is a replay window.
  if (!timingSafeEqual(data.challenge, expect.challenge)) {
    throw new WebAuthnError('That sign-in attempt has expired. Try again.');
  }

  // Exact match, not a suffix test. `https://shop.example.evil.com` ends with
  // our domain and must not be accepted.
  if (data.origin !== expect.origin) {
    throw new WebAuthnError(`This passkey was used on ${data.origin}, which is not this shop.`);
  }

  if (data.crossOrigin) {
    throw new WebAuthnError('A passkey cannot be used from inside another site’s frame.');
  }
}

interface AuthData {
  rpIdHash: Uint8Array;
  userPresent: boolean;
  userVerified: boolean;
  signCount: number;
}

/**
 * Fixed-layout prefix: rpIdHash(32) ‖ flags(1) ‖ signCount(4), big-endian.
 * Anything after it is attested credential data and extensions, which we do
 * not read — the public key comes from `getPublicKey()` instead.
 */
function parseAuthenticatorData(bytes: Uint8Array): AuthData {
  if (bytes.length < 37) {
    throw new WebAuthnError('The authenticator sent a truncated response.');
  }
  const flags = bytes[32]!;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    rpIdHash: bytes.slice(0, 32),
    userPresent: (flags & 0x01) !== 0,
    userVerified: (flags & 0x04) !== 0,
    signCount: view.getUint32(33, false),
  };
}

async function checkRpId(hash: Uint8Array, rpId: string): Promise<void> {
  const expected = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpId)),
  );
  if (hash.length !== expected.length || !hash.every((b, i) => b === expected[i])) {
    throw new WebAuthnError('That passkey belongs to a different site.');
  }
}

function importKey(spkiB64: string, algorithm: number): Promise<CryptoKey> {
  const algo = ALGORITHMS.get(algorithm);
  if (!algo) throw new WebAuthnError(`Unsupported algorithm ${algorithm}.`);
  return crypto.subtle.importKey('spki', fromB64url(spkiB64), algo.params, false, ['verify']);
}

/**
 * DER `SEQUENCE { INTEGER r, INTEGER s }` to the raw 64 bytes WebCrypto wants.
 *
 * DER integers are signed, so a value whose top bit is set carries a leading
 * zero byte that has to come off, and a short value has to be left-padded back
 * to 32. Getting either wrong produces a verifier that rejects roughly half of
 * all genuine signatures — intermittently, which is the worst way to find out.
 */
export function derToRaw(der: Uint8Array): Uint8Array<ArrayBuffer> {
  if (der[0] !== 0x30) throw new WebAuthnError('Malformed signature.');

  let i = 2;
  // A long-form length byte means the header is one longer.
  if (der[1]! & 0x80) i += der[1]! & 0x7f;

  const read = (): Uint8Array => {
    if (der[i] !== 0x02) throw new WebAuthnError('Malformed signature.');
    const len = der[i + 1]!;
    let start = i + 2;
    let end = start + len;
    // Strip DER's sign-padding zeros, then left-pad to 32.
    while (end - start > 32 && der[start] === 0x00) start++;
    i = end;
    const out = new Uint8Array(32);
    out.set(der.slice(start, end), 32 - (end - start));
    return out;
  };

  const r = read();
  const s = read();
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

/** Length-independent comparison. Both inputs here are base64url text. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '=')), (c) =>
    c.charCodeAt(0),
  );
}

export function toB64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** A fresh challenge. 32 bytes is the spec's recommendation. */
export const newChallenge = (): string => toB64url(crypto.getRandomValues(new Uint8Array(32)));
