/**
 * Choosing how a shop sends email, and recording what it could not send.
 */

import type { EmailProvider, Message, SendOutcome } from './types';

export type { EmailProvider, Message, SendOutcome } from './types';

export interface MailEnv {
  DB: D1Database;
  /** Cloudflare Email Routing's send binding, when the shop has one. */
  SEND_EMAIL?: { send(message: unknown): Promise<void> };
  RESEND_API_KEY?: string;
}

export interface MailSettings {
  /** Who the mail is from. Must be on a domain the provider is allowed to use. */
  fromAddress: string;
  fromName: string;
  replyTo?: string;
}

/**
 * Pick a provider.
 *
 * Order matters: an explicit API key beats the built-in binding, because a shop
 * that has gone to the trouble of configuring Resend wants its customer mail to
 * go out, and the Cloudflare binding cannot carry that.
 */
export function emailProvider(env: MailEnv, settings: MailSettings): EmailProvider {
  if (env.RESEND_API_KEY) return resend(env.RESEND_API_KEY, settings);
  if (env.SEND_EMAIL) return cloudflare(env.SEND_EMAIL, settings);
  return none();
}

/**
 * Resend. An ordinary HTTP API, so a Worker needs no SDK — the whole
 * integration is one `fetch`, which is also why swapping it for another vendor
 * is an afternoon rather than a project.
 */
function resend(apiKey: string, settings: MailSettings): EmailProvider {
  return {
    id: 'resend',
    configured: true,
    ownAddressesOnly: false,
    async send(message: Message): Promise<SendOutcome> {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            from: `${settings.fromName} <${settings.fromAddress}>`,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
            reply_to: message.replyTo ?? settings.replyTo,
          }),
        });

        if (!res.ok) {
          // The body carries the actual reason — a domain not verified, a key
          // revoked — and a shopkeeper needs that, not "500".
          return { sent: false, via: 'resend', why: (await res.text()).slice(0, 300) };
        }
        return { sent: true, via: 'resend' };
      } catch (err) {
        return { sent: false, via: 'resend', why: String(err).slice(0, 300) };
      }
    },
  };
}

/**
 * Cloudflare Email Routing's send binding.
 *
 * Free and already present, and it can only reach addresses verified as
 * destinations in this zone. That is not a bug to work around — it is what
 * makes it safe to leave enabled on a shop that has configured nothing else.
 */
function cloudflare(binding: NonNullable<MailEnv['SEND_EMAIL']>, settings: MailSettings): EmailProvider {
  return {
    id: 'cloudflare',
    configured: true,
    ownAddressesOnly: true,
    async send(message: Message): Promise<SendOutcome> {
      try {
        // MIME, assembled by hand. The alternative is mimetext or similar, and
        // a header-and-a-body is not worth a dependency in a 3 MiB budget.
        const raw = [
          `From: ${settings.fromName} <${settings.fromAddress}>`,
          `To: ${message.to}`,
          `Subject: ${headerSafe(message.subject)}`,
          message.replyTo ? `Reply-To: ${message.replyTo}` : '',
          'MIME-Version: 1.0',
          'Content-Type: text/plain; charset=utf-8',
          '',
          message.text,
        ]
          .filter(Boolean)
          .join('\r\n');

        await binding.send({ from: settings.fromAddress, to: message.to, raw });
        return { sent: true, via: 'cloudflare' };
      } catch (err) {
        return { sent: false, via: 'cloudflare', why: String(err).slice(0, 300) };
      }
    },
  };
}

/** No provider configured. Says so, rather than pretending. */
function none(): EmailProvider {
  return {
    id: 'none',
    configured: false,
    ownAddressesOnly: false,
    async send(): Promise<SendOutcome> {
      return {
        sent: false,
        via: 'none',
        why: 'This shop has not set up email yet, so nothing was sent.',
      };
    },
  };
}

/**
 * Strip anything that could inject a header.
 *
 * A subject is built from shop data — an order id, a shop name — and a newline
 * inside one turns into a `Bcc:` a shopkeeper never wrote.
 */
const headerSafe = (s: string): string => s.replace(/[\r\n]+/g, ' ').slice(0, 200);
