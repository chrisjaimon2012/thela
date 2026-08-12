/**
 * Shop settings.
 *
 * Everything the shopkeeper can change without a redeploy lives in the
 * `setting` table. Secrets do not: API tokens are Worker secrets, so a leaked
 * database backup never contains credentials.
 */

export interface Settings {
  shopName: string;
  legalName: string;
  address: string;
  supportEmail: string;
  supportPhone: string;

  /** R2 custom domain, e.g. https://img.myshop.com. Images never go through the Worker. */
  mediaBaseUrl: string;

  upiVpa: string;
  upiPayee: string;
  /** Minutes an unpaid order holds its stock reservation and its paise slot. */
  holdMinutes: number;

  shippingProvider: string;
  originPincode: string;
  /** Empty means unrestricted. Phase 1 shops list one state. */
  allowedStates: string[];

  /** Phase 1 shops are unregistered: no tax line is rendered anywhere. */
  taxRegistered: boolean;
  taxRateBp: number;
}

const DEFAULTS: Settings = {
  shopName: 'My Shop',
  legalName: '',
  address: '',
  supportEmail: '',
  supportPhone: '',
  mediaBaseUrl: '',
  upiVpa: '',
  upiPayee: '',
  holdMinutes: 60,
  shippingProvider: 'manual',
  originPincode: '',
  allowedStates: [],
  taxRegistered: false,
  taxRateBp: 0,
};

/** Maps `setting.key` onto the typed shape above. One place, so a typo is a type error. */
const READERS: Record<string, (v: string, s: Settings) => void> = {
  'shop.name': (v, s) => (s.shopName = v),
  'shop.legal_name': (v, s) => (s.legalName = v),
  'shop.address': (v, s) => (s.address = v),
  'shop.support_email': (v, s) => (s.supportEmail = v),
  'shop.support_phone': (v, s) => (s.supportPhone = v),
  'media.base_url': (v, s) => (s.mediaBaseUrl = v.replace(/\/$/, '')),
  'payment.upi_vpa': (v, s) => (s.upiVpa = v),
  'payment.upi_payee': (v, s) => (s.upiPayee = v),
  'payment.hold_minutes': (v, s) => (s.holdMinutes = Number(v) || DEFAULTS.holdMinutes),
  'shipping.provider': (v, s) => (s.shippingProvider = v),
  'shipping.origin_pincode': (v, s) => (s.originPincode = v),
  'shipping.allowed_states': (v, s) =>
    (s.allowedStates = v.split(',').map((x) => x.trim()).filter(Boolean)),
  'tax.registered': (v, s) => (s.taxRegistered = v === 'true'),
  'tax.rate_bp': (v, s) => (s.taxRateBp = Number(v) || 0),
};

export async function loadSettings(db: D1Database): Promise<Settings> {
  const { results } = await db
    .prepare(`SELECT key, value FROM setting`)
    .all<{ key: string; value: string }>();

  const s: Settings = { ...DEFAULTS };
  for (const row of results) READERS[row.key]?.(row.value, s);
  return s;
}

/** Absolute URL for a stored media key. Empty base means media is not configured yet. */
export const mediaUrl = (s: Settings, key: string | null | undefined): string | null =>
  key && s.mediaBaseUrl ? `${s.mediaBaseUrl}/${key}` : null;
