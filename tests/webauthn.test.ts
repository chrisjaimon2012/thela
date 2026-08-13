import { describe, expect, it } from 'vitest';
import {
  WebAuthnError, derToRaw, newChallenge, toB64url, verifyAssertion, verifyRegistration,
} from '../src/lib/admin/webauthn';

/**
 * A real key, a real signature, a real verification.
 *
 * These tests act as the authenticator: they generate an ECDSA P-256 key, build
 * the same byte layout a real one would, sign it, and re-encode the signature
 * into DER the way WebAuthn does. Nothing is stubbed, so a mistake in the DER
 * conversion or the signed-data layout fails here rather than at somebody's
 * login screen.
 *
 * The DER conversion is the sharp edge. DER integers are signed, so a value
 * whose top bit is set carries a leading zero byte, and a short value needs
 * left-padding back to 32. Get either wrong and the verifier rejects roughly
 * half of all genuine signatures — intermittently, depending on the random r
 * and s of that particular signature, which is the worst way to find a bug.
 */

const RP_ID = 'shop.example';
const ORIGIN = 'https://shop.example';

const b64 = (s: string) => toB64url(new TextEncoder().encode(s));

/** The inverse of `derToRaw`: what an authenticator actually emits. */
function rawToDer(raw: Uint8Array): Uint8Array {
  const encodeInt = (bytes: Uint8Array): number[] => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start++;
    const trimmed = [...bytes.slice(start)];
    // A leading bit of 1 would read as negative, so DER prefixes a zero.
    if ((trimmed[0]! & 0x80) !== 0) trimmed.unshift(0);
    return [0x02, trimmed.length, ...trimmed];
  };
  const body = [...encodeInt(raw.slice(0, 32)), ...encodeInt(raw.slice(32))];
  return new Uint8Array([0x30, body.length, ...body]);
}

async function authenticator(opts: { signCount?: number; flags?: number; rpId?: string } = {}) {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify'],
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));

  const rpIdHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(opts.rpId ?? RP_ID)),
  );

  const authData = new Uint8Array(37);
  authData.set(rpIdHash, 0);
  authData[32] = opts.flags ?? 0x05; // user present + user verified
  new DataView(authData.buffer).setUint32(33, opts.signCount ?? 0, false);

  const sign = async (clientDataJSON: Uint8Array<ArrayBuffer>): Promise<Uint8Array> => {
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON));
    const signed = new Uint8Array(authData.length + hash.length);
    signed.set(authData, 0);
    signed.set(hash, authData.length);
    const raw = new Uint8Array(
      await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, signed),
    );
    return rawToDer(raw);
  };

  return { publicKey: toB64url(spki), authData: toB64url(authData), sign };
}

const clientData = (over: Record<string, unknown> = {}) => {
  const json = JSON.stringify({
    type: 'webauthn.get',
    challenge: 'CHALLENGE',
    origin: ORIGIN,
    ...over,
  });
  return { json, b64: b64(json), bytes: new TextEncoder().encode(json) as Uint8Array<ArrayBuffer> };
};

const expectation = { challenge: 'CHALLENGE', origin: ORIGIN, rpId: RP_ID };

