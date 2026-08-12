/**
 * Catalogue reads.
 *
 * Every SQL statement about products lives here; pages and endpoints never
 * write SQL. That keeps the availability rule — which is subtle — in exactly
 * one place.
 */

import type { Minor } from './payments/types';

export interface ProductCard {
  slug: string;
  title: string;
  summary: string | null;
  fromMinor: Minor;
  imageKey: string | null;
  /** False when every variant is out of stock, so the card can say so. */
  anyAvailable: boolean;
}

export interface Variant {
  id: string;
  sku: string;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  priceMinor: Minor;
  weightG: number;
  lenMm: number;
  widMm: number;
  hgtMm: number;
  available: boolean;
}

/**
 * One option axis, ready to render as one `<select>`.
 *
 * The name is the vendor's — "Size", "Taille", "Frame", "Manches" — and the
 * values are the distinct ones their variants actually use, in the order the
 * vendor put them in. Computing this here rather than in the page is what lets
 * the same template serve a two-axis framer and a three-axis print studio.
 */
export interface OptionAxis {
  /** 1, 2 or 3 — which `option_N` column this axis reads. */
  position: number;
  name: string;
  values: string[];
}

export interface ProductDetail {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  bodyMd: string | null;
  meta: Record<string, unknown>;
  /** Empty for a product with no options, which has exactly one variant. */
  axes: OptionAxis[];
  variants: Variant[];
  imageKeys: string[];
}

/**
 * A variant is sellable when its stock row is untracked (made to order) or has
 * uncommitted units left. `reserved` counts orders awaiting payment, so this
 * naturally excludes stock already spoken for.
 */
const AVAILABLE_SQL = `(s.tracked = 0 OR (s.on_hand - s.reserved) > 0)`;

export async function listProducts(db: D1Database): Promise<ProductCard[]> {
  const { results } = await db
    .prepare(
      `SELECT p.slug,
              p.title,
              p.summary,
              MIN(v.price_minor)                        AS fromMinor,
              MAX(${AVAILABLE_SQL})                     AS anyAvailable,
              (SELECT r2_key FROM product_image i
                WHERE i.product_id = p.id
                ORDER BY i.position LIMIT 1)            AS imageKey
         FROM product p
         JOIN variant v ON v.product_id = p.id AND v.active = 1
         JOIN stock_item   s ON s.sku = v.sku
        WHERE p.status = 'active'
        GROUP BY p.id
        ORDER BY p.created_at DESC`,
    )
    .all<Omit<ProductCard, 'anyAvailable'> & { anyAvailable: number }>();

  return results.map((r) => ({ ...r, anyAvailable: r.anyAvailable === 1 }));
}

export async function getProduct(
  db: D1Database,
  slug: string,
): Promise<ProductDetail | null> {
  const product = await db
    .prepare(
      `SELECT id, slug, title, summary, body_md AS bodyMd, meta_json AS metaJson
         FROM product WHERE slug = ?1 AND status = 'active'`,
    )
    .bind(slug)
    .first<{
      id: string; slug: string; title: string;
      summary: string | null; bodyMd: string | null; metaJson: string;
    }>();

  if (!product) return null;

  // One round trip for all three child collections.
  const batch = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT v.id, v.sku,
                v.option_1 AS option1, v.option_2 AS option2, v.option_3 AS option3,
                v.price_minor AS priceMinor,
                v.weight_g AS weightG, v.len_mm AS lenMm,
                v.wid_mm AS widMm, v.hgt_mm AS hgtMm,
                ${AVAILABLE_SQL} AS available
           FROM variant v JOIN stock_item s ON s.sku = v.sku
          WHERE v.product_id = ?1 AND v.active = 1
          ORDER BY v.position`,
      )
      .bind(product.id),
    db
      .prepare(
        `SELECT r2_key FROM product_image WHERE product_id = ?1 ORDER BY position`,
      )
      .bind(product.id),
    db
      .prepare(
        `SELECT position, name FROM product_option WHERE product_id = ?1 ORDER BY position`,
      )
      .bind(product.id),
  ]);

  // `batch()` returns one result per statement, in order. Read them by index
  // rather than destructuring so a shape change is a cast error, not a crash.
  const rows = <T,>(i: number): T[] => (batch[i]?.results ?? []) as unknown as T[];

  const variants = rows<Omit<Variant, 'available'> & { available: number }>(0).map((v) => ({
    ...v,
    available: v.available === 1,
  }));

  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    summary: product.summary,
    bodyMd: product.bodyMd,
    meta: safeJson(product.metaJson),
    axes: buildAxes(rows<{ position: number; name: string }>(2), variants),
    variants,
    imageKeys: rows<{ r2_key: string }>(1).map((i) => i.r2_key),
  };
}

/**
 * Turn the declared axes plus the variant rows into pickers.
 *
 * An axis with fewer than two distinct values is dropped: offering a choice of
 * one is noise, and the checkout takes the value from the variant anyway. An
 * axis a vendor declared but never populated disappears the same way, which is
 * the forgiving behaviour — a half-finished product still sells.
 */
function buildAxes(
  declared: { position: number; name: string }[],
  variants: Variant[],
): OptionAxis[] {
  const valueAt = (v: Variant, position: number): string | null =>
    position === 1 ? v.option1 : position === 2 ? v.option2 : v.option3;

  return declared
    .map((d) => ({
      position: d.position,
      name: d.name,
      // Set preserves insertion order, so this is the vendor's own ordering by
      // variant position rather than something alphabetical they did not ask for.
      values: [
        ...new Set(
          variants
            .map((v) => valueAt(v, d.position))
            .filter((x): x is string => Boolean(x)),
        ),
      ],
    }))
    .filter((a) => a.values.length > 1);
}

/** Product `meta_json` is shopkeeper-editable, so a malformed value must not 500 the page. */
function safeJson(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
