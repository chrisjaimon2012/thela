/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

/**
 * Bindings declared in wrangler.jsonc, plus secrets set with
 * `wrangler secret put`.
 *
 * Hand-written rather than `wrangler types`-generated: it is short, it is the
 * canonical list of everything the shop can touch, and a generated file would
 * not carry the comments explaining why each one exists.
 *
 * It MUST be declared inside `namespace Cloudflare`. `import { env } from
 * 'cloudflare:workers'` is typed as `Cloudflare.Env`, which workers-types
 * declares empty and expects projects to extend by declaration merging. A
 * bare global `interface Env` compiles perfectly and types nothing — every
 * `env.DB` silently becomes an error nobody sees until `astro check` runs.
 */
declare namespace Cloudflare {
  interface Env {
    /** The ledger. Sole source of truth for products, stock and orders. */
    DB: D1Database;
    /**
     * Product photography, served from an R2 custom domain and never through
     * the Worker.
     *
     * Optional, and every use site must handle its absence. R2 needs a payment
     * method on the account before a bucket can be created, so a default
     * install has none — see the long comment in wrangler.jsonc. A shop with no
     * MEDIA still sells; it just has no pictures until the owner opts in.
     */
    MEDIA?: R2Bucket;
    /** Generated shipping labels. Optional for the same reason as MEDIA. */
    LABELS?: R2Bucket;

    CHECKOUT_LIMIT: RateLimit;
    UTR_LIMIT: RateLimit;

    SHOP_ENV: string;

    /**
     * Cloudflare Access, both required together or Access is ignored entirely.
     * `ACCESS_TEAM_DOMAIN` is https://<team>.cloudflareaccess.com;
     * `ACCESS_POLICY_AUD` is the application's AUD tag. Pinning the audience
     * stops a token minted for another application in the same Zero Trust
     * organisation being replayed here.
     */
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_POLICY_AUD?: string;
    /** Address the merchant's bank sends credit alerts to. */
    BANK_ALERT_ADDRESS: string;
    /** Where the Email Worker forwards a copy, so the account holder keeps sight of their own mail. */
    BANK_ALERT_FORWARD_TO?: string;

    // Secrets — never in wrangler.jsonc, never in the repo.
    ADMIN_SETUP_TOKEN?: string;
    SESSION_SECRET?: string;
    DELHIVERY_TOKEN?: string;
    DELHIVERY_BASE?: string;
    RESEND_API_KEY?: string;
    ORDER_FROM_EMAIL?: string;
    ORDER_REPLY_TO?: string;
    OPS_ALERT_EMAIL?: string;
  }
}

type Env = Cloudflare.Env;

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {
    /** Loaded once per request by `src/middleware.ts`. Never read the table again. */
    settings: import('./lib/settings').Settings;
    /** Resolved for /admin routes only. Null means signed out. */
    admin: import('./lib/admin/auth').Admin | null;
  }
}
