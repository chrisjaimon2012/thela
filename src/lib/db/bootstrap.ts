/**
 * The shop builds its own database if nobody built it first.
 *
 * WHY THIS EXISTS
 *
 * The Deploy to Cloudflare button clones this repository into a stranger's
 * account, provisions a D1 database, and deploys. It does **not** run
 * migrations — Cloudflare's own changelog does not mention them at all — and the
 * deploy command it uses is whatever sits in that field on the setup page. A
 * shop installed by somebody who left the default alone comes up against an
 * empty database, where every page 500s and nothing in the dashboard explains
 * why.
 *
 * Asking a shopkeeper to notice and edit a "Deploy command" field is not an
 * install path. So the schema applies itself, and the button works whatever is
 * in that field.
 *
 * `npm run deploy` still applies migrations first, which is better when it
 * works: schema changes land before the code that needs them, rather than on
 * whichever request happens to arrive first. This is the safety net, not the
 * plan.
 *
 * WHAT MAKES IT SAFE TO RUN FROM A REQUEST
 *
 *   * It costs nothing after the first request an isolate serves. A module-level
 *     flag short-circuits it; only a cold isolate pays one indexed query.
 *   * Each migration file is applied as ONE `batch()`, which D1 runs
 *     atomically. A migration cannot land half-applied.
 *   * Two isolates racing is expected and handled: the loser's batch fails
 *     because the tables already exist, and it re-reads the ledger rather than
 *     assuming anything.
 *   * A migration already recorded is never re-run, so this is not "CREATE TABLE
 *     IF NOT EXISTS everywhere" — it is a real ledger, the same idea wrangler
 *     uses, kept in the same database it describes.
 */

/**
 * Every migration, in filename order.
 *
 * Globbed rather than listed, so adding one to `migrations/` is the whole job.
 * `eager` because a Worker cannot dynamically import at runtime — these are
 * inlined into the bundle at build time, which is also why they are counted
 * against the bundle budget and kept terse.
 */
const MIGRATIONS: [string, string][] = Object.entries(
  import.meta.glob('../../../migrations/*.sql', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>,
)
  .map(([path, sql]): [string, string] => [path.split('/').pop() ?? path, sql])
  .sort(([a], [b]) => a.localeCompare(b));

const LEDGER = `CREATE TABLE IF NOT EXISTS _thela_migration (
  name       TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

/**
 * Cleared only by a new isolate. There is no invalidation because there is
 * nothing to invalidate: once the schema exists it does not stop existing, and
 * a deploy that adds a migration also replaces every isolate.
 */
let ready = false;

export interface BootstrapResult {
  applied: string[];
  alreadyReady: boolean;
}

export async function ensureSchema(db: D1Database): Promise<BootstrapResult> {
  if (ready) return { applied: [], alreadyReady: true };

  const applied: string[] = [];

  try {
    await db.prepare(LEDGER).run();

    const done = await db
      .prepare(`SELECT name FROM _thela_migration`)
      .all<{ name: string }>();
    const seen = new Set(done.results.map((r) => r.name));

    for (const [name, sql] of MIGRATIONS) {
      if (seen.has(name)) continue;

      // One file, one batch. D1 runs a batch atomically, so the migration and
      // the record that it happened either both land or neither does — which is
      // what stops a crash mid-file leaving a half-built schema that looks
      // finished.
      await db.batch([
        ...statements(sql).map((s) => db.prepare(s)),
        db.prepare(`INSERT INTO _thela_migration (name) VALUES (?1)`).bind(name),
      ]);

      applied.push(name);
    }

    ready = true;
    return { applied, alreadyReady: applied.length === 0 };
  } catch (err) {
    // Almost always the loser of a race: another isolate created the tables
    // between our ledger read and our batch. Re-read rather than assume.
    const done = await db
      .prepare(`SELECT name FROM _thela_migration`)
      .all<{ name: string }>()
      .catch(() => ({ results: [] as { name: string }[] }));

    if (done.results.length >= MIGRATIONS.length) {
      ready = true;
      return { applied: [], alreadyReady: true };
    }

    // Genuinely broken. Let the caller decide what to show; a shop with no
    // schema cannot pretend otherwise.
    throw err;
  }
}

/**
 * Split a migration into statements.
 *
 * Comments are stripped first, then split on a semicolon at end of line. Crude,
 * and sufficient because these files contain no semicolon inside a string
 * literal or a trigger body — if one ever does, this breaks loudly at deploy
 * rather than silently at midnight.
 */
function statements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Testing seam: forget that the schema was checked. */
export function resetBootstrapCache(): void {
  ready = false;
}
