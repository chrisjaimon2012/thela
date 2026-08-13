import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { issueCode, recoveryEmail } from '../../../lib/admin/recovery';
import { emailProvider } from '../../../lib/notify';

/**
 * Ask for a code.
 *
 * Always answers the same way. Whether the address belongs to an admin, has
 * asked three times already, or has never existed, the reply is identical —
 * anything else turns this into a way to test who runs a shop.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const form = await request.formData();
  const email = String(form.get('email') ?? '').trim();

  if (!email.includes('@')) {
    return back('/admin/recover?e=' + encodeURIComponent('That does not look like an email address.'));
  }

  const settings = locals.settings;

  const mail = emailProvider(env, {
    fromAddress: settings.supportEmail || `no-reply@${new URL(request.url).hostname}`,
    fromName: settings.shopName,
  });

  // Checked BEFORE the address is looked up, and answered identically for
  // everyone. Whether this shop can send email is a fact about the shop; making
  // it conditional on the address being an admin would turn the difference
  // between the two replies into exactly the oracle the rest of this endpoint
  // is careful not to be.
  if (!mail.configured) {
    return back(
      '/admin/recover?e=' +
        encodeURIComponent(
          'This shop has no way to send email yet, so a code cannot reach anyone. ' +
            'Set up email in the admin from a device that is still signed in, or ' +
            'redeploy with RESEND_API_KEY set.',
        ),
    );
  }

  const issued = await issueCode(env.DB, email);

  if (issued) {
    const { subject, text } = recoveryEmail(issued.code, settings.shopName);
    const outcome = await mail.send({ to: email, subject, text });

    if (!outcome.sent) {
      // Logged rather than shown. The reason is usually a misconfigured sending
      // domain, which is the shopkeeper's problem to fix and an attacker's
      // signal that the address exists.
      console.error('recovery: send failed', outcome.why);
    }
  }

  // The same answer whether the address is an admin, has asked three times
  // already, or has never existed here.
  return back('/admin/recover?sent=1');
};

const back = (to: string) => new Response(null, { status: 303, headers: { Location: to } });
