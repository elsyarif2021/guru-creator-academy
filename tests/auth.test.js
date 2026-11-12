import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserClient } from '@supabase/ssr';
import { getPublicConfig } from '../server/config.js';
import { createRequestClient, readSession } from '../server/session.js';
import { serveProtected } from '../server/protected.js';
import sessionHandler from '../api/session.js';
import configHandler from '../api/config.js';
import { verifiedSession, exchangeCallback } from '../auth-client.js';

const url = 'https://example.supabase.co';
const key = 'sb_publishable_test';
const id = '10000000-0000-4000-8000-000000000001';
const user = { id, aud: 'authenticated', role: 'authenticated', email: 'test@example.invalid', is_anonymous: false,
  user_metadata: { full_name: 'Test User', role: 'super_admin' }, created_at: '2026-01-01T00:00:00Z' };
const jwt = (expires = Math.floor(Date.now() / 1000) + 3600) => [
  { alg: 'HS256', typ: 'JWT' }, { sub: id, role: 'authenticated', exp: expires }
].map(part => Buffer.from(JSON.stringify(part)).toString('base64url')).join('.') + '.test-signature';
const payload = () => ({ access_token: jwt(), refresh_token: 'test-refresh', expires_in: 3600, token_type: 'bearer', user });
let savedFetch, savedEnv, requests, role, authFailure, databaseFailure;
function response() {
  return { headers: {}, code: 200, body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
    end() { return this; },
    redirect(code, target) { this.code = code; this.headers.location = target; return this; }
  };
}
beforeEach(() => {
  savedFetch = globalThis.fetch;
  savedEnv = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_PUBLISHABLE_KEY, anon: process.env.SUPABASE_ANON_KEY };
  process.env.SUPABASE_URL = url; process.env.SUPABASE_PUBLISHABLE_KEY = key; delete process.env.SUPABASE_ANON_KEY;
  requests = []; role = null; authFailure = false; databaseFailure = false;
  globalThis.fetch = async (input, init = {}) => {
    const target = String(input); requests.push({ url: target, init });
    assert.ok(target.startsWith(url), 'tests must not contact live services');
    if (target.includes('/auth/v1/token')) return Response.json(payload());
    if (target.includes('/auth/v1/user')) return authFailure
      ? Response.json({ message: 'auth down' }, { status: 503 }) : Response.json(user);
    if (target.includes('/rest/v1/academy_admins')) return databaseFailure
      ? Response.json({ message: 'table unavailable', code: 'PGRST205' }, { status: 404 })
      : Response.json(role ? [{ role }] : []);
    throw new Error('Unexpected endpoint: ' + target);
  };
});
afterEach(() => {
  globalThis.fetch = savedFetch;
  for (const [name, value] of Object.entries({ SUPABASE_URL: savedEnv.url, SUPABASE_PUBLISHABLE_KEY: savedEnv.key, SUPABASE_ANON_KEY: savedEnv.anon })) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});
async function browserCookies() {
  const jar = new Map();
  const browser = createBrowserClient(url, key, { isSingleton: false, auth: { detectSessionInUrl: false },
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: entries => entries.forEach(({ name, value }) => { if (value) jar.set(name, value); else jar.delete(name); }) }
  });
  const { error } = await browser.auth.setSession({ access_token: jwt(), refresh_token: 'test-refresh' });
  assert.equal(error, null);
  return [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('; ');
}

