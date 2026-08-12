/**
 * The payment port.
 *
 * The platform NEVER touches funds. Every adapter here observes that money
 * moved between the customer and the merchant's own bank account; none of them
 * receives or settles it. That is what keeps this outside the RBI (Regulation
 * of Payment Aggregators) Directions, 2025 — para 4(i) defines an aggregator
 * conjunctively, as one that collects funds AND settles them onward. We do
 * neither, so we sit in para 4(j) (technology infrastructure, no operative
 * obligations).
 *
 * Adapters must therefore never introduce a platform-controlled VPA, an escrow
 * account, or any settlement step. If an adapter would hold money, it does not
 * belong in this repo.
 */

export type Paise = number;

/** What the shopper is shown in order to pay. */
export type PaymentInstruction =
  | {
      kind: 'upi';
      /** Merchant's own VPA. Funds land here directly. */
      vpa: string;
      payeeName: string;
      amountPaise: Paise;
      /** upi://pay?... — opens a UPI app on mobile. */
      intentUri: string;
      /** Same payload rendered as a QR, for desktop. */
      qrPayload: string;
      /** Optional reference we ask the payer's app to carry. */
      note?: string;
    }
  | {
      kind: 'hosted';
      /** For gateway adapters: redirect or open a hosted checkout. */
      url: string;
      amountPaise: Paise;
    };

/** Normalised evidence that a payment happened. */
export interface PaymentEvidence {
  /** Adapter id, e.g. 'upi-email'. */
  provider: string;
  /**
   * Provider-unique reference. For UPI this is the UTR/RRN. Used as the
   * idempotency key — replaying the same evidence must never double-credit.
   */
  reference: string;
  amountPaise: Paise;
  at: string;
  payerVpa?: string;
  narration?: string;
  /** Set when a human confirmed rather than an automated match. */
  actor?: string;
}

export interface MatchResult {
  matched: boolean;
  orderId?: string;
  /** Why a match failed, for the admin review queue. */
  reason?:
    | 'no_open_order_for_amount'
    | 'amount_mismatch'
    | 'outside_time_window'
    | 'reference_already_used'
    | 'ambiguous';
}

export interface PaymentAdapter {
  readonly id: string;

  /**
   * Whether this adapter confirms payments on its own. `false` means the shop
   * relies on a human pressing Confirm, and the admin UI must say so plainly.
   */
  readonly automatic: boolean;

  /** Render the instruction for an order that is awaiting payment. */
  instruct(input: {
    orderId: string;
    amountPaise: Paise;
    settings: Record<string, string>;
  }): Promise<PaymentInstruction>;

  /**
   * Bind a piece of evidence to an order.
   *
   * Implementations MUST re-derive the expected amount server-side from the
   * catalogue. A client-supplied amount is never authoritative.
   */
  match(
    evidence: PaymentEvidence,
    db: D1Database,
  ): Promise<MatchResult>;
}

/**
 * Verify and record, atomically.
 *
 * Everything that could fail is expressed as a constraint so that D1's
 * batch() — which rolls back only on statement ERROR, not on zero rows
 * affected — actually rolls back.
 */
export async function settle(
  db: D1Database,
  orderId: string,
  evidence: PaymentEvidence,
  lines: Array<{ sku: string; qty: number }>,
): Promise<void> {
  await db.batch([
    // 1. Idempotency first. A replayed webhook or a re-parsed email violates
    //    UNIQUE(provider, reference) and aborts everything below it.
    db
      .prepare(
        `INSERT INTO payment_event (order_id, provider, kind, reference, amount_paise, actor)
         VALUES (?1, ?2, 'verified', ?3, ?4, ?5)`,
      )
      .bind(
        orderId,
        evidence.provider,
        evidence.reference,
        evidence.amountPaise,
        evidence.actor ?? null,
      ),

    // 2. Convert the reservation into a real decrement. Both columns fall
    //    together, so CHECK (reserved <= on_hand) still holds; CHECK
    //    (on_hand >= 0) catches anything that would oversell.
    ...lines.map((l) =>
      db
        .prepare(
          `UPDATE stock
              SET on_hand    = CASE WHEN tracked = 1 THEN on_hand  - ?2 ELSE on_hand  END,
                  reserved   = CASE WHEN tracked = 1 THEN reserved - ?2 ELSE reserved END,
                  updated_at = datetime('now')
            WHERE sku = ?1`,
        )
        .bind(l.sku, l.qty),
    ),

    // 3. Only an order still awaiting payment can transition. Zero rows here
    //    is harmless because step 1 already guaranteed we arrive once.
    db
      .prepare(
        `UPDATE orders
            SET status = 'paid', paid_at = datetime('now')
          WHERE id = ?1 AND status = 'awaiting_payment'`,
      )
      .bind(orderId),
  ]);
}
