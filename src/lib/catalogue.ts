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

export interface ProductDetail {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  bodyMd: string | null;
  meta: Record<string, unknown>;
  /** The vendor's own axis names, in order: ["Size", "Colour"]. Empty = no picker. */
  optionNames: string[];
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
        `SELECT name FROM product_option WHERE product_id = ?1 ORDER BY position`,
      )
      .bind(product.id),
  ]);

  // `batch()` returns one result per statement, in order. Read them by index
  // rather than destructuring so a shape change is a cast error, not a crash.
  const rows = <T,>(i: number): T[] => (batch[i]?.results ?? []) as unknown as T[];

  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    summary: product.summary,
    bodyMd: product.bodyMd,
    meta: safeJson(product.metaJson),
    optionNames: rows<{ name: string }>(2).map((o) => o.name),
    variants: rows<Omit<Variant, 'available'> & { available: number }>(0).map((v) => ({
      ...v,
      available: v.available === 1,
    })),
    imageKeys: rows<{ r2_key: string }>(1).map((i) => i.r2_key),
  };
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
