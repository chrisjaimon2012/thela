import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

/**
 * Two kinds of test, and the split is deliberate.
 *
 * `tests/*.test.ts` is pure logic — contrast maths, check digits, barcode
 * symbols, label HTML. Those run in plain Node because they touch nothing.
 *
 * `tests/db/*.test.ts` runs inside **workerd against a real D1**, because the
 * bugs that matter here are not logic bugs. They are the ones where the SQL and
 * the schema disagree: a column renamed in the migration but not in the query,
 * a NOT NULL with no default, a CHECK that fires only on the third statement of
 * a batch. A mocked database accepts every one of them happily.
 *
 * It also lets us verify, rather than assume, the claim the whole stock model
 * rests on — that `batch()` rolls back on a constraint violation but NOT on a
 * statement that merely affects zero rows.
 *
 * Note the API: `cloudflareTest` as a Vite plugin. The older
 * `defineWorkersProject` from `@cloudflare/vitest-pool-workers/config` was
 * removed in 0.21; that subpath no longer exists and importing it fails at
 * config load with a "Missing ./config specifier" error.
 */
export default defineConfig({
  test: {
    projects: [
      {
        // Pure logic, no bindings, no workerd. Fast.
        test: {
          name: 'unit',
          include: ['tests/*.test.ts'],
          environment: 'node',
        },
      },
      {
        // The plugin belongs to THIS project, not the root. At the root it
        // loads but `cloudflare:test` never resolves inside the project's own
        // module graph, and the failure reads as a missing package.
        plugins: [
          cloudflareTest({
            miniflare: {
              compatibilityDate: '2026-08-01',
              compatibilityFlags: ['nodejs_compat'],
              // A fresh, isolated database. Deliberately not the local dev one:
              // a test that drops a table must not cost anyone their samples.
              d1Databases: { DB: 'test' },
            },
          }),
        ],
        test: {
          name: 'db',
          include: ['tests/db/**/*.test.ts'],
        },
      },
    ],
  },
});
