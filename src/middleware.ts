import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { getSettings } from './lib/settings';

/**
 * Load the shop's settings exactly once per request.
 *
 * Every page needs them — the layout for the shop name and footer, the
 * storefront for currency and locale, the product page for the tax regime — and
 * before this each of those called `loadSettings` independently. Three full
 * table scans to render one product page, against a free-tier budget that only
 * affords one. See the note on `getSettings` for the arithmetic.
 *
 * Anything that needs settings reads `Astro.locals.settings`. Nothing calls
 * `loadSettings` directly outside this file and the admin.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.settings = await getSettings(env.DB, context.url.pathname);
  return next();
});
