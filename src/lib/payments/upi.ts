/**
 * UPI payment presentation.
 *
 * One function, because a UPI QR and a UPI intent link are the SAME string:
 * the QR simply encodes the URI. Generating them separately is the classic
 * way these two drift apart and start disagreeing about the amount.
 *
 * What we can and cannot do:
 *  - `am` pre-fills the amount in every major UPI app. Good.
 *  - It is NOT locked. Whether the payer may edit it is decided by their app,
 *    not by us; locking requires a signed intent with an NPCI-issued org id,
 *    unavailable to an individual merchant. An edited amount simply fails to
 *    match an open order and falls through to review — which is why the paise
 *    slot is a matching key and never a security control.
 *  - There is no collect/pull option. NPCI abolished P2P collect from
 *    1 Oct 2025, and merchant collect can only be initiated by a PSP.
 */

import type { Paise } from './types';

export interface UpiTarget {
  /** The merchant's own VPA. Funds land here directly. */
  vpa: string;
  payeeName: string;
}

export interface UpiRequest extends UpiTarget {
  amountPaise: Paise;
  /**
   * Order reference. Some banks surface the payer's note in the credit
   * narration, which would give us a true order reference instead of relying
   * on the paise slot — unconfirmed, so it is a bonus signal, never the plan.
   */
  note?: string;
}

/**
 * Build the `upi://pay` URI, per the NPCI Linking Specification.
 *
 * Render it as a link on mobile (opens the UPI app) and as a QR on desktop.
 */
export function upiUri({ vpa, payeeName, amountPaise, note }: UpiRequest): string {
  const params = new URLSearchParams({
    pa: vpa,
    pn: payeeName,
    am: (amountPaise / 100).toFixed(2),
    cu: 'INR',
  });
  if (note) params.set('tn', note);
  // URLSearchParams encodes spaces as '+', which some UPI apps render
  // literally in the payee name. %20 is universally understood.
  return `upi://pay?${params.toString().replace(/\+/g, '%20')}`;
}

/** True when the target is configured enough to accept money. */
export function isPayable(t: Partial<UpiTarget>): t is UpiTarget {
  return Boolean(t.vpa?.includes('@') && t.payeeName);
}
