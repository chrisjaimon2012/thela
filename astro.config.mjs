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
    // Gives `astro dev` real bindings from wrangler.jsonc, so local dev talks
    // to a local D1 rather than a mock.
    platformProxy: { enabled: true },

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
  },
});
