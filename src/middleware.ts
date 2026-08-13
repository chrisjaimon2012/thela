import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { currentAdmin, isUnclaimed } from './lib/admin/auth';
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
/**
 * Reachable without a session. Everything else under /admin is not.
 *
 * The API routes have to be here too, and forgetting them is not a small bug:
 * the middleware redirects the very calls that would create a session, so
 * sign-in fails with a 303 to the page you are already on and no error anywhere.
 * Only the register and login ceremonies — never all of /admin/api.
 */
const PUBLIC_ADMIN =
  /^\/admin\/(setup|login|recover|api\/(register|login)\/(start|finish))(\/|$)/;

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;
  context.locals.settings = await getSettings(env.DB, path);

  if (!path.startsWith('/admin')) return next();

  context.locals.admin = await currentAdmin(
    env.DB,
    context.cookies,
    context.request,
    env.SESSION_SECRET,
  );

  // First run. Until somebody claims this shop there is no session to have, so
  // /admin/setup is the only door — and everything else redirects to it rather
  // than showing a login form nobody can satisfy.
  if (await isUnclaimed(env.DB)) {
    const isSetup = path.startsWith('/admin/setup') || path.startsWith('/admin/api/register/');
    return isSetup ? next() : context.redirect('/admin/setup', 303);
  }

  if (context.locals.admin || PUBLIC_ADMIN.test(path)) return next();

  // An API call gets a status it can act on, not a redirect to an HTML page it
  // would then try to parse as JSON.
  if (path.startsWith('/admin/api/')) {
    return new Response(JSON.stringify({ error: 'Sign in first.' }), {
      status: 401,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }

  // Carry where they were going, so signing in lands them there rather than on
  // a dashboard they then have to navigate away from.
  const to = encodeURIComponent(path + context.url.search);
  return context.redirect(`/admin/login?to=${to}`, 303);
});
