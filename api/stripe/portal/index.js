import { json, readJsonBody, withCors } from '../../_lib/http.js';
import { requestOrigin } from '../../_lib/env.js';
import { getActiveEntitlement, getUserFromAccessToken } from '../../_lib/supabase.js';
import { stripeRequest } from '../../_lib/stripe.js';

function bearerToken(req) {
  const auth = String(req?.headers?.authorization || '');
  return auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
}

export default async function handler(req, res) {
  const allowed = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ];
  if (withCors(req, res, allowed)) return;
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed. Use POST.' });

  try {
    const body = await readJsonBody(req);
    const accessToken = bearerToken(req) || String(body?.accessToken || '').trim();
    if (!accessToken) return json(res, 401, { error: 'Missing access token.' });

    const user = await getUserFromAccessToken(accessToken);
    if (!user?.id) return json(res, 401, { error: 'Invalid or expired session.' });

    const entitlement = await getActiveEntitlement(user.id);
    const customerId = entitlement?.stripe_customer_id || '';
    if (!customerId) return json(res, 409, { error: 'No Stripe customer is linked to this account yet.' });

    const origin = requestOrigin(req);
    const portal = await stripeRequest('/billing_portal/sessions', {
      method: 'POST',
      body: {
        customer: customerId,
        return_url: `${origin}/?portal=return`,
      },
    });

    return json(res, 200, { ok: true, url: portal?.url || null });
  } catch (err) {
    console.error('[stripe/portal]', err);
    return json(res, 500, { error: err?.message || 'Customer portal creation failed.' });
  }
}
