// Only public keys may be used by the browser or by a user-scoped server client.
export function getPublicConfig(env = process.env) {
  const url = (env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = (env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '').trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || !key) {
    throw new Error('SUPABASE_URL dan kunci publishable/anon Supabase belum dikonfigurasi dengan benar.');
  }
  let publicKey = key.startsWith('sb_publishable_');
  if (!publicKey && key.split('.').length === 3) {
    try {
      publicKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon';
    } catch { /* Reject malformed or privileged keys. */ }
  }
  if (!publicKey) throw new Error('Gunakan kunci publishable atau anon, bukan service_role/secret key.');
  return { url, key };
}