describe('verifyAssertion', () => {
  it('accepts a genuine signature', async () => {
    const auth = await authenticator({ signCount: 7 });
    const cd = clientData();

    const result = await verifyAssertion(
      {
        credentialId: 'cred-1',
        clientDataJSON: cd.b64,
        authenticatorData: auth.authData,
        signature: toB64url(await auth.sign(cd.bytes)),
      },
      { id: 'cred-1', userId: 'u1', publicKey: auth.publicKey, algorithm: -7, signCount: 3 },
      expectation,
    );

    expect(result.signCount).toBe(7);
    expect(result.cloneSuspected).toBe(false);
  });

  it('accepts genuine signatures repeatedly, whatever r and s come out as', async () => {
    // The DER round trip only fails for some values of r and s. One passing
    // signature proves very little; forty is a real check on the padding.
    const auth = await authenticator();
    const credential = {
      id: 'c', userId: 'u', publicKey: auth.publicKey, algorithm: -7, signCount: 0,
    };

    for (let i = 0; i < 40; i++) {
      const cd = clientData();
      await expect(
        verifyAssertion(
          {
            credentialId: 'c',
            clientDataJSON: cd.b64,
            authenticatorData: auth.authData,
            signature: toB64url(await auth.sign(cd.bytes)),
          },
          credential,
          expectation,
        ),
        `signature ${i}`,
      ).resolves.toBeTruthy();
    }
  });

  it('rejects a signature made for a different challenge', async () => {
    // This is the replay defence, and the reason a passkey beats a password.
    const auth = await authenticator();
    const cd = clientData({ challenge: 'SOMEONE-ELSES' });

    await expect(
      verifyAssertion(
        {
          credentialId: 'c',
          clientDataJSON: cd.b64,
          authenticatorData: auth.authData,
          signature: toB64url(await auth.sign(cd.bytes)),
        },
        { id: 'c', userId: 'u', publicKey: auth.publicKey, algorithm: -7, signCount: 0 },
        expectation,
      ),
    ).rejects.toThrow(WebAuthnError);
  });

  it('rejects an origin that merely ends with ours', async () => {
    // https://shop.example.evil.com passes a naive endsWith and must not pass
    // this. Phishing resistance is the entire point.
    const auth = await authenticator();
    const cd = clientData({ origin: 'https://shop.example.evil.com' });

    await expect(
      verifyAssertion(
        {
          credentialId: 'c',
          clientDataJSON: cd.b64,
          authenticatorData: auth.authData,
          signature: toB64url(await auth.sign(cd.bytes)),
        },
        { id: 'c', userId: 'u', publicKey: auth.publicKey, algorithm: -7, signCount: 0 },
        expectation,
      ),
    ).rejects.toThrow(/not this shop/);
  });

  it('rejects a passkey registered for another site', async () => {
    const auth = await authenticator({ rpId: 'other.example' });
    const cd = clientData();

    await expect(
      verifyAssertion(
        {
          credentialId: 'c',
          clientDataJSON: cd.b64,
          authenticatorData: auth.authData,
          signature: toB64url(await auth.sign(cd.bytes)),
        },
        { id: 'c', userId: 'u', publicKey: auth.publicKey, algorithm: -7, signCount: 0 },
        expectation,
      ),
    ).rejects.toThrow(/different site/);
  });

  it('rejects a signature from a different key', async () => {
    const real = await authenticator();
    const impostor = await authenticator();
    const cd = clientData();

    await expect(
      verifyAssertion(
        {
          credentialId: 'c',
          clientDataJSON: cd.b64,
          authenticatorData: impostor.authData,
          signature: toB64url(await impostor.sign(cd.bytes)),
        },
        { id: 'c', userId: 'u', publicKey: real.publicKey, algorithm: -7, signCount: 0 },
        expectation,
      ),
    ).rejects.toThrow(/did not check out/);
  });

  it('rejects a ceremony where nobody was present', async () => {
    const auth = await authenticator({ flags: 0x00 });
    const cd = clientData();

    await expect(
      verifyAssertion(
        {
          credentialId: 'c',
          clientDataJSON: cd.b64,
          authenticatorData: auth.authData,
          signature: toB64url(await auth.sign(cd.bytes)),
        },
        { id: 'c', userId: 'u', publicKey: auth.publicKey, algorithm: -7, signCount: 0 },
        expectation,
      ),
    ).rejects.toThrow(/nobody was there/);
  });

  it('refuses a passkey used inside another site’s frame', async () => {
    const auth = await authenticator();
    const cd = clientData({ crossOrigin: true });

    await expect(
      verifyAssertion(
        {
          credentialId: 'c',
          clientDataJSON: cd.b64,
          authenticatorData: auth.authData,
          signature: toB64url(await auth.sign(cd.bytes)),
        },
        { id: 'c', userId: 'u', publicKey: auth.publicKey, algorithm: -7, signCount: 0 },
        expectation,
      ),
    ).rejects.toThrow(/frame/);
  });

  describe('the clone counter', () => {
    it('flags a counter that went backwards', async () => {
      const auth = await authenticator({ signCount: 2 });
      const cd = clientData();
      const r = await verifyAssertion(
        {
          credentialId: 'c',
          clientDataJSON: cd.b64,
          authenticatorData: auth.authData,
          signature: toB64url(await auth.sign(cd.bytes)),
        },
        { id: 'c', userId: 'u', publicKey: auth.publicKey, algorithm: -7, signCount: 9 },
        expectation,
      );
      expect(r.cloneSuspected).toBe(true);
    });

    it('does not flag an authenticator that has opted out of counting', async () => {
      // Both zero is legitimate and extremely common on modern platforms.
      // Treating it as a clone would lock out most iPhones.
      const auth = await authenticator({ signCount: 0 });
      const cd = clientData();
      const r = await verifyAssertion(
        {
          credentialId: 'c',
          clientDataJSON: cd.b64,
          authenticatorData: auth.authData,
          signature: toB64url(await auth.sign(cd.bytes)),
        },
        { id: 'c', userId: 'u', publicKey: auth.publicKey, algorithm: -7, signCount: 0 },
        expectation,
      );
      expect(r.cloneSuspected).toBe(false);
    });
  });
});

