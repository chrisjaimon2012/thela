import { describe, expect, it } from 'vitest';
import { verifyAccess } from '../src/lib/admin/access';

/**
 * The regression test for a real vulnerability.
 *
 * This code used to trust `Cf-Access-Authenticated-User-Email` outright. The
 * Worker is reachable at its workers.dev address and at every route bound to
 * it, so a request that never passed through Access could set that header to
 * anything and become an administrator — with the power to change the payee
 * and redirect every future customer payment.
 *
 * Cloudflare says so themselves: "Validation of the header alone is not
 * sufficient — the JWT and signature must be confirmed to avoid identity
 * spoofing."
 */

const withHeaders = (h: Record<string, string>) =>
  new Request('https://shop.example/admin', { headers: h });

const CONFIG = {
  teamDomain: 'https://team.cloudflareaccess.com',
  policyAud: 'aud-tag-for-this-app',
};

describe('verifyAccess', () => {
  it('ignores a forged email header with no token at all', async () => {
    // THE ATTACK. This must never return an identity.
    const req = withHeaders({ 'cf-access-authenticated-user-email': 'owner@shop.example' });
    expect(await verifyAccess(req, CONFIG)).toBeNull();
  });

  it('ignores an unsigned token that merely looks like a JWT', async () => {
    const b64 = (o: unknown) =>
      btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const forged = [
      b64({ alg: 'RS256', kid: 'whatever' }),
      b64({
        email: 'owner@shop.example',
        aud: CONFIG.policyAud,
        iss: CONFIG.teamDomain,
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
      b64('not-a-signature'),
    ].join('.');

    expect(await verifyAccess(withHeaders({ 'cf-access-jwt-assertion': forged }), CONFIG)).toBeNull();
  });

  it('refuses the "alg: none" downgrade', async () => {
    const b64 = (o: unknown) =>
      btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const forged = [
      b64({ alg: 'none', kid: 'x' }),
      b64({ email: 'owner@shop.example', aud: CONFIG.policyAud, iss: CONFIG.teamDomain,
            exp: Math.floor(Date.now() / 1000) + 3600 }),
      '',
    ].join('.');

    expect(await verifyAccess(withHeaders({ 'cf-access-jwt-assertion': forged }), CONFIG)).toBeNull();
  });

  it('ignores Access entirely when it is not configured', async () => {
    // Safe by default: a shop that has never heard of Zero Trust cannot be
    // attacked through a feature it does not use.
    const req = withHeaders({
      'cf-access-jwt-assertion': 'anything',
      'cf-access-authenticated-user-email': 'owner@shop.example',
    });
    expect(await verifyAccess(req, {})).toBeNull();
    expect(await verifyAccess(req, { teamDomain: CONFIG.teamDomain })).toBeNull();
    expect(await verifyAccess(req, { policyAud: CONFIG.policyAud })).toBeNull();
  });

  it('returns null rather than throwing on rubbish', async () => {
    for (const token of ['', '.', 'a.b', 'a.b.c.d', 'not base64 at all', '...']) {
      await expect(
        verifyAccess(withHeaders({ 'cf-access-jwt-assertion': token }), CONFIG),
      ).resolves.toBeNull();
    }
  });
});
