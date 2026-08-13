import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { audit } from '../../../lib/admin/auth';
import { importStatement } from '../../../lib/payments/sources/statement';

/** A statement is read in memory and discarded. Nothing is stored, ever. */
const MAX_BYTES = 2_000_000;

export const POST: APIRoute = async ({ request, locals }) => {
  const admin = locals.admin;
  if (!admin) return back('/admin/login');

  const form = await request.formData();
  const file = form.get('file');

  if (!(file instanceof File) || file.size === 0) {
    return back('/admin/payments?e=' + encodeURIComponent('No file arrived. Try again.'));
  }

  // A statement is text. Two megabytes is several years of a small shop's
  // transactions, and the cap exists so a mis-picked file cannot blow the
  // Worker's memory before anyone notices what they selected.
  if (file.size > MAX_BYTES) {
    return back(
      '/admin/payments?e=' +
        encodeURIComponent('That file is too big to be a statement. Export a shorter period.'),
    );
  }

  const csv = await file.text();

  let outcome;
  try {
    outcome = await importStatement(env.DB, csv, {
      importId: crypto.randomUUID(),
      filename: file.name,
      // The account holds one currency, and it is the shop's own.
      currency: locals.settings.currency,
      actor: admin.email,
    });
  } catch {
    return back(
      '/admin/payments?e=' +
        encodeURIComponent(
          'That file could not be read as a bank statement. It needs to be the CSV ' +
            'export from your bank, with its column headings intact.',
        ),
    );
  }

  const settled = outcome.results.filter((r) => r.outcome === 'settled').length;

  await audit(
    env.DB,
    admin.email,
    'statement.imported',
    file.name,
    `${outcome.rows} rows · ${settled} settled`,
  );

  if (outcome.rows === 0) {
    return back(
      '/admin/payments?e=' +
        encodeURIComponent(
          'No credits were found in that file. Check it covers the right dates and ' +
            'includes incoming payments, not only what you spent.',
        ),
    );
  }

  return back('/admin/payments?done=imported');
};

const back = (to: string) => new Response(null, { status: 303, headers: { Location: to } });