describe('verifyRegistration', () => {
  const regClientData = (over: Record<string, unknown> = {}) =>
    b64(JSON.stringify({
      type: 'webauthn.create', challenge: 'CHALLENGE', origin: ORIGIN, ...over,
    }));

  it('returns what to store', async () => {
    const auth = await authenticator({ signCount: 5 });
    const stored = await verifyRegistration(
      {
        credentialId: 'cred-1',
        publicKey: auth.publicKey,
        algorithm: -7,
        clientDataJSON: regClientData(),
        authenticatorData: auth.authData,
      },
      expectation,
    );
    expect(stored).toMatchObject({ id: 'cred-1', algorithm: -7, signCount: 5 });
  });

  it('refuses when the browser gave no usable key, rather than at first login', async () => {
    // getPublicKey() returns null for keys the browser cannot express as SPKI.
    // Storing that would register a device that can never sign in.
    const auth = await authenticator();
    await expect(
      verifyRegistration(
        {
          credentialId: 'c', publicKey: '', algorithm: -7,
          clientDataJSON: regClientData(), authenticatorData: auth.authData,
        },
        expectation,
      ),
    ).rejects.toThrow(/usable public key/);
  });

  it('refuses an algorithm it cannot check', async () => {
    const auth = await authenticator();
    await expect(
      verifyRegistration(
        {
          credentialId: 'c', publicKey: auth.publicKey, algorithm: -8,
          clientDataJSON: regClientData(), authenticatorData: auth.authData,
        },
        expectation,
      ),
    ).rejects.toThrow(/cannot check/);
  });

  it('refuses a create ceremony presented as a get', async () => {
    const auth = await authenticator();
    await expect(
      verifyRegistration(
        {
          credentialId: 'c', publicKey: auth.publicKey, algorithm: -7,
          clientDataJSON: b64(JSON.stringify({
            type: 'webauthn.get', challenge: 'CHALLENGE', origin: ORIGIN,
          })),
          authenticatorData: auth.authData,
        },
        expectation,
      ),
    ).rejects.toThrow(/webauthn.create/);
  });
});

describe('derToRaw', () => {
  it('always produces 64 bytes', () => {
    // Short r, short s — the case that needs left-padding.
    const short = new Uint8Array([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02]);
    const raw = derToRaw(short);
    expect(raw).toHaveLength(64);
    expect(raw[31]).toBe(1);
    expect(raw[63]).toBe(2);
  });

  it('strips the sign-padding zero DER adds to a high value', () => {
    const body = [0x02, 0x21, 0x00, ...new Array(32).fill(0xff), 0x02, 0x01, 0x05];
    const raw = derToRaw(new Uint8Array([0x30, body.length, ...body]));
    expect(raw).toHaveLength(64);
    expect(raw[0]).toBe(0xff);
    expect(raw[63]).toBe(5);
  });

  it('rejects something that is not a DER sequence', () => {
    expect(() => derToRaw(new Uint8Array([0x02, 0x01, 0x01]))).toThrow(WebAuthnError);
  });
});

describe('newChallenge', () => {
  it('is long and never repeats', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newChallenge()));
    expect(seen.size).toBe(200);
    expect([...seen][0]!.length).toBeGreaterThanOrEqual(43);
  });
});
