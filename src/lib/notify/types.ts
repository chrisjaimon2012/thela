/**
 * Sending email, behind one interface.
 *
 * A shop needs to send very little: an order confirmation, a dispatch notice, a
 * recovery code, and the watchdog's alarm. What it must never do is depend on
 * one vendor to do it — a shop in Lyon and a church in Maharashtra will not
 * make the same choice, and a project that hardcodes Resend has quietly
 * decided for both of them.
 *
 * THREE IMPLEMENTATIONS, AND WHY THE FIRST ONE EXISTS
 *
 *   * `cloudflare` — Cloudflare Email Routing's `send_email` binding. Free, no
 *     account anywhere else, no API key, already in the single pane of glass.
 *     Its limitation is severe and worth stating plainly: it can only send to
 *     addresses VERIFIED as destinations in that zone's Email Routing. That
 *     rules it out for customer mail, and makes it exactly right for the
 *     shopkeeper's own recovery code and the watchdog's alarm — one known
 *     address, which they control, and which they have already proved they own.
 *   * `resend` — an ordinary HTTP API for mail to customers. A free tier, and
 *     one API key.
 *   * `none` — the honest default. A fresh install has no mail configured, and
 *     the alternative to saying so is pretending to send things.
 *
 * `none` is not a stub that throws. It records what it would have sent, so a
 * shopkeeper who has not set up email yet can still see that an order
 * confirmation was owed and to whom. Silence about unsent mail is how a shop
 * discovers three weeks later that no customer ever heard from it.
 */

export interface Message {
  to: string;
  subject: string;
  /** Plain text. Always present — some recipients only ever see this. */
  text: string;
  /** Optional. Kept simple: no external images, no tracking, no framework. */
  html?: string;
  replyTo?: string;
}

export type SendOutcome =
  | { sent: true; via: string }
  /**
   * Not an exception. Mail failing must never take down the request that
   * triggered it — an order that is paid for is paid for whether or not its
   * confirmation went out, and throwing here would roll back the settlement.
   */
  | { sent: false; via: string; why: string };

export interface EmailProvider {
  readonly id: string;
  /** False for `none`, so callers can say "email is not set up" rather than lie. */
  readonly configured: boolean;
  /**
   * True when this provider can only reach addresses the shopkeeper has already
   * verified — which is what makes it usable for their own mail and not for a
   * customer's.
   */
  readonly ownAddressesOnly: boolean;
  send(message: Message): Promise<SendOutcome>;
}
