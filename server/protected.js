import { createRequestClient, privateResponse, readSession } from './session.js';

const shell = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#1b3db6">
  <title>Guru Creator Academy</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/secure-app.js"></script>
</body>
</html>`;

export async function serveProtected(req, res, administrator) {
  privateResponse(res);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }

  const login = administrator ? '/admin/login' : '/login';

  try {
    const session = await readSession(createRequestClient(req, res));
    if (!session) return res.redirect(307, login);
    if (administrator && !['super_admin', 'admin'].includes(session.role)) {
      return res.redirect(307, login + '?error_code=admin_required');
    }
  } catch (error) {
    return res.status(503).send(error.code ? error.message : 'Koneksi Supabase belum dikonfigurasi dengan benar.');
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(shell);
}
