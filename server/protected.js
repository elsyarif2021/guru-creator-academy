import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';

const shell = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#1b3db6">
  <title>E-COURSE ACADEMY</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/secure-app.js"></script>
</body>
</html>`;

export async function serveProtected(req, res, administrator) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }

  const login = administrator ? '/admin/login' : '/login';

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return res.status(503).send('Koneksi Supabase belum dikonfigurasi.');

  const cookies = new Map(parseCookieHeader(req.headers.cookie ?? '').map(({ name, value }) => [name, value]));
  const outgoing = new Map();
  const supabase = createServerClient(url, key, {
    cookieOptions: { secure: process.env.VERCEL === '1' },
    cookies: {
      getAll: () => Array.from(cookies, ([name, value]) => ({ name, value })),
      setAll(entries) {
        for (const { name, value, options } of entries) {
          cookies.set(name, value);
          outgoing.set(name, serializeCookieHeader(name, value, options));
        }
        res.setHeader('Set-Cookie', [...outgoing.values()]);
      }
    }
  });

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error && (error.status === 429 || error.status >= 500)) {
    return res.status(503).send('Layanan autentikasi sedang tidak tersedia.');
  }
  if (!user || user.is_anonymous) return res.redirect(307, login);

  if (administrator) {
    const { data, error: roleError } = await supabase.from('academy_admins')
      .select('role').eq('user_id', user.id).maybeSingle();
    if (roleError) return res.status(503).send('Izin administrator belum dapat diperiksa.');
    if (!['super_admin', 'admin'].includes(data?.role)) {
      return res.redirect(307, login + '?error_code=admin_required');
    }
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(shell);
}
