/**
 * Bank profiles: field extraction and trust policy.
 *
 * Deliberately shared by every evidence source. An email body and a statement
 * cell are both just text with an amount, a reference and maybe a VPA in them,
 * so they get one extractor. Two extractors would drift.
 */

import doc from './parsers.json';
import { parseMoney } from '../money';
import type { Confidence, Minor } from '../payments/types';

export type Trust = 'verified' | 'unverified' | 'unsuitable' | 'unreliable';

export interface BankProfile {
  id: string;
  name: string;
  trust: Trust;
  from: string[];
  dkimDomains: string[];
  patterns: Record<string, string>;
  notes?: string[];
}

export interface Extracted {
  amountMinor?: Minor;
  utr?: string;
  payerVpa?: string;
}

const BANKS = doc.banks as unknown as BankProfile[];
const DEFAULTS = doc.defaults;

const GENERIC = BANKS.find((b) => b.id === 'generic')!;

/** Compiled once per isolate. Patterns are static; recompiling per email is waste. */
const rxCache = new Map<string, RegExp>();
const rx = (source: string): RegExp => {
  let r = rxCache.get(source);
  if (!r) rxCache.set(source, (r = new RegExp(source, 'i')));
  return r;
};

export const bankById = (id: string): BankProfile | undefined =>
  BANKS.find((b) => b.id === id);

/**
 * Resolve a bank from the DKIM `d=` value.
 *
 * Keyed on DKIM rather than the From header because From is trivially
 * spoofable, and because Indian banks now run legacy and RBI-designated
 * `bank.in` domains side by side (HDFC signs as both hdfcbank.net and
 * hdfcbank.bank.in). Suffix match so `mail.hdfcbank.net` still resolves.
 */
export function bankByDkim(dkimDomain: string): BankProfile | undefined {
  const d = dkimDomain.toLowerCase();
  return BANKS.find((b) =>
    b.dkimDomains.some((x) => d === x || d.endsWith(`.${x}`)),
  );
}

/** Pull whatever fields the profile knows how to find. Missing is not an error. */
export function extract(text: string, bank: BankProfile): Extracted {
  const p = { ...GENERIC.patterns, ...bank.patterns };
  const one = (key: string): string | undefined => {
    const pattern = p[key];
    return pattern ? (text.match(rx(pattern))?.[1] ?? undefined) : undefined;
  };

  const amountRaw = one('amount');
  return {
    amountMinor: amountRaw ? (parseMoney(amountRaw) ?? undefined) : undefined,
    utr: one('utr') ?? one('utrFallback'),
    payerVpa: one('payerVpa'),
  };
}

/** Does this text look like money arriving, rather than leaving? */
export function looksLikeCredit(text: string, bank: BankProfile): boolean {
  const pattern = bank.patterns.credit ?? GENERIC.patterns.credit;
  return pattern ? rx(pattern).test(text) : false;
}

export interface AutoSettleDecision {
  auto: boolean;
  why?: 'bank_unverified' | 'bank_unreliable' | 'above_auto_ceiling' | 'customer_claim';
}

/**
 * May this evidence dispatch goods without a human?
 *
 * This function is where the research lives, so read it before loosening it:
 *
 *  - `ledger` (a statement row) is the account's own record. Always settles.
 *  - `asserted` means a human with account access already looked. Settles.
 *  - `alert` (email) is a notification about an attempt, not proof of one.
 *    RBL was documented sending DKIM-valid "Account Credited" mails where 47
 *    of 54 had no matching credit — fired on declines and reversals. So alerts
 *    settle only from a `verified` bank, and only below a ceiling, so that a
 *    false positive costs one item rather than a bulk order.
 *  - `claimed` is the customer's word. Never settles alone.
 */
export function mayAutoSettle(input: {
  confidence: Confidence;
  bankId?: string;
  amountMinor: Minor;
}): AutoSettleDecision {
  const { confidence, bankId, amountMinor } = input;

  if (confidence === 'ledger' || confidence === 'asserted') return { auto: true };
  if (confidence === 'claimed') return { auto: false, why: 'customer_claim' };

  const bank = bankId ? bankById(bankId) : undefined;
  if (bank?.trust === 'unreliable') return { auto: false, why: 'bank_unreliable' };
  if (!bank || !DEFAULTS.autoConfirm.onlyTrust.includes(bank.trust))
    return { auto: false, why: 'bank_unverified' };
  if (amountMinor > DEFAULTS.autoConfirm.maxAmountMinor)
    return { auto: false, why: 'above_auto_ceiling' };

  return { auto: true };
}

export const timeWindowMinutes = DEFAULTS.timeWindowMinutes;
export const forwardCopyEnabled = DEFAULTS.forwardCopyTo.enabled;
export const requireDkimPass = DEFAULTS.requireDkimPass;
