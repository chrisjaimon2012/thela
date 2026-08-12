/**
 * The payment model.
 *
 * The platform NEVER touches funds. Money moves customer -> merchant's own
 * bank. Everything here records EVIDENCE that it moved, which is what keeps us
 * outside RBI (Regulation of Payment Aggregators) Directions 2025 para 4(i) —
 * an aggregator both collects funds and settles them onward. We do neither.
 *
 * The one idea worth internalising: an email alert, a statement row, a typed
 * UTR and a volunteer taking cash are not four features. They are four SOURCES
 * of one `Evidence` record, resolved by one matcher. Adding a source must never
 * mean adding a matching path.
 */

export type Minor = number;

/**
 * How much a piece of evidence is worth. This is the whole trust model.
 *
 * `ledger` outranks `alert` deliberately. A bank statement is the account's
 * actual ledger; an alert is a notification about an attempt. RBL was
 * documented firing DKIM-valid "Account Credited" emails for declined
 * transactions and internal reversals (47 of 54 in one case). So a daily
 * statement upload is slower than email but STRONGER, not a degraded fallback.
 */
export type Confidence =
  /** A row in the merchant's own bank statement. Authoritative. */
  | 'ledger'
  /** A bank credit-alert email. Fast, and can be wrong — see RBL. */
  | 'alert'
  /** A human with account access asserted it (checked the app, or took cash). */
  | 'asserted'
  /** The customer says they paid. Never sufficient on its own. */
  | 'claimed';

export interface Evidence {
  /** Source id, recorded on the payment_event for audit: 'email' | 'statement' | 'manual' | 'claim'. */
  source: string;
  confidence: Confidence;
  /**
   * The UTR / RRN — a 12-digit reference minted by NPCI. The one identifier
   * neither party controls and both can see. Doubles as the idempotency key.
   * Absent only for cash, where the actor is the reference.
   */
  reference: string;
  amountMinor: Minor;
  /**
   * ISO 4217. Required, not optional.
   *
   * The open-amount slot is unique per (currency, amount), so matching on
   * amount alone would let a €1,399.37 credit settle an order for ₹1,399.37 in
   * a shop trading in both. The index would not stop it — the two orders are
   * legitimately distinct rows.
   */
  currency: string;
  /** ISO 8601. When the money moved, not when we heard about it. */
  at: string;
  /** VPA, IBAN, card last four — whatever the rail identifies a payer by. */
  payerRef?: string;
  narration?: string;
  /** Admin identity, for `asserted` evidence. */
  actor?: string;
  /** Bank profile id, so policy can consider bank trust. */
  bankId?: string;
}

export type Resolution =
  | { outcome: 'settled'; orderId: string }
  /** Matched an order, but policy says a human must approve. */
  | { outcome: 'review'; orderId: string; why: ReviewReason }
  /** No open order wants this money. Recorded, not lost. */
  | { outcome: 'unmatched'; why: UnmatchedReason }
  /** We have already acted on this reference. A no-op, not an error. */
  | { outcome: 'duplicate'; orderId?: string };

export type ReviewReason =
  | 'bank_unverified'
  | 'bank_unreliable'
  | 'above_auto_ceiling'
  | 'customer_claim';

export type UnmatchedReason =
  | 'no_open_order_for_amount'
  | 'outside_time_window';

/** Fulfilment is a checkout-time choice, not a shipping-adapter concern. */
export type Fulfilment =
  /** Collected in person. No carrier, no address, no shipping charge. */
  | 'pickup'
  /** Handed to a carrier. Requires a serviceable address. */
  | 'carrier';
