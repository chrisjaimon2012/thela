/**
 * Who may do what.
 *
 * `admin_user.role` has existed since the first admin migration and nothing has
 * ever read it, which means every staff member has been an owner. That is fine
 * for a one-person shop and wrong the moment a volunteer is added.
 *
 * The split is not about seniority. It is about which actions redirect money:
 *
 *   * A `staff` member runs the shop day to day — reads orders, marks payments,
 *     dispatches parcels, edits the catalogue.
 *   * An `owner` additionally controls where money goes and who else gets in.
 *
 * `payment.upi_vpa` is the reason this exists. Whoever can change it redirects
 * every future customer payment to an account of their choosing, and the shop
 * carries on looking completely normal until somebody checks their bank. That
 * is the highest-value action in the system and it belongs to the person whose
 * bank account it is.
 */

import type { Admin } from './auth';

export type Capability =
  /** Read orders, customers, payments. */
  | 'read'
  /** Mark paid, settle a credit, dispatch, edit the catalogue. */
  | 'operate'
  /** Change the payee, the currency, the shop's identity. */
  | 'money'
  /** Add and remove other admins. */
  | 'people';

const BY_ROLE: Record<Admin['role'], Capability[]> = {
  staff: ['read', 'operate'],
  owner: ['read', 'operate', 'money', 'people'],
};

export const can = (admin: Admin | null, capability: Capability): boolean =>
  Boolean(admin && BY_ROLE[admin.role].includes(capability));

/**
 * Settings only an owner may change.
 *
 * An allowlist of the dangerous ones rather than a denylist of the safe ones:
 * a setting added later is restricted until somebody thinks about it, which is
 * the failure direction that costs nothing.
 */
const OWNER_ONLY = [
  'payment.',      // the payee. The whole reason this file exists.
  'money.',        // currency and exponent — reinterprets every price
  'shop.country',
  'shop.legal_name',
  'tax.',          // what the shop claims about its own registration
  'media.base_url',
  'security.',
];

export const settingNeedsOwner = (key: string): boolean =>
  OWNER_ONLY.some((prefix) => key === prefix || key.startsWith(prefix));

/** Wording a shopkeeper can act on, for when the answer is no. */
export const refusal = (capability: Capability): string =>
  capability === 'money'
    ? 'Only the shop owner can change where payments go.'
    : capability === 'people'
      ? 'Only the shop owner can add or remove people.'
      : 'Your account cannot do that.';
