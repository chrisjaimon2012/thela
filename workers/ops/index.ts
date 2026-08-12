/**
 * The ops Worker: everything that is not a page request.
 *
 * WHY THIS IS A SECOND WORKER
 *
 * The Astro Cloudflare adapter generates its Worker entry as `{ fetch: handle }`
 * and nothing else. It is a virtual module we do not own, so there is no place
 * to attach an `email` or a `scheduled` handler — and thela's payment
 * confirmation depends on the first and its stock hygiene on the second.
 *
 * `auxiliaryWorkers` is the adapter's own sanctioned answer, and the separation
 * turns out to be worth having on its own merits:
 *
 *   * A storefront deploy cannot break payment ingest. These are the two things
 *     in the system with the most different change rates — templates move
 *     weekly, bank parsing moves when a bank rewrites an email — and they now
 *     fail independently.
 *   * This Worker carries none of Astro's bundle, so it starts cold in
 *     microseconds. That matters for `email`, which has no user waiting but
 *     does have a bank's SMTP timeout.
 *   * Its bindings are the smallest set that does the job: the database, and
 *     the address to forward a copy of each alert to. It cannot serve a page,
 *     read a session, or reach R2.
 *
 * Both Workers bind the SAME D1. There is one database and one truth.
 */

import { handleBankEmail } from '../../src/lib/payments/sources/email';
import { expireUnpaid } from '../../src/lib/ops/expire';
import { alarms, health } from '../../src/lib/ops/watchdog';
import { loadSettings } from '../../src/lib/settings';

interface OpsEnv {
  DB: D1Database;
  BANK_ALERT_FORWARD_TO?: string;
  OPS_ALERT_EMAIL?: string;
}

/** Cron expressions, matched against `wrangler.jsonc`. Keep the two in step. */
const SWEEP = '*/5 * * * *';
const WATCHDOG = '0 */6 * * *';

export default {
  /**
   * A bank credit alert, delivered by Cloudflare Email Routing.
   *
   * Never throws. A thrown handler makes Email Routing retry and eventually
   * bounce, and a bounced bank alert is gone — there is no second copy and no
   * way to ask the bank to resend. Anything unparseable is quarantined in the
   * database instead, where the watchdog counts it and a human can read it.
   */
  async email(message: ForwardableEmailMessage, env: OpsEnv): Promise<void> {
    try {
      const settings = await loadSettings(env.DB);
      await handleBankEmail(message, env, settings.currency);
    } catch (err) {
      console.error('ops: bank email failed', err);
      // Deliberately swallowed. The alert is already quarantined or forwarded
      // by handleBankEmail's own error paths; re-throwing only loses it.
    }
  },

  async scheduled(event: ScheduledController, env: OpsEnv, ctx: ExecutionContext): Promise<void> {
    // waitUntil, so a slow sweep does not hold the scheduled invocation open
    // past its own budget while still being allowed to finish.
    ctx.waitUntil(run(event.cron, env));
  },
} satisfies ExportedHandler<OpsEnv>;

async function run(cron: string, env: OpsEnv): Promise<void> {
  if (cron === SWEEP) {
    const { scanned, cancelled } = await expireUnpaid(env.DB);
    if (cancelled.length > 0) {
      console.log(`ops: released ${cancelled.length} of ${scanned} expired orders`);
    }
    return;
  }

  if (cron === WATCHDOG) {
    const h = await health(env.DB);
    // A shop that sells four things a month must not be alarmed at nightly.
    // Two days of quiet is the floor; a busier shop can lower it later from a
    // setting, once there is enough history to know its own rhythm.
    const raised = alarms(h, 48);

    for (const a of raised) {
      console.log(`ops: ${a.severity} ${a.key} — ${a.message}`);
    }

    // Email delivery lands with the notification seam. Until then the alarms
    // are in the Workers log, which is honest: the watchdog counts correctly
    // and cannot yet reach anyone. Better a visible gap than a silent one.
    return;
  }

  console.warn(`ops: no handler for cron "${cron}"`);
}
