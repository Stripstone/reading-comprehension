import { requiredEnv } from './env.js';

function supabaseBaseUrl() {
  return requiredEnv('SUPABASE_URL').replace(/\/$/, '');
}

function restHeaders({ service = false, jwt = '' } = {}) {
  const anon = requiredEnv('SUPABASE_ANON_KEY');
  const secret = requiredEnv('SUPABASE_SECRET_KEY');
  const headers = {
    apikey: service ? secret : anon,
    Authorization: `Bearer ${service ? secret : (jwt || anon)}`,
    Accept: 'application/json',
  };
  return headers;
}

export async function getUserFromAccessToken(accessToken) {
  const token = String(accessToken || '').trim();
  if (!token) return null;
  const res = await fetch(`${supabaseBaseUrl()}/auth/v1/user`, {
    method: 'GET',
    headers: {
      ...restHeaders({ service: false, jwt: token }),
    },
  });
  if (!res.ok) return null;
  return await res.json();
}

export async function supabaseRest(path, { method = 'GET', body, jwt = '', service = false, headers = {} } = {}) {
  const url = `${supabaseBaseUrl()}/rest/v1/${String(path || '').replace(/^\//, '')}`;
  const finalHeaders = {
    ...restHeaders({ service, jwt }),
    ...headers,
  };
  if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch (_) { data = text; }
  }
  return { ok: res.ok, status: res.status, data };
}

export async function getActiveEntitlement(userId) {
  const query = `user_entitlements?user_id=eq.${encodeURIComponent(userId)}&select=*&order=updated_at.desc.nullslast,period_end.desc.nullslast&limit=1`;
  const out = await supabaseRest(query, { method: 'GET', service: true });
  if (!out.ok) return null;
  return Array.isArray(out.data) ? (out.data[0] || null) : null;
}

export async function upsertEntitlement(row) {
  const userId = encodeURIComponent(String(row?.user_id || ''));
  if (!userId) throw new Error('Missing user_id for entitlement write');
  const existing = await supabaseRest(`user_entitlements?user_id=eq.${userId}&select=id&limit=1`, {
    method: 'GET',
    service: true,
  });
  if (!existing.ok) throw new Error(`Supabase entitlement lookup failed (${existing.status})`);
  const record = Array.isArray(existing.data) ? (existing.data[0] || null) : null;
  const out = record && record.id
    ? await supabaseRest(`user_entitlements?id=eq.${encodeURIComponent(String(record.id))}`, {
        method: 'PATCH',
        service: true,
        body: row,
        headers: { Prefer: 'return=representation' },
      })
    : await supabaseRest('user_entitlements', {
        method: 'POST',
        service: true,
        body: [row],
        headers: { Prefer: 'return=representation' },
      });
  if (!out.ok) throw new Error(`Supabase entitlement write failed (${out.status})`);
  return Array.isArray(out.data) ? (out.data[0] || null) : out.data;
}
