import { getPublicConfig } from '../server/config.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ configured: false, message: 'Method not allowed' });
  }
  try {
    res.status(200).json({ configured: true, ...getPublicConfig() });
  } catch {
    res.status(503).json({ configured: false, message: 'Konfigurasi publik Supabase belum valid. Periksa URL dan kunci publishable/anon di Vercel.' });
  }
}
