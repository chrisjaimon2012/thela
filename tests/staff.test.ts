import { describe, expect, it } from 'vitest';
import { can, refusal, settingNeedsOwner } from '../src/lib/admin/staff';
import type { Admin } from '../src/lib/admin/auth';

const owner: Admin = { id: '1', email: 'o@x.com', name: 'O', role: 'owner', via: 'passkey' };
const staff: Admin = { id: '2', email: 's@x.com', name: 'S', role: 'staff', via: 'passkey' };

describe('capabilities', () => {
  it('lets staff run the shop', () => {
    expect(can(staff, 'read')).toBe(true);
    expect(can(staff, 'operate')).toBe(true);
  });

  it('does not let staff move where money goes', () => {
    // The single most valuable action in the system.
    expect(can(staff, 'money')).toBe(false);
    expect(can(staff, 'people')).toBe(false);
  });

  it('gives an owner everything', () => {
    for (const c of ['read', 'operate', 'money', 'people'] as const) {
      expect(can(owner, c)).toBe(true);
    }
  });

  it('gives nobody anything', () => {
    for (const c of ['read', 'operate', 'money', 'people'] as const) {
      expect(can(null, c)).toBe(false);
    }
  });
});

describe('settingNeedsOwner', () => {
  it('protects every setting that redirects or reinterprets money', () => {
    for (const key of [
      'payment.upi_vpa', 'payment.provider',
      'money.currency', 'money.exponent',
      'tax.registered', 'tax.number',
      'media.base_url', 'security.cart_key',
      'shop.country', 'shop.legal_name',
    ]) {
      expect(settingNeedsOwner(key), key).toBe(true);
    }
  });

  it('leaves the everyday ones to staff', () => {
    for (const key of [
      'shop.name', 'shop.support_email', 'shop.support_phone', 'shop.address',
      'theme.preset', 'theme.accent', 'brand.logo_key',
      'shipping.origin_postal', 'shipping.provider',
    ]) {
      expect(settingNeedsOwner(key), key).toBe(false);
    }
  });

  it('restricts an unknown setting under a protected prefix by default', () => {
    // A setting added later should be owner-only until somebody thinks about
    // it. That is the failure direction that costs nothing.
    expect(settingNeedsOwner('payment.something_invented_later')).toBe(true);
    expect(settingNeedsOwner('tax.new_regime_field')).toBe(true);
  });
});

describe('refusal', () => {
  it('says what a shopkeeper needs to know, not what the code did', () => {
    expect(refusal('money')).toMatch(/owner can change where payments go/);
    expect(refusal('people')).toMatch(/owner can add or remove people/);
    for (const c of ['read', 'operate', 'money', 'people'] as const) {
      expect(refusal(c)).not.toMatch(/capability|role|403|denied/i);
    }
  });
});
