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

  /** ISO 4217. Every amount in the system is an integer in this currency's minor units. */
  currency: string;
  /** Minor-unit exponent: 2 for INR/EUR/USD, 0 for JPY. */
  exponent: number;
  locale: string;
  country: string;

  /** R2 custom domain, e.g. https://img.myshop.com. Images never go through the Worker. */
  mediaBaseUrl: string;

  upiVpa: string;
  upiPayee: string;
  /** Minutes an unpaid order holds its stock reservation and its minor-unit slot. */
  holdMinutes: number;

  shippingProvider: string;
  originPostal: string;
  /** Empty means unrestricted. A shop serving one region lists it here. */
  allowedRegions: string[];
  allowedCountries: string[];

  /** Phase 1 shops are unregistered: no tax line is rendered anywhere. */
  taxRegistered: boolean;
  taxRateBp: number;
  /** "GST", "VAT", "Sales tax" — whatever the vendor's regime calls it. */
  taxLabel: string;
  taxNumber: string;
}

const DEFAULTS: Settings = {
  shopName: 'My Shop',
  legalName: '',
  address: '',
  supportEmail: '',
  supportPhone: '',
  currency: 'INR',
  exponent: 2,
  locale: 'en-IN',
  country: 'IN',
  mediaBaseUrl: '',
  upiVpa: '',
  upiPayee: '',
  holdMinutes: 60,
  shippingProvider: 'manual',
  originPostal: '',
  allowedRegions: [],
  allowedCountries: [],
  taxRegistered: false,
  taxRateBp: 0,
  taxLabel: 'Tax',
  taxNumber: '',
};

/** Maps `setting.key` onto the typed shape above. One place, so a typo is a type error. */
const READERS: Record<string, (v: string, s: Settings) => void> = {
  'shop.name': (v, s) => (s.shopName = v),
  'shop.legal_name': (v, s) => (s.legalName = v),
  'shop.address': (v, s) => (s.address = v),
  'shop.support_email': (v, s) => (s.supportEmail = v),
  'shop.support_phone': (v, s) => (s.supportPhone = v),
  'shop.country': (v, s) => (s.country = v),
  'shop.locale': (v, s) => (s.locale = v),
  'money.currency': (v, s) => (s.currency = v),
  'money.exponent': (v, s) => (s.exponent = Number(v) || 2),
  'media.base_url': (v, s) => (s.mediaBaseUrl = v.replace(/\/$/, '')),
  'payment.upi_vpa': (v, s) => (s.upiVpa = v),
  'payment.upi_payee': (v, s) => (s.upiPayee = v),
  'payment.hold_minutes': (v, s) => (s.holdMinutes = Number(v) || DEFAULTS.holdMinutes),
  'shipping.provider': (v, s) => (s.shippingProvider = v),
  'shipping.origin_postal': (v, s) => (s.originPostal = v),
  'shipping.allowed_regions': (v, s) =>
    (s.allowedRegions = v.split(',').map((x) => x.trim()).filter(Boolean)),
  'shipping.allowed_countries': (v, s) =>
    (s.allowedCountries = v.split(',').map((x) => x.trim()).filter(Boolean)),
  'tax.registered': (v, s) => (s.taxRegistered = v === 'true'),
  'tax.rate_bp': (v, s) => (s.taxRateBp = Number(v) || 0),
  'tax.label': (v, s) => (s.taxLabel = v),
  'tax.number': (v, s) => (s.taxNumber = v),
};

export async function loadSettings(db: D1Database): Promise<Settings> {
  const { results } = await db
    .prepare(`SELECT key, value FROM setting`)
    .all<{ key: string; value: string }>();

  const s: Settings = { ...DEFAULTS };
  for (const row of results) READERS[row.key]?.(row.value, s);
  return s;
}

/**
 * The shop's country, spelled the way its own customers spell it — "India" for
 * an en-IN shop, "Inde" for fr-FR. `Intl.DisplayNames` is in workerd, so this
 * costs nothing and saves us shipping a country table.
 */
export function countryName(s: Settings): string {
  try {
    return new Intl.DisplayNames([s.locale], { type: 'region' }).of(s.country) ?? s.country;
  } catch {
    // An unknown locale or a malformed country code must not take the page down.
    return s.country;
  }
}

/** Absolute URL for a stored media key. Empty base means media is not configured yet. */
export const mediaUrl = (s: Settings, key: string | null | undefined): string | null =>
  key && s.mediaBaseUrl ? `${s.mediaBaseUrl}/${key}` : null;
