// Public diagnostics for E-COURSE ACADEMY. Never returns secrets or user data.
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).json({ok:false,message:'Method not allowed'});
  const url=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
  const key=process.env.SUPABASE_PUBLISHABLE_KEY||'';
  if(!url||!key) return res.status(503).json({ok:false,stage:'environment',message:'SUPABASE_URL atau SUPABASE_PUBLISHABLE_KEY belum diatur.'});
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url))return res.status(503).json({ok:false,stage:'environment',message:'SUPABASE_URL harus berupa alamat proyek Supabase resmi.'});
  const headers={apikey:key,Authorization:'Bearer '+key};
  const get=async(path) => {
    try {
      const response=await fetch(url+path,{headers,signal:AbortSignal.timeout(7000)});
      let data={};try{data=await response.json()}catch{}
      return {status:response.status,ok:response.ok,code:String(data.code||data.error_code||data.message||'').slice(0,100)};
    } catch { return {status:0,ok:false,code:'network_or_timeout'}; }
  };
  const auth=await get('/auth/v1/settings');
  const courses=await get('/rest/v1/academy_courses?select=id&limit=1');
  return res.status(auth.ok&&courses.ok?200:503).json({
    ok:auth.ok&&courses.ok,project:url.match(/https:\/\/([^.]+)/)?.[1],
    auth:{ready:auth.ok,status:auth.status,code:auth.ok?undefined:auth.code},
    schema:{coursesReady:courses.ok,status:courses.status,code:courses.ok?undefined:courses.code},
    nextStep:!auth.ok?'Periksa project URL, publishable key, dan pengaturan Auth Supabase.':
      !courses.ok?'Jalankan supabase/schema.sql di SQL Editor proyek Academy, kemudian periksa RLS dan GRANT.':
      'Auth dan katalog tersedia. Untuk administrator, buat dua akun Auth lalu isi academy_admins menggunakan UUID akun.',
    note:'Hasil ini tidak memeriksa login pengguna sungguhan atau semua kebijakan RLS.'
  });
}