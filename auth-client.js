export async function verifiedSession(supabase, request = fetch) {
  // Refresh cookies before the server reads them; getSession never authorizes.
  const { error } = await supabase.auth.getSession();
  if (error && ![400, 401, 403].includes(error.status)) {
    throw new Error('Sesi belum dapat diperbarui. Coba lagi.');
  }
  const response = await request('/api/session', { credentials: 'same-origin', cache: 'no-store' });
  if (response.status === 401) return { user: null, role: 'peserta' };
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Sesi dan database belum dapat diverifikasi.');
  return data;
}

export async function exchangeCallback(supabase, params) {
  const code = params.get('code');
  if (!code) return null;
  const flowId = params.get('sb_flow_id');
  const { error } = await supabase.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
  return error ? 'oauth_exchange_failed' : null;
}
