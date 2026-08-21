import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { currentAdmin, isUnclaimed } from './lib/admin/auth';
import { ensureSchema } from './lib/db/bootstrap';
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

  // A shop installed by the Deploy button may never have had its migrations
  // run: Cloudflare provisions the database but not the schema, and the deploy
  // command it uses is whatever was in that field on the setup page. This costs
  // one indexed query on a cold isolate and nothing afterwards.
  try {
    await ensureSchema(env.DB);
  } catch (err) {
    console.error('bootstrap: could not build the schema', err);
    return new Response(
      'This shop could not set up its database. If you have just installed it, ' +
        'check that the D1 binding named DB points at a real database, then reload.',
      { status: 503, headers: { 'content-type': 'text/plain', 'retry-after': '30' } },
    );
  }

  context.locals.settings = await getSettings(env.DB, path);

  if (!path.startsWith('/admin')) return next();

  const who = await currentAdmin(
    env.DB,
    context.cookies,
    context.request,
    env.SESSION_SECRET,
    // Absent means Access is not in use, and every Access header is then
    // ignored outright. A shop that has never heard of Zero Trust cannot be
    // attacked through a feature it does not use.
    { teamDomain: env.ACCESS_TEAM_DOMAIN, policyAud: env.ACCESS_POLICY_AUD },
  );
  context.locals.admin = who.admin;

  // First run. Until somebody claims this shop there is no session to have, so
  // /admin/setup is the only door — and everything else redirects to it rather
  // than showing a login form nobody can satisfy.
  if (await isUnclaimed(env.DB)) {
    const isSetup = path.startsWith('/admin/setup') || path.startsWith('/admin/api/register/');
    return isSetup ? next() : context.redirect('/admin/setup', 303);
  }

  // Access let them through the door and they are not an admin here. Telling
  // them so is the only useful answer — a login form is one they cannot satisfy,
  // and a bare 403 leaves them guessing which of their identities is wrong.
  if (who.stranger) {
    return new Response(
      `Signed in as ${who.stranger}, which is not an administrator of this shop.\n\n` +
        `Ask the shop owner to add this address, or sign in to Cloudflare Access ` +
        `with the account that is.`,
      { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
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
