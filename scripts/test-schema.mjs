#!/usr/bin/env node
/**
 * Runs the executable schema proofs and turns them into a real exit code.
 *
 * Two things make this a script rather than a one-liner in package.json.
 *
 * `sqlite3` exits non-zero because the proofs deliberately provoke constraint
 * violations — an aborted oversell is the assertion, not an accident. Trusting
 * its exit status would mean a permanently red gate that everyone learns to
 * ignore.
 *
 * And a proof that silently stops running is worse than one that fails: if a
 * schema change breaks an INSERT the later assertions depend on, sqlite3 keeps
 * going and simply prints fewer lines. So we assert on the COUNT too, and the
 * expected total lives here where a reviewer diffing the number has to think
 * about whether they meant to change it.
 */

import { execFileSync } from 'node:child_process';

const EXPECTED_ASSERTIONS = 13;

let output;
try {
  output = execFileSync(
    'sqlite3',
    [':memory:', '.read migrations/0001_init.sql', '.read tests/invariants.test.sql'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
} catch (err) {
  // Expected: the proofs provoke constraint violations, which sqlite3 reports
  // on stderr and exits 1 for. The assertions are still on stdout.
  output = err.stdout ?? '';
  if (!output) {
    console.error(err.stderr || err.message);
    console.error('\nsqlite3 produced no output at all — the schema itself is broken.');
    process.exit(1);
  }
}

console.log(output.trimEnd());

const failures = output.split('\n').filter((l) => l.startsWith('FAIL'));
const passes = output.split('\n').filter((l) => l.startsWith('PASS'));

if (failures.length) {
  console.error(`\n${failures.length} invariant(s) FAILED.`);
  process.exit(1);
}

if (passes.length !== EXPECTED_ASSERTIONS) {
  console.error(
    `\n${passes.length} assertions ran, expected ${EXPECTED_ASSERTIONS}. ` +
      `Proofs stopped early, or one was added without updating EXPECTED_ASSERTIONS ` +
      `in scripts/test-schema.mjs.`,
  );
  process.exit(1);
}

console.log(`\n${passes.length} invariants hold.`);