test('public configuration trims URL and accepts the anon fallback', () => {
  assert.deepEqual(getPublicConfig({ SUPABASE_URL: url + '/ ', SUPABASE_ANON_KEY: key }), { url, key });
});
test('secret and service_role keys never leave the config endpoint', () => {
  for (const unsafe of ['sb_secret_private', ['e30', Buffer.from('{"role":"service_role"}').toString('base64url'), 'sig'].join('.')]) {
    process.env.SUPABASE_PUBLISHABLE_KEY = unsafe;
    const res = response(); configHandler({ method: 'GET' }, res);
    assert.equal(res.code, 503); assert.ok(!JSON.stringify(res.body).includes(unsafe));
  }
});
test('session endpoint rejects a missing session and disallows writes', async () => {
  const res = response(); await sessionHandler({ method: 'GET', headers: {} }, res);
  assert.equal(res.code, 401); assert.match(res.headers['cache-control'], /no-store/);
  const post = response(); await sessionHandler({ method: 'POST', headers: {} }, post);
  assert.equal(post.code, 405); assert.equal(post.headers.allow, 'GET');
});
test('browser session cookies authenticate backend and scope database access to the same user', async () => {
  const cookie = await browserCookies();
  const res = response(); await sessionHandler({ method: 'GET', headers: { cookie } }, res);
  assert.equal(res.code, 200); assert.equal(res.body.user.id, id); assert.equal(res.body.role, 'peserta');
  const db = requests.find(r => r.url.includes('/rest/v1/'));
  assert.ok(db.url.includes(`user_id=eq.${id}`));
  assert.equal(new Headers(db.init.headers).get('authorization'), 'Bearer ' + jwt());
  assert.ok(!('access_token' in res.body));
});
test('database role grants admin access; editable user_metadata cannot grant it', async () => {
  const cookie = await browserCookies();
  const denied = response(); await serveProtected({ method: 'GET', headers: { cookie } }, denied, true);
  assert.equal(denied.code, 307); assert.equal(denied.headers.location, '/admin/login?error_code=admin_required');
  role = 'admin';
  const allowed = response(); await serveProtected({ method: 'GET', headers: { cookie } }, allowed, true);
  assert.equal(allowed.code, 200); assert.match(allowed.body, /secure-app.js/);
  assert.match(allowed.headers['cache-control'], /private, no-store/);
});
test('database failure is reported, never silently downgraded to participant', async () => {
  const cookie = await browserCookies(); databaseFailure = true;
  const res = response(); await sessionHandler({ method: 'GET', headers: { cookie } }, res);
  assert.equal(res.code, 503); assert.equal(res.body.code, 'database_unavailable');
});
test('auth outage is unavailable rather than an incorrect login redirect', async () => {
  const cookie = await browserCookies(); authFailure = true;
  const res = response(); await serveProtected({ method: 'GET', headers: { cookie } }, res, false);
  assert.equal(res.code, 503); assert.equal(res.headers.location, undefined);
});
test('separate requests cannot reuse another user session', async () => {
  const cookie = await browserCookies();
  const session = await readSession(createRequestClient({ headers: { cookie } }, response()));
  assert.equal(session.user.id, id);
  const missing = await readSession(createRequestClient({ headers: {} }, response()));
  assert.equal(missing, null);
});
test('anonymous Auth users do not pass protected session verification', async () => {
  assert.equal(await readSession({ auth: { getUser: async () => ({ data: { user: { ...user, is_anonymous: true } }, error: null }) } }), null);
});
test('callback exchanges the matching PKCE flow and reports failures', async () => {
  let supplied;
  const client = { auth: { exchangeCodeForSession: async (...args) => { supplied = args; return { error: null }; } } };
  assert.equal(await exchangeCallback(client, new URLSearchParams('code=test-code&sb_flow_id=test-flow')), null);
  assert.deepEqual(supplied, ['test-code', { flowId: 'test-flow' }]);
  client.auth.exchangeCodeForSession = async () => ({ error: new Error('expired code') });
  assert.equal(await exchangeCallback(client, new URLSearchParams('code=expired')), 'oauth_exchange_failed');
});
test('frontend waits for cookie refresh before requesting server verification', async () => {
  const steps = [];
  const result = await verifiedSession({ auth: { getSession: async () => { steps.push('refresh'); return { error: null }; } } }, async (path, options) => {
    steps.push('server'); assert.equal(path, '/api/session'); assert.equal(options.credentials, 'same-origin');
    return Response.json({ user, role: 'peserta' });
  });
  assert.deepEqual(steps, ['refresh', 'server']); assert.equal(result.user.id, id);
});
test('frontend clears missing sessions but surfaces backend/database outages', async () => {
  const client = { auth: { getSession: async () => ({ error: null }) } };
  assert.deepEqual(await verifiedSession(client, async () => new Response('', { status: 401 })), { user: null, role: 'peserta' });
  await assert.rejects(verifiedSession(client, async () => Response.json({ message: 'Database unavailable' }, { status: 503 })), /Database unavailable/);
});

test('expired cookies are refreshed and Set-Cookie reaches the protected response', async () => {
  const expired = { ...payload(), access_token: jwt(Math.floor(Date.now() / 1000) - 120), expires_at: Math.floor(Date.now() / 1000) - 120 };
  const cookie = 'sb-example-auth-token=base64-' + Buffer.from(JSON.stringify(expired)).toString('base64url');
  const res = response();
  await serveProtected({ method: 'GET', headers: { cookie } }, res, false);
  assert.equal(res.code, 200);
  assert.ok(requests.some(r => r.url.includes('/token?grant_type=refresh_token')));
  assert.ok(res.headers['set-cookie'].some(value => value.startsWith('sb-example-auth-token=')));
  assert.match(res.headers['cache-control'], /private, no-store/);
  assert.equal(res.headers.vary, 'Cookie');
});
test('large browser session cookies survive chunking when read by the server', async () => {
  user.user_metadata.bio = 'test-only'.repeat(800);
  try {
    const cookie = await browserCookies();
    assert.ok(cookie.includes('sb-example-auth-token.0='));
    assert.ok(cookie.includes('sb-example-auth-token.1='));
    const res = response();
    await sessionHandler({ method: 'GET', headers: { cookie } }, res);
    assert.equal(res.code, 200); assert.equal(res.body.user.id, id);
    assert.ok(!JSON.stringify(res.body).includes('test-only'));
  } finally { delete user.user_metadata.bio; }
});
