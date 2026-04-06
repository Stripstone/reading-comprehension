import { json } from '../../_lib/http.js';
import { requiredEnv } from '../../_lib/env.js';
import { stripeRequest, verifyStripeSignature, entitlementFromStripeStatus } from '../../_lib/stripe.js';
import { upsertEntitlement } from '../../_lib/supabase.js';

async function readRawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function toIsoFromUnix(unix) {
  const n = Number(unix);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}

function derivePlanFromPriceId(priceId) {
  const v = String(priceId || '');
  if (!v) return { planId: 'basic', tier: 'free' };
  const pro = [process.env.STRIPE_PRICE_PRO_MONTHLY, process.env.STRIPE_PRICE_PAID, process.env.STRIPE_PRICE_PRO].filter(Boolean);
  const premium = [process.env.STRIPE_PRICE_PREMIUM_MONTHLY, process.env.STRIPE_PRICE_PREMIUM].filter(Boolean);
  if (pro.includes(v)) return { planId: 'pro', tier: 'paid' };
  if (premium.includes(v)) return { planId: 'premium', tier: 'premium' };
  return { planId: 'basic', tier: 'free' };
}

async function getSubscription(subscriptionId) {
  if (!subscriptionId) return null;
  return await stripeRequest(`/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: 'GET' });
}

async function applyEntitlementFromSubscription(subscription, fallbackMeta = {}) {
  const metadata = { ...(subscription?.metadata || {}), ...(fallbackMeta || {}) };
  const userId = String(metadata.user_id || '').trim();
  if (!userId) throw new Error('Missing user_id in Stripe subscription metadata');

  const priceId = subscription?.items?.data?.[0]?.price?.id || '';
  const derivedPlan = derivePlanFromPriceId(priceId);
  const planId = String(metadata.plan_id || derivedPlan.planId || 'basic');
  const tier = String(metadata.tier || derivedPlan.tier || 'free');
  const status = entitlementFromStripeStatus(subscription?.status);
  const cancelState = status === 'canceled' || status === 'inactive';

  return await upsertEntitlement({
    user_id: userId,
    provider: 'stripe',
    plan_id: cancelState ? 'basic' : planId,
    tier: cancelState ? 'free' : tier,
    status,
    stripe_customer_id: subscription?.customer || null,
    stripe_subscription_id: subscription?.id || null,
    period_start: toIsoFromUnix(subscription?.current_period_start),
    period_end: toIsoFromUnix(subscription?.current_period_end),
    updated_at: new Date().toISOString(),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed. Use POST.' });

  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers['stripe-signature'];
    verifyStripeSignature(rawBody, signature, requiredEnv('STRIPE_WEBHOOK_SECRET'));

    const event = JSON.parse(rawBody || '{}');
    const type = String(event?.type || '');
    const object = event?.data?.object || {};

    switch (type) {
      case 'checkout.session.completed': {
        const subscriptionId = object?.subscription || '';
        const subscription = await getSubscription(subscriptionId);
        if (subscription) await applyEntitlementFromSubscription(subscription, object?.metadata || {});
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await applyEntitlementFromSubscription(object, object?.metadata || {});
        break;
      }
      default:
        break;
    }

    return json(res, 200, { received: true });
  } catch (err) {
    console.error('[stripe/webhook]', err);
    return json(res, 400, { error: err?.message || 'Webhook handling failed.' });
  }
}
