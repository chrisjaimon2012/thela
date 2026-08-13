import type { APIRoute } from 'astro';
import { endSession } from '../../lib/admin/auth';

/**
 * A GET, deliberately.
 *
 * Signing out is not a dangerous action — the worst a forged link can do is
 * inconvenience someone — and making it a form means it cannot be a plain link
 * in the header, which is where every shopkeeper will look for it.
 */
export const GET: APIRoute = ({ cookies }) => {
  endSession(cookies);
  return new Response(null, { status: 303, headers: { Location: '/admin/login' } });
};
