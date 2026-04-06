export function requiredEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`${name} env var is not set`);
  return String(v).trim();
}

export function optionalEnv(name, fallback = '') {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

export function requestOrigin(req) {
  const explicit = optionalEnv('APP_BASE_URL') || optionalEnv('PUBLIC_APP_URL') || optionalEnv('SITE_URL');
  if (explicit) return explicit.replace(/\/$/, '');
  const host = req?.headers?.host ? String(req.headers.host) : '';
  if (!host) return 'http://localhost:3000';
  const protoHeader = req?.headers?.['x-forwarded-proto'];
  const proto = Array.isArray(protoHeader) ? protoHeader[0] : (protoHeader || 'https');
  return `${proto}://${host}`.replace(/\/$/, '');
}
