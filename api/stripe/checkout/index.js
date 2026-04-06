import { json, readJsonBody, withCors } from '../../_lib/http.js';
import { requestOrigin } from '../../_lib/env.js';
import { getUserFromAccessToken, getActiveEntitlement } from '../../_lib/supabase.js';
import { getPlanConfig, stripeRequest } from '../../_lib/stripe.js';

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

    const plan = getPlanConfig(body?.plan);
    if (!plan) return json(res, 400, { error: 'Unknown plan requested.' });
    if (!plan.priceId) {
      return json(res, 409, { error: 'Stripe price is not configured for this plan.', detail: { planId: plan.planId, expectedEnv: plan.tier === 'paid' ? 'STRIPE_PRICE_PRO_MONTHLY' : 'STRIPE_PRICE_PREMIUM_MONTHLY' } });
    }

    const origin = requestOrigin(req);
    const successUrl = `${origin}/?checkout=success&plan=${encodeURIComponent(plan.planId)}`;
    const cancelUrl = `${origin}/?checkout=cancel&plan=${encodeURIComponent(plan.planId)}`;

    const currentEntitlement = await getActiveEntitlement(user.id).catch(() => null);
    const existingCustomerId = currentEntitlement?.stripe_customer_id || '';

    const session = await stripeRequest('/checkout/sessions', {
      method: 'POST',
      body: {
        mode: 'subscription',
        success_url: successUrl,
        cancel_url: cancelUrl,
        allow_promotion_codes: 'true',
        billing_address_collection: 'auto',
        'line_items[0][price]': plan.priceId,
        'line_items[0][quantity]': '1',
        customer: existingCustomerId || undefined,
        customer_email: existingCustomerId ? undefined : (user.email || undefined),
        client_reference_id: user.id,
        'metadata[user_id]': user.id,
        'metadata[plan_id]': plan.planId,
        'metadata[tier]': plan.tier,
        'subscription_data[metadata][user_id]': user.id,
        'subscription_data[metadata][plan_id]': plan.planId,
        'subscription_data[metadata][tier]': plan.tier,
      },
    });

    return json(res, 200, {
      ok: true,
      url: session?.url || null,
      id: session?.id || null,
      planId: plan.planId,
      tier: plan.tier,
    });
  } catch (err) {
    console.error('[stripe/checkout]', err);
    return json(res, 500, { error: err?.message || 'Checkout session creation failed.' });
  }
}
