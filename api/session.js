import { createRequestClient, privateResponse, readSession } from '../server/session.js';

export default async function handler(req, res) {
  privateResponse(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ code: 'method_not_allowed', message: 'Method not allowed' });
  }
  try {
    const session = await readSession(createRequestClient(req, res));
    if (!session) return res.status(401).json({ code: 'unauthenticated', message: 'Silakan masuk kembali.' });
    return res.status(200).json(session);
  } catch (error) {
    return res.status(503).json({ code: error.code || 'configuration_error', message: error.code ? error.message : 'Koneksi Supabase belum dikonfigurasi dengan benar.' });
  }
}
