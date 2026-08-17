/**
 * Writing the answers the setup wizard collected.
 *
 * These are the settings nothing can sensibly default: where the shop is, what
 * it prices in, and what its tax is called. The migration deliberately seeds
 * none of them, so this is the only place they are first written.
 */

import { forgetSettings } from '../settings';

export interface ShopIdentity {
  name: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** ISO 4217. */
  currency: string;
}

/**
 * Currencies with no minor unit, and the one with three.
 *
 * Getting this wrong is not cosmetic: every amount in the system is an integer
 * in minor units, so an exponent of 2 on a yen shop prices everything at a
 * hundredth of what the shopkeeper typed.
 */
const EXPONENTS: Record<string, number> = {
  JPY: 0, KRW: 0, VND: 0, CLP: 0, ISK: 0, UGX: 0, RWF: 0, XAF: 0, XOF: 0, PYG: 0,
  BHD: 3, JOD: 3, KWD: 3, OMR: 3, TND: 3,
};

/**
 * What the vendor's own regime calls its sales tax.
 *
 * Only a label — thela computes nothing from it. The point is that a French
 * shop should not read "GST" and an Indian one should not read "VAT", because a
 * customer reading an invoice notices.
 */
const TAX_LABELS: Record<string, string> = {
  IN: 'GST', AU: 'GST', NZ: 'GST', SG: 'GST', CA: 'GST',
  US: 'Sales tax',
  GB: 'VAT', FR: 'TVA', DE: 'MwSt', ES: 'IVA', IT: 'IVA', NL: 'BTW',
  IE: 'VAT', PT: 'IVA', BE: 'TVA', AE: 'VAT', ZA: 'VAT', KE: 'VAT',
  NG: 'VAT', BR: 'ICMS', JP: 'Consumption tax',
};

/**
 * A reasonable starting locale for a country.
 *
 * Only a start — it is a setting, and a shopkeeper who wants Marathi or Tamil
 * changes it. Guessing here is safe in a way guessing a currency is not,
 * because the worst outcome is digit grouping somebody dislikes rather than a
 * price that is wrong.
 */
const LOCALES: Record<string, string> = {
  IN: 'en-IN', FR: 'fr-FR', DE: 'de-DE', GB: 'en-GB', US: 'en-US',
  AU: 'en-AU', CA: 'en-CA', SG: 'en-SG', AE: 'ar-AE', KE: 'en-KE',
  NG: 'en-NG', BR: 'pt-BR', ZA: 'en-ZA', JP: 'ja-JP',
};

export async function applyShopIdentity(db: D1Database, shop: ShopIdentity): Promise<void> {
  const rows: [string, string][] = [
    ['shop.name', shop.name],
    ['shop.country', shop.country],
    ['shop.locale', LOCALES[shop.country] ?? 'en'],
    ['money.currency', shop.currency],
    ['money.exponent', String(EXPONENTS[shop.currency] ?? 2)],
    ['tax.label', TAX_LABELS[shop.country] ?? 'Tax'],
    // Sell at home by default. Empty would mean "anywhere", which is a bolder
    // promise than a new shop should make on its owner's behalf.
    ['shipping.allowed_countries', shop.country],
  ];

  await db.batch(
    rows.map(([key, value]) =>
      db
        .prepare(
          `INSERT INTO setting (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = datetime('now')`,
        )
        .bind(key, value),
    ),
  );

  forgetSettings();
}
