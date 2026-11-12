// Local test harness only. Supabase responses are synthetic; never deploy this file.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import config from '../../api/config.js';
import session from '../../api/session.js';
import { serveProtected } from '../../server/protected.js';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
const id = '10000000-0000-4000-8000-000000000001';
const user = { id, aud: 'authenticated', role: 'authenticated', email: 'test@example.invalid', is_anonymous: false, user_metadata: { full_name: 'Test User' }, created_at: '2026-01-01T00:00:00Z' };
globalThis.fetch = async (input, options = {}) => {
  const target = String(input);
  if (!target.startsWith(process.env.SUPABASE_URL)) throw new Error('External requests disabled in test harness');
  const token = new Headers(options.headers).get('authorization')?.split(' ')[1];
  let claims = {};
  try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')); } catch {}
  if (target.includes('/auth/v1/user')) return Response.json(user);
  if (target.includes('/rest/v1/academy_admins')) return Response.json(claims.test_role === 'admin' ? [{ role: 'admin' }] : []);
  throw new Error('Unexpected fake upstream: ' + target);
};
const server = createServer(async (req, res) => {
  res.status = code => { res.statusCode = code; return res; };
  res.send = body => { res.end(body); return res; };
  res.json = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); return res; };
  res.redirect = (code, location) => { res.statusCode = code; res.setHeader('Location', location); res.end(); return res; };
  const path = new URL(req.url, 'http://localhost').pathname;
  try {
    if (path === '/api/config') return config(req, res);
    if (path === '/api/session') return await session(req, res);
    if (path === '/admin') return await serveProtected(req, res, true);
    if (path === '/kelas-saya') return await serveProtected(req, res, false);
    const route = { '/': 'index.html', '/login': 'login.html', '/daftar': 'daftar.html', '/admin/login': 'admin/login.html', '/secure-app.js': 'secure-app.js', '/style.css': 'style.css' }[path];
    if (!route) return res.status(404).send('Not found');
    res.setHeader('Content-Type', route.endsWith('.js') ? 'text/javascript' : route.endsWith('.css') ? 'text/css' : 'text/html');
    return res.send(await readFile(resolve('dist', route)));
  } catch (error) { res.status(500).send(error.message); }
});
server.listen(4173, '127.0.0.1', () => console.log('Local auth test harness on http://127.0.0.1:4173'));
