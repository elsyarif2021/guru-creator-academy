import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';
import { getPublicConfig } from './config.js';

export class SessionError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function privateResponse(res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Vary', 'Cookie');
}

// A new client for every request: never share a user's session between requests.
export function createRequestClient(req, res, env = process.env) {
  const { url, key } = getPublicConfig(env);
  const cookies = new Map(parseCookieHeader(req.headers.cookie || '').map(({ name, value }) => [name, value]));
  const outgoing = new Map();
  return createServerClient(url, key, {
    cookieOptions: { path: '/', sameSite: 'lax', secure: env.VERCEL === '1' },
    cookies: {
      getAll: () => Array.from(cookies, ([name, value]) => ({ name, value })),
      setAll(entries, headers) {
        for (const { name, value, options } of entries) {
          cookies.set(name, value);
          outgoing.set(name, serializeCookieHeader(name, value, options));
        }
        res.setHeader('Set-Cookie', [...outgoing.values()]);
        // SSR v0.10+ supplies cache headers during token refresh.
        for (const [name, value] of Object.entries(headers || {})) res.setHeader(name, value);
        privateResponse(res);
      }
    }
  });
}

export async function readSession(supabase) {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    if (error.name === 'AuthSessionMissingError' || [400, 401, 403].includes(error.status)) return null;
    throw new SessionError(503, 'auth_unavailable', 'Layanan autentikasi sedang tidak tersedia. Coba lagi.');
  }
  const user = data?.user;
  if (!user || user.is_anonymous) return null;
  const { data: permission, error: roleError } = await supabase.from('academy_admins')
    .select('role').eq('user_id', user.id).maybeSingle();
  if (roleError) {
    throw new SessionError(503, 'database_unavailable', 'Koneksi database atau izin akun belum dapat diperiksa. Coba lagi.');
  }
  const role = ['super_admin', 'admin'].includes(permission?.role) ? permission.role : 'peserta';
  // Display metadata is not used to grant permissions.
  return {
    user: { id: user.id, email: user.email, user_metadata: { full_name: String(user.user_metadata?.full_name || '').slice(0, 200) } },
    role
  };
}
