-- Local development seed. NOT applied in production.
--
-- Models the first real shop: a church selling Bible-verse frames. Note the
-- inventory shape, because it is the point — six frame blanks are counted,
-- and every design sells against them. Sixty designs would still be six rows.
--
-- See seeds/apparel.sql for the same schema serving a completely different
-- shop, in a different country and currency. Nothing here is special-cased.

UPDATE setting SET value = 'Cheerfully Given'         WHERE key = 'shop.name';
UPDATE setting SET value = 'A N Other'                WHERE key = 'shop.legal_name';
UPDATE setting SET value = 'Pune, Maharashtra 411001' WHERE key = 'shop.address';
UPDATE setting SET value = 'hello@example.com'        WHERE key = 'shop.support_email';
UPDATE setting SET value = '+91 90000 00000'          WHERE key = 'shop.support_phone';
UPDATE setting SET value = 'Maharashtra'              WHERE key = 'shipping.allowed_regions';
UPDATE setting SET value = '411001'                   WHERE key = 'shipping.origin_postal';

-- Six blanks: three sizes x two frame colours. Small is made to order
-- (tracked = 0) to exercise both paths.
INSERT INTO stock_item (sku, label, on_hand, reserved, tracked) VALUES
  ('blank:s:black',  'Small 8x12 · Black',   0, 0, 0),
  ('blank:s:oak',    'Small 8x12 · Oak',     0, 0, 0),
  ('blank:m:black',  'Medium 12x18 · Black', 6, 0, 1),
  ('blank:m:oak',    'Medium 12x18 · Oak',   4, 0, 1),
  ('blank:l:black',  'Large 16x24 · Black',  2, 0, 1),
  ('blank:l:oak',    'Large 16x24 · Oak',    0, 0, 1);

INSERT INTO product (id, slug, title, summary, body_md, status, meta_json) VALUES
  ('p_psalm23', 'psalm-23-the-lord-is-my-shepherd',
   'The Lord is my shepherd (Psalm 23:1)',
   'Hand-finished print on cotton rag, ready to hang.',
   'Printed and framed by volunteers. Wipe with a dry cloth; keep off damp walls and out of direct sunlight.',
   'active',
   -- Translation and licence status are first-class: a design whose translation
   -- is unlicensed must never reach the storefront.
   '{"verse_ref":"Psalm 23:1","translation":"WEB","licence":"public_domain","language":"en"}'),

  ('p_josh1', 'joshua-1-9-be-strong-and-courageous',
   'Be strong and courageous (Joshua 1:9)',
   'Hand-finished print on cotton rag, ready to hang.',
   NULL, 'active',
   '{"verse_ref":"Joshua 1:9","translation":"WEB","licence":"public_domain","language":"en"}');

-- This shop's axes. The names are data, so the storefront picker reads
-- "Size" and "Frame" without a line of shop-specific code (ADR-0016).
INSERT INTO product_option (product_id, position, name) VALUES
  ('p_psalm23', 1, 'Size'),
  ('p_psalm23', 2, 'Frame'),
  ('p_josh1',   1, 'Size'),
  ('p_josh1',   2, 'Frame');

-- Dimensions are the PACKED carton, not the frame: couriers bill on
-- max(dead weight, L*W*H/5000), so a light, bulky parcel is priced on its box.
INSERT INTO variant
  (id, product_id, sku, option_1, option_2, price_minor, weight_g, len_mm, wid_mm, hgt_mm, position) VALUES
  ('v1', 'p_psalm23', 'blank:s:black', '8x12 in',  'Black',  89900,  600, 280, 380, 60, 1),
  ('v2', 'p_psalm23', 'blank:m:black', '12x18 in', 'Black', 139900,  900, 380, 530, 60, 2),
  ('v3', 'p_psalm23', 'blank:m:oak',   '12x18 in', 'Oak',   149900,  900, 380, 530, 60, 3),
  ('v4', 'p_psalm23', 'blank:l:black', '16x24 in', 'Black', 219900, 1400, 480, 690, 60, 4),
  ('v5', 'p_josh1',   'blank:m:black', '12x18 in', 'Black', 139900,  900, 380, 530, 60, 1),
  ('v6', 'p_josh1',   'blank:l:oak',   '16x24 in', 'Oak',   229900, 1400, 480, 690, 60, 2);
