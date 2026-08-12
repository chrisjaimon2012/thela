// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  // Server-rendered, because the catalogue lives in D1 and is edited by the
  // shopkeeper at runtime. Prerendering would mean a rebuild per price change.
  //
  // The cost is negligible here: rendering a product page is one indexed D1
  // query and some string building, which is a fraction of the free plan's
  // 10 ms CPU budget (CPU time excludes waiting on D1). Edge cache rules do
  // the heavy lifting, and static assets are served free and unlimited from
  // outside the Worker bundle.
  output: 'server',

  adapter: cloudflare({
    // Local dev gets real bindings automatically: the Cloudflare vite plugin
    // reads wrangler.jsonc, so `astro dev` talks to a local D1 rather than a
    // mock. (The old `platformProxy` option was removed in adapter v14.)

    // Cloudflare Images is a paid product and we do not need it: product
    // photography is uploaded already-sized and served straight from an R2
    // custom domain. Passthrough keeps the adapter from demanding an IMAGES
    // binding that would not exist on a free-tier deployment.
    imageService: 'passthrough',

    // The ops Worker: `email` and `scheduled`, which the generated storefront
    // entry has nowhere to put. The adapter builds its entry as
    // `{ fetch: handle }` from a virtual module we do not own, so an auxiliary
    // Worker is the sanctioned place for any other handler — and separating
    // them means a storefront deploy cannot break payment ingest.
    //
    // See workers/ops/index.ts for the full reasoning.
    auxiliaryWorkers: [{ configPath: './workers/ops/wrangler.jsonc' }],
  }),

  // Astro's session store would want a KV namespace binding. The cart is a
  // signed cookie and the admin uses Cloudflare Access, so nothing here needs
  // server-side sessions — and an unused binding is one more thing a
  // shopkeeper has to provision before their shop will boot.
  session: false,

  // No client-side framework. Every page here is HTML and a few dozen lines of
  // vanilla JS; a hydration runtime would be pure weight on a 2G connection in
  // Nashik, which is the actual target.
  integrations: [],

  vite: {
    build: {
      // Keeps the Worker bundle honest. The free plan's ceiling is 3 MiB
      // gzipped and we should notice long before we approach it.
      chunkSizeWarningLimit: 512,
    },

    // `environments.ssr`, not the older top-level `ssr.optimizeDeps` — under
    // Vite's environment API the Cloudflare plugin runs the server in its own
    // environment, and the legacy key is silently ignored there.
    environments: {
      ssr: {
        optimizeDeps: {
          // Do not pre-bundle Astro or the adapter for the server environment.
          //
          // Vite pre-bundles SSR dependencies into node_modules/.vite/deps_ssr
          // under a content-hashed URL. Astro discovers several of its own
          // modules late — the passthrough image service, the middleware
          // virtual module, the adapter entrypoint — so the hash moves while
          // the workerd runner is already holding the previous one, and every
          // request afterwards dies with "The file does not exist at
          // .../deps_ssr/<name>.js?v=<old hash>". It reads exactly like a code
          // error and is not one; it cost an hour twice.
          //
          // Excluding beats pre-declaring, which only fixes the first start,
          // and beats noDiscovery, which then starves genuinely new virtual
          // modules. Pre-bundling exists to collapse many small CommonJS files
          // into fewer requests; both of these are already ESM, so there is
          // nothing to collapse and nothing lost.
          exclude: ['astro', '@astrojs/cloudflare'],
        },
      },
    },
  },
});
