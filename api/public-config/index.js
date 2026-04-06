import { json, withCors } from '../_lib/http.js';
import { optionalEnv, requestOrigin } from '../_lib/env.js';

export default async function handler(req, res) {
  const allowed = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ];
  if (withCors(req, res, allowed)) return;
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed. Use GET.' });

  const baseUrl = requestOrigin(req);
  return json(res, 200, {
    supabaseUrl: optionalEnv('SUPABASE_URL'),
    supabaseAnonKey: optionalEnv('SUPABASE_ANON_KEY'),
    appBaseUrl: baseUrl,
    authRedirectUrl: `${baseUrl}/`,
    stripe: {
      checkoutConfigured: Boolean(optionalEnv('STRIPE_PRICE_PRO_MONTHLY') || optionalEnv('STRIPE_PRICE_PAID') || optionalEnv('STRIPE_PRICE_PRO')) || Boolean(optionalEnv('STRIPE_PRICE_PREMIUM_MONTHLY') || optionalEnv('STRIPE_PRICE_PREMIUM')),
      plans: {
        paid: Boolean(optionalEnv('STRIPE_PRICE_PRO_MONTHLY') || optionalEnv('STRIPE_PRICE_PAID') || optionalEnv('STRIPE_PRICE_PRO')),
        premium: Boolean(optionalEnv('STRIPE_PRICE_PREMIUM_MONTHLY') || optionalEnv('STRIPE_PRICE_PREMIUM')),
      },
    },
  });
}
