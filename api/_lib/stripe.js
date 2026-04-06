import crypto from 'node:crypto';
import { requiredEnv, optionalEnv } from './env.js';

const STRIPE_API = 'https://api.stripe.com/v1';

function stripeSecretKey() {
  return requiredEnv('STRIPE_SECRET_KEY');
}

export function getPlanConfig(planRaw) {
  const plan = String(planRaw || '').trim().toLowerCase();
  if (plan === 'paid' || plan === 'pro') {
    return {
      requestedPlan: planRaw,
      planId: 'pro',
      tier: 'paid',
      priceId: optionalEnv('STRIPE_PRICE_PRO_MONTHLY') || optionalEnv('STRIPE_PRICE_PAID') || optionalEnv('STRIPE_PRICE_PRO'),
    };
  }
  if (plan === 'premium') {
    return {
      requestedPlan: planRaw,
      planId: 'premium',
      tier: 'premium',
      priceId: optionalEnv('STRIPE_PRICE_PREMIUM_MONTHLY') || optionalEnv('STRIPE_PRICE_PREMIUM'),
    };
  }
  return null;
}

function encodeForm(body) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body || {})) {
    if (value === undefined || value === null || value === '') continue;
    params.append(key, String(value));
  }
  return params;
}

export async function stripeRequest(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${stripeSecretKey()}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: body ? encodeForm(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch (_) { data = text; }
  }
  if (!res.ok) {
    const detail = (data && data.error && data.error.message) ? data.error.message : `Stripe request failed (${res.status})`;
    throw new Error(detail);
  }
  return data;
}

export function verifyStripeSignature(rawBody, signatureHeader, endpointSecret) {
  const sig = String(signatureHeader || '');
  const secret = String(endpointSecret || '').trim();
  if (!sig || !secret) throw new Error('Missing Stripe signature verification input');
  const parts = Object.fromEntries(sig.split(',').map((part) => {
    const idx = part.indexOf('=');
    return idx === -1 ? [part, ''] : [part.slice(0, idx), part.slice(idx + 1)];
  }));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) throw new Error('Malformed Stripe-Signature header');
  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
  const sigBuf = Buffer.from(signature, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error('Stripe signature verification failed');
  }
  return true;
}

export function entitlementFromStripeStatus(statusRaw) {
  const status = String(statusRaw || '').toLowerCase();
  if (['active', 'trialing', 'past_due', 'unpaid'].includes(status)) return 'active';
  if (['canceled', 'cancelled', 'incomplete_expired'].includes(status)) return 'canceled';
  return status || 'inactive';
}
