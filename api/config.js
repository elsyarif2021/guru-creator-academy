export default function handler(req, res) {
  res.setHeader('Cache-Control','no-store');
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || '';
  if (!url || !key) return res.status(503).json({ configured: false, message: 'Supabase belum dikonfigurasi di Vercel.' });
  res.status(200).json({ configured: true, url, key });
}
