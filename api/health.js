// Public diagnostics for Guru Creator Academy. Never returns secrets or user data.
import { getPublicConfig } from '../server/config.js';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).json({ok:false,message:'Method not allowed'});
  let url,key;
  try { ({url,key}=getPublicConfig()); }
  catch { return res.status(503).json({ok:false,stage:'environment',message:'SUPABASE_URL atau kunci publishable/anon belum valid.'}); }
  const headers={apikey:key}; // Publishable keys are not JWTs; never send as Bearer tokens.
  const get=async(path) => {
    try {
      const response=await fetch(url+path,{headers,signal:AbortSignal.timeout(7000)});
      let data={};try{data=await response.json()}catch{}
      return {status:response.status,ok:response.ok,code:String(data.code||data.error_code||data.message||'').slice(0,100),googleEnabled:typeof data?.external?.google==='boolean'?data.external.google:null};
    } catch { return {status:0,ok:false,code:'network_or_timeout'}; }
  };
  const [auth,courses]=await Promise.all([
    get('/auth/v1/settings'),get('/rest/v1/academy_courses?select=id&limit=1')
  ]);
  const origin = 'https://guru-creator-academy.vercel.app';
  const startsGoogle = async path => {
    if (auth.googleEnabled !== true) return false;
    try {
      const query = new URLSearchParams({provider:'google',redirect_to:origin+path});
      const response = await fetch(url+'/auth/v1/authorize?'+query,{redirect:'manual',signal:AbortSignal.timeout(5000)});
      const location = new URL(response.headers.get('location'));
      return response.status >= 300 && response.status < 400 &&
        location.origin === 'https://accounts.google.com' &&
        location.searchParams.get('redirect_uri') === url+'/auth/v1/callback';
    } catch { return false; }
  };
  const [participant,admin]=await Promise.all([startsGoogle('/login'),startsGoogle('/admin/login')]);
  const ready=auth.ok&&courses.ok&&auth.googleEnabled===true&&participant&&admin;
  return res.status(ready?200:503).json({
    ok:ready,project:url.match(/https:\/\/([^.]+)/)?.[1],
    googleCallback:url+'/auth/v1/callback',
    auth:{ready:auth.ok,status:auth.status,googleEnabled:auth.googleEnabled,code:auth.ok?undefined:auth.code},
    oauth:{participant,admin,origin,fullLoginVerified:false},
    schema:{coursesReady:courses.ok,status:courses.status,code:courses.ok?undefined:courses.code},
    nextStep:!auth.ok?'Periksa project URL, publishable key, dan pengaturan Auth Supabase.':
      auth.googleEnabled===false?'Aktifkan Google Provider di Supabase dan daftarkan callback URI Supabase pada Google Cloud OAuth Client.':
      !courses.ok?'Jalankan supabase/schema.sql di SQL Editor proyek Academy, kemudian periksa RLS dan GRANT.':
      'Uji login dari tombol Google dengan akun peserta dan ketiga admin. Status ini hanya memeriksa respons awal Supabase.',
    note:'Google enabled hanya status provider. Jika Google menampilkan redirect_uri_mismatch, daftarkan googleCallback sebagai Authorized redirect URI pada OAuth Client Google yang dipakai Supabase. Hasil ini tidak memeriksa login pengguna sungguhan atau semua kebijakan RLS.'
  });
}
