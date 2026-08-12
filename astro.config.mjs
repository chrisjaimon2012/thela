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
          // Pre-declare the passthrough image service.
          //
          // `imageService: 'passthrough'` above makes Astro pull in
          // astro/assets/services/noop, but it is DISCOVERED after the dev
          // server is already serving. Vite then re-optimises, the content hash
          // in node_modules/.vite/deps_ssr changes, and the workerd runner is
          // left holding the previous URL — every request afterwards dies with
          // "The file does not exist at .../deps_ssr/<name>.js?v=<old hash>",
          // which reads like a code error and is not one. Naming it here means
          // it is bundled before the first request instead of during it.
          include: ['astro/assets/services/noop'],
          // And stop discovery re-running afterwards. Pre-declaring the image
          // service fixes the FIRST start; any later change to the dependency
          // graph — installing a package, adding an import — re-runs discovery,
          // re-hashes the bundle, and strands the workerd runner on the old URL
          // all over again. With discovery off, the include list above is the
          // whole of it, and nothing re-hashes mid-session.
          noDiscovery: true,
        },
      },
    },
  },
});
