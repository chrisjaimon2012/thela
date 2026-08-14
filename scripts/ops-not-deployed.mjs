#!/usr/bin/env node
/**
 * The storefront deployed; the ops Worker did not.
 *
 * This is a real and expected outcome rather than a bug. The ops Worker is a
 * second deploy with its own configuration, and the token Cloudflare generates
 * for Workers Builds is scoped narrowly — a shop installed by the Deploy button
 * may simply not be allowed to create a second Worker.
 *
 * That must not fail the build, because the storefront is fine and a shop that
 * cannot sell is worse than a shop that cannot yet confirm payments
 * automatically. So this exits zero and says exactly what is missing and what
 * still works without it.
 */
console.log(`
──────────────────────────────────────────────────────────────────────
  Your shop deployed. The ops Worker did not.

  The ops Worker handles two things:
    • reading bank credit alerts delivered by Email Routing
    • the timers that release unpaid orders and watch for trouble

  Everything else works. You can sell, take orders, mark payments paid
  yourself, upload a bank statement to settle them in bulk, print
  labels and dispatch. Only automatic payment confirmation and the
  background timers are missing.

  To add it, from a clone of your repository:

      npm install
      npx wrangler deploy --config dist/thela_ops/wrangler.json

  Set the database_id in workers/ops/wrangler.jsonc to the same
  database your shop uses first — there is only one, and both Workers
  bind it.
──────────────────────────────────────────────────────────────────────
`);
