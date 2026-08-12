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

/**
 * The variant a customer picked, identified by product slug plus one value per
 * axis. Absent values match NULL, so a product with no options resolves with an
 * empty selection.
 *
 * `ifnull(x, '')` mirrors the `variant_grid` index exactly. Writing it as
 * `option_1 = ?` would silently never match a NULL axis, which is the failure
 * a one-axis shop would hit on its very first order.
 */
export async function findVariant(
  db: D1Database,
  slug: string,
  options: [string | null, string | null, string | null],
): Promise<{ id: string; sku: string; priceMinor: Minor; available: boolean } | null> {
  const row = await db
    .prepare(
      `SELECT v.id, v.sku, v.price_minor AS priceMinor, ${AVAILABLE_SQL} AS available
         FROM variant v
         JOIN product p    ON p.id  = v.product_id
         JOIN stock_item s ON s.sku = v.sku
        WHERE p.slug = ?1 AND p.status = 'active' AND v.active = 1
          AND ifnull(v.option_1, '') = ?2
          AND ifnull(v.option_2, '') = ?3
          AND ifnull(v.option_3, '') = ?4`,
    )
    .bind(slug, options[0] ?? '', options[1] ?? '', options[2] ?? '')
    .first<{ id: string; sku: string; priceMinor: number; available: number }>();

  return row ? { ...row, available: row.available === 1 } : null;
}

/** A cart line with everything the cart page and the checkout both need. */
export interface PricedLine {
  variantId: string;
  sku: string;
  slug: string;
  title: string;
  /** "12x18 in · Oak", built from whichever axes this variant actually uses. */
  optionLabel: string;
  qty: number;
  unitMinor: Minor;
  lineMinor: Minor;
  imageKey: string | null;
  /** False when the variant vanished, was archived, or sold out since it was added. */
  available: boolean;
  /** Units a customer may still order. `null` for an untracked, made-to-order item. */
  maxQty: number | null;
}

/**
 * Price a cart against the live catalogue.
 *
 * Prices are read here, every time, and never carried in the cart cookie. A
 * cookie the customer holds is input, not a record — trusting a price in it
 * would let anyone name their own.
 *
 * Lines whose variant no longer exists are dropped rather than errored: a
 * shopkeeper deleting a product must not make the cart page un-renderable for
 * whoever had it open. The caller compares counts to tell the customer.
 */
export async function priceLines(
  db: D1Database,
  wanted: { variantId: string; qty: number }[],
): Promise<PricedLine[]> {
  if (wanted.length === 0) return [];

  const placeholders = wanted.map((_, i) => `?${i + 1}`).join(', ');
  const { results } = await db
    .prepare(
      `SELECT v.id AS variantId, v.sku, p.slug, p.title,
              v.option_1 AS o1, v.option_2 AS o2, v.option_3 AS o3,
              v.price_minor AS unitMinor,
              ${AVAILABLE_SQL}                       AS available,
              CASE WHEN s.tracked = 0 THEN NULL
                   ELSE s.on_hand - s.reserved END   AS maxQty,
              (SELECT r2_key FROM product_image i
                WHERE i.product_id = p.id
                ORDER BY i.position LIMIT 1)          AS imageKey
         FROM variant v
         JOIN product p    ON p.id  = v.product_id
         JOIN stock_item s ON s.sku = v.sku
        WHERE v.id IN (${placeholders})`,
    )
    .bind(...wanted.map((w) => w.variantId))
    .all<{
      variantId: string; sku: string; slug: string; title: string;
      o1: string | null; o2: string | null; o3: string | null;
      unitMinor: number; available: number; maxQty: number | null;
      imageKey: string | null;
    }>();

  const byId = new Map(results.map((r) => [r.variantId, r]));

  // Iterate `wanted`, not `results`: the customer's ordering is theirs, and
  // SQL gives no order guarantee for an IN list.
  return wanted.flatMap((w) => {
    const r = byId.get(w.variantId);
    if (!r) return [];
    return [{
      variantId: r.variantId,
      sku: r.sku,
      slug: r.slug,
      title: r.title,
      optionLabel: [r.o1, r.o2, r.o3].filter(Boolean).join(' · '),
      qty: w.qty,
      unitMinor: r.unitMinor,
      lineMinor: r.unitMinor * w.qty,
      imageKey: r.imageKey,
      available: r.available === 1,
      maxQty: r.maxQty,
    }];
  });
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
