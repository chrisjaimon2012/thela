/**
 * Evidence source: bank credit-alert email.
 *
 * Cloudflare Email Routing delivers the merchant's own bank alerts straight to
 * a Worker — no mailbox, no IMAP, no polling, no third party. This is the
 * fastest source, and the least trustworthy: see `Confidence` in ../types.
 */

import PostalMime from 'postal-mime';
import {
  bankByDkim,
  extract,
  looksLikeCredit,
  forwardCopyEnabled,
  requireDkimPass,
} from '../../banks/registry';
import { resolve } from '../resolve';
import type { Resolution } from '../types';

/**
 * Cloudflare exposes authentication results as headers it has already
 * verified. We read the DKIM `d=` domain rather than the From header, because
 * From is trivially spoofable and an accepted forgery here ships free goods.
 */
function dkimDomain(headers: Headers): string | null {
  const auth = headers.get('authentication-results') ?? '';
  if (requireDkimPass && !/dkim=pass/i.test(auth)) return null;
  return auth.match(/dkim=pass[^;]*header\.d=([^\s;]+)/i)?.[1]?.toLowerCase() ?? null;
}

export async function handleBankEmail(
  message: ForwardableEmailMessage,
  env: { DB: D1Database; BANK_ALERT_FORWARD_TO?: string },
): Promise<Resolution | null> {
  const domain = dkimDomain(message.headers);
  const bank = domain ? bankByDkim(domain) : undefined;

  // Always give the account holder their copy back. Several banks — HDFC
  // confirmed — have no alerts-only address, so pointing alerts at the shop
  // domain would otherwise swallow statements and service notices too.
  const forward = async () => {
    if (forwardCopyEnabled && env.BANK_ALERT_FORWARD_TO) {
      await message.forward(env.BANK_ALERT_FORWARD_TO);
    }
  };

  if (!bank) {
    await quarantine(env.DB, message, domain ? 'unknown_bank' : 'dkim_failed');
    await forward();
    return null;
  }

  const email = await new PostalMime().parse(message.raw);
  const body = email.text || stripTags(email.html ?? '');

  if (!looksLikeCredit(body, bank)) {
    await forward(); // a debit or a notice; not our business
    return null;
  }

  const { amountMinor, utr, payerVpa } = extract(body, bank);
  if (!amountMinor || !utr) {
    // Parsed as a credit but the fields did not come out — this is what
    // template drift looks like, and the cron watches this table for it.
    await quarantine(env.DB, message, 'fields_missing', body);
    await forward();
    return null;
  }

  const result = await resolve(env.DB, {
    source: 'email',
    confidence: 'alert',
    reference: utr,
    amountMinor,
    at: new Date(email.date ?? Date.now()).toISOString(),
    payerVpa,
    narration: email.subject,
    bankId: bank.id,
  });

  await forward();
  return result;
}

function quarantine(
  db: D1Database,
  message: ForwardableEmailMessage,
  reason: string,
  body?: string,
) {
  return db
    .prepare(
      `INSERT INTO unparsed_alert (from_addr, subject, body_text, reason)
       VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(message.from, message.headers.get('subject'), body ?? null, reason)
    .run();
}

const stripTags = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
