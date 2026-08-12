-- A second shop, on the same schema, to keep the genericity claim honest.
--
-- This is a small screen-printing studio in Lyon: euros, French locale, TVA
-- instead of GST, and a completely different idea of what a "product" is. If
-- adding it required one line of code — not data — the model is not generic
-- and ADR-0016 is wrong.
--
-- Deliberate contrasts with seeds/dev.sql:
--
--   * Product = a design; the axes are Size / Colour, not Size / Frame. The
--     axis NAMES are rows in product_option, so the picker relabels itself.
--   * One product carries a THIRD axis (Sleeve), which the church shop has no
--     use for. Unused axes are simply absent rows.
--   * Stock is counted per variant here, not against shared blanks. Same
--     table; the church happens to point many variants at one stock_item and
--     this shop points each variant at its own.
--   * A digital product (a downloadable print file) has no weight or
--     dimensions and is never tracked.
--
-- Apply to a scratch database, not on top of dev.sql:
--   wrangler d1 execute thela --local --file=seeds/apparel.sql

UPDATE setting SET value = 'Atelier Vireux'            WHERE key = 'shop.name';
UPDATE setting SET value = 'Atelier Vireux SARL'       WHERE key = 'shop.legal_name';
UPDATE setting SET value = '12 rue Burdeau, 69001 Lyon' WHERE key = 'shop.address';
UPDATE setting SET value = 'bonjour@example.fr'        WHERE key = 'shop.support_email';
UPDATE setting SET value = 'FR'                        WHERE key = 'shop.country';
UPDATE setting SET value = 'fr-FR'                     WHERE key = 'shop.locale';
UPDATE setting SET value = 'EUR'                       WHERE key = 'money.currency';
UPDATE setting SET value = '2'                         WHERE key = 'money.exponent';
UPDATE setting SET value = '69001'                     WHERE key = 'shipping.origin_postal';
UPDATE setting SET value = 'FR,BE,LU'                  WHERE key = 'shipping.allowed_countries';
UPDATE setting SET value = ''                          WHERE key = 'shipping.allowed_regions';
UPDATE setting SET value = 'TVA'                       WHERE key = 'tax.label';
UPDATE setting SET value = 'true'                      WHERE key = 'tax.registered';
UPDATE setting SET value = '2000'                      WHERE key = 'tax.rate_bp';  -- 20.00%
UPDATE setting SET value = 'FR12345678901'             WHERE key = 'tax.number';

-- Counted per variant: this studio prints ahead and shelves the results.
INSERT INTO stock_item (sku, label, on_hand, reserved, tracked) VALUES
  ('velo-s-noir',   'Vélo · S · Noir',    4, 0, 1),
  ('velo-m-noir',   'Vélo · M · Noir',    9, 0, 1),
  ('velo-m-creme',  'Vélo · M · Crème',   3, 0, 1),
  ('velo-l-noir',   'Vélo · L · Noir',    0, 0, 1),
  ('quai-m-ecru-c', 'Quai · M · Écru · Courtes', 6, 0, 1),
  ('quai-m-ecru-l', 'Quai · M · Écru · Longues', 2, 0, 1),
  ('quai-l-ecru-c', 'Quai · L · Écru · Courtes', 5, 0, 1),
  ('affiche-quai',  'Quai · fichier imprimable', 0, 0, 0);

INSERT INTO product (id, slug, title, summary, status, meta_json) VALUES
  ('p_velo', 'velo-lyonnais', 'Vélo lyonnais',
   'Sérigraphie deux couleurs sur coton biologique.', 'active',
   '{"printed_in":"Lyon","gots_certified":true}'),
  ('p_quai', 'quais-de-saone', 'Quais de Saône',
   'Sérigraphie une couleur, encre à l''eau.', 'active',
   '{"printed_in":"Lyon","gots_certified":true}'),
  ('p_quai_dl', 'quais-de-saone-fichier', 'Quais de Saône — fichier',
   'Fichier haute résolution à imprimer soi-même.', 'active', '{}');

-- Two axes for one design, three for another, none for the download.
INSERT INTO product_option (product_id, position, name) VALUES
  ('p_velo', 1, 'Taille'),
  ('p_velo', 2, 'Couleur'),
  ('p_quai', 1, 'Taille'),
  ('p_quai', 2, 'Couleur'),
  ('p_quai', 3, 'Manches');

INSERT INTO variant
  (id, product_id, sku, option_1, option_2, option_3, price_minor,
   weight_g, len_mm, wid_mm, hgt_mm, position) VALUES
  ('fv1', 'p_velo', 'velo-s-noir',   'S', 'Noir',  NULL, 3200, 220, 300, 250, 30, 1),
  ('fv2', 'p_velo', 'velo-m-noir',   'M', 'Noir',  NULL, 3200, 240, 300, 250, 30, 2),
  ('fv3', 'p_velo', 'velo-m-creme',  'M', 'Crème', NULL, 3200, 240, 300, 250, 30, 3),
  ('fv4', 'p_velo', 'velo-l-noir',   'L', 'Noir',  NULL, 3400, 260, 300, 250, 30, 4),
  ('fv5', 'p_quai', 'quai-m-ecru-c', 'M', 'Écru', 'Courtes', 2900, 230, 300, 250, 30, 1),
  ('fv6', 'p_quai', 'quai-m-ecru-l', 'M', 'Écru', 'Longues', 3500, 290, 300, 250, 35, 2),
  ('fv7', 'p_quai', 'quai-l-ecru-c', 'L', 'Écru', 'Courtes', 2900, 250, 300, 250, 30, 3),
  -- No axes, no parcel: a digital line never reaches a carrier.
  ('fv8', 'p_quai_dl', 'affiche-quai', NULL, NULL, NULL, 900,
   NULL, NULL, NULL, NULL, 1);
