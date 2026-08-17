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

  // Appearance. Validated at render time in `lib/theme.ts`, never here — a row
  // edited straight in the D1 console must not reach the stylesheet unchecked.
  themePreset: string;
  themeMode: string;
  /** Empty means "whatever the preset says". The only colour a vendor picks. */
  themeAccent: string;
  themeFont: string;
  themeRadius: string;
  cardRatio: string;
  cardFit: string;

  logoKey: string;
  /** Rendered height in px. Capped in the admin, not here. */
  logoHeight: number;
}

const DEFAULTS: Settings = {
  shopName: 'My Shop',
  legalName: '',
  address: '',
  supportEmail: '',
  supportPhone: '',
  // Empty, not Indian. Absent means "nobody has been asked yet", which the
  // storefront can say honestly; a wrong default it cannot.
  currency: '',
  exponent: 2,
  locale: '',
  country: '',
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
  taxLabel: '',
  taxNumber: '',
  themePreset: 'plain',
  themeMode: 'auto',
  themeAccent: '',
  themeFont: '',
  themeRadius: '',
  cardRatio: '',
  cardFit: '',
  logoKey: '',
  logoHeight: 32,
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
  'theme.preset': (v, s) => (s.themePreset = v),
  'theme.mode': (v, s) => (s.themeMode = v),
  'theme.accent': (v, s) => (s.themeAccent = v),
  'theme.font': (v, s) => (s.themeFont = v),
  'theme.radius': (v, s) => (s.themeRadius = v),
  'theme.card_ratio': (v, s) => (s.cardRatio = v),
  'theme.card_fit': (v, s) => (s.cardFit = v),
  'brand.logo_key': (v, s) => (s.logoKey = v),
  'brand.logo_height': (v, s) => (s.logoHeight = clamp(Number(v) || 32, 20, 56)),
};

/** Bounds live with the setting, not in the form that writes it. */
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

export async function loadSettings(db: D1Database): Promise<Settings> {
  const { results } = await db
    .prepare(`SELECT key, value FROM setting`)
    .all<{ key: string; value: string }>();

  const s: Settings = { ...DEFAULTS };
  for (const row of results) READERS[row.key]?.(row.value, s);
  return s;
}

/**
 * Settings, memoised for the life of a warm isolate.
 *
 * THE ARITHMETIC THAT MAKES THIS NECESSARY
 *
 * `SELECT key, value FROM setting` is a full scan, and D1 bills rows SCANNED.
 * At roughly fifty rows that is fifty against a free-tier budget of 5,000,000
 * rows a day — exactly 100,000 renders, which is also the Workers free-plan
 * request ceiling. One settings read per request already spends the entire
 * budget, leaving nothing for the catalogue queries on the same request. Before
 * this existed the homepage did two and the product page three.
 *
 * WHY SIXTY SECONDS IS THE RIGHT NUMBER, AND NOT A GUESS
 *
 * It is the `s-maxage` the storefront pages already set. The edge is allowed to
 * serve a sixty-second-old page, so a sixty-second-old settings row cannot make
 * the shop any staler than it already is. Any longer and the memo becomes an
 * independent source of staleness the shopkeeper can observe; that is the bound.
 *
 * WHY SOME PATHS BYPASS IT
 *
 * A stale `payment.upi_vpa` sends real money to the wrong account. Sixty seconds
 * of that after a shopkeeper corrects a typo is not acceptable at any cache
 * ratio, and those pages are a tiny fraction of traffic anyway.
 */
const MEMO_TTL_MS = 60_000;

let memo: { at: number; settings: Settings } | null = null;

/** Paths where a stale setting could misdirect money or lock out an admin. */
const NEVER_MEMOISED = /^\/(cart|checkout|pay|order|admin|api)(\/|$)/;

export async function getSettings(db: D1Database, pathname: string): Promise<Settings> {
  const now = Date.now();

  if (!NEVER_MEMOISED.test(pathname) && memo && now - memo.at < MEMO_TTL_MS) {
    return memo.settings;
  }

  try {
    const settings = await loadSettings(db);
    memo = { at: now, settings };
    return settings;
  } catch {
    // A shop that cannot read its settings should still sell. Serving defaults
    // means the wrong shop name for a moment; a 500 means no shop at all. The
    // failure is loud in Workers logs either way.
    return memo?.settings ?? { ...DEFAULTS };
  }
}

/**
 * Drop the memo after an admin write.
 *
 * This only clears the isolate that handled the write — the one the shopkeeper
 * is looking at, so their change appears immediately. Other isolates catch up
 * within the TTL. There is deliberately no cross-isolate invalidation: checking
 * a revision counter would need the very read this memo exists to avoid.
 */
export function forgetSettings(): void {
  memo = null;
}

/**
 * Has anybody told this shop where it is and what it prices in?
 *
 * A shop with no currency cannot show a price, so this is the difference
 * between "not set up yet" and "broken". The storefront asks rather than
 * rendering an amount with no symbol and hoping nobody notices.
 */
export const isConfigured = (s: Settings): boolean => Boolean(s.currency && s.country);

/**
 * The shop's country, spelled the way its own customers spell it — "India" for
 * an en-IN shop, "Inde" for fr-FR. `Intl.DisplayNames` is in workerd, so this
 * costs nothing and saves us shipping a country table.
 */
export function countryName(s: Settings): string {
  try {
    return new Intl.DisplayNames([s.locale || 'en'], { type: 'region' }).of(s.country) ?? s.country;
  } catch {
    // An unknown locale or a malformed country code must not take the page down.
    return s.country;
  }
}

/** Absolute URL for a stored media key. Empty base means media is not configured yet. */
export const mediaUrl = (s: Settings, key: string | null | undefined): string | null =>
  key && s.mediaBaseUrl ? `${s.mediaBaseUrl}/${key}` : null;
