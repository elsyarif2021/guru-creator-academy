import { createBrowserClient } from '@supabase/ssr';
import { verifiedSession, exchangeCallback } from './auth-client.js';

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const categories = ['Semua','Pendidikan','Teknologi & AI','Desain','Bisnis','Bahasa','Keislaman','Pengembangan Diri','Lainnya'];
const state = { sb:null, user:null, role:'peserta', view:'home', courses:[], lessons:[], enrollments:[], progress:[], requests:[], report:null, health:null, current:null, index:0, filter:'Semua', query:'', edit:null, menu:false, loading:true, error:'' };
const admin = () => ['admin','super_admin'].includes(state.role);
const superAdmin = () => state.role === 'super_admin';
const paths = {
  home: '/', catalog: '/#catalog', detail: '/#detail', mine: '/kelas-saya',
  login: '/login', register: '/daftar', 'admin-login': '/admin/login', admin: '/admin', editor: '/admin'
};
const protectedViews = ['mine', 'admin', 'editor'];
let sessionCheck = 0;
let dataVersion = 0;
let authBusy = false;
let authRefresh = Promise.resolve();

function requestedView() {
  const pathname = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  if (pathname !== '/') {
    return Object.keys(paths).find(view => paths[view] === pathname) || 'home';
  }
  const hash = location.hash.slice(1);
  return ['catalog', 'mine', 'login', 'register', 'admin-login', 'admin'].includes(hash) ? hash : 'home';
}

function permittedView(view) {
  if (view === 'mine' && !state.user) return 'login';
  if (['admin', 'editor'].includes(view) && !admin()) return 'admin-login';
  return view;
}

function go(view) {
  view = permittedView(view);
  const path = paths[view];
  if (protectedViews.includes(view) && location.pathname !== path) {
    location.assign(path);
    return;
  }
  if (location.pathname + location.search + location.hash !== path) history.pushState(null, '', path);
  state.view = view;
  state.menu = false;
  state.oauthError = '';
  render();
}
const notice = (message) => { const n=document.createElement('div'); n.className='toast'; n.textContent=message; document.body.append(n); setTimeout(()=>n.remove(),4500); };
const youtube = (raw) => { try { const u=new URL(raw); if(!['youtube.com','www.youtube.com','m.youtube.com','youtu.be','www.youtube-nocookie.com'].includes(u.hostname)) return ''; const v = u.hostname === 'youtu.be' ? u.pathname.split('/')[1] : u.searchParams.get('v') || u.pathname.match(/\/(?:shorts|embed|live)\/([^/]+)/)?.[1]; return /^[\w-]{11}$/.test(v||'')?v:''; } catch { return /^[\w-]{11}$/.test(raw)?raw:''; } };
async function init() {
  const requested = requestedView();
  state.view = requested;
  const params = new URLSearchParams(location.search);
  const fragment = new URLSearchParams(location.hash.slice(1));
  const code = params.get('code');
  state.oauthError = params.get('error_code') || params.get('error') ||
    fragment.get('error_code') || fragment.get('error') || '';
  const returning = Boolean(code || state.oauthError);
  try {
    if (!returning && protectedViews.includes(requested) && location.pathname !== paths[requested]) {
      location.replace(paths[requested]);
      return;
    }

    const response = await fetch('/api/config', { cache: 'no-store' });
    if (!response.ok) throw new Error('Koneksi Supabase belum disiapkan di Vercel.');
    const conf = await response.json();
    if (!conf.configured) throw new Error('Supabase belum terhubung.');
    state.sb = createBrowserClient(conf.url, conf.key, {
      auth: { detectSessionInUrl: false },
      cookieOptions: { path: '/', sameSite: 'lax', secure: location.protocol === 'https:' }
    });

    // Supabase may hold its session lock inside this listener. Schedule work,
    // rather than awaiting another auth operation in the callback.
    state.sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        void setSession(true);
        if (!state.loading) {
          const view = permittedView(state.view);
          if (view !== state.view) location.replace(paths[view]);
          else render();
        }
      } else if (!state.loading && ['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) {
        setTimeout(() => {
          authRefresh = authRefresh.then(async () => {
            const previousUser = state.user?.id;
            try {
              await setSession();
              const view = permittedView(state.view);
              if (view !== state.view) return location.replace(paths[view]);
              if (state.user?.id !== previousUser) {
                await Promise.all([loadCatalog(), state.view === 'mine' ? loadMine() : undefined,
                  state.view === 'admin' ? loadRequests() : undefined]);
              }
              render();
            } catch (error) {
              await setSession(true);
              state.error = error.message;
              render();
            }
          });
        }, 0);
      }
    });

    const intent = returning ? sessionStorage.getItem('academy_oauth_intent') : null;
    if (returning) sessionStorage.removeItem('academy_oauth_intent');
    const adminLogin = requested === 'admin-login' || (requested === 'home' && intent === 'admin');
    const loginView = adminLogin ? 'admin-login' : requested === 'register' ? 'register' : 'login';
    if (code && !state.oauthError) {
      state.oauthError = await exchangeCallback(state.sb, params) || '';
    }
    if (returning) history.replaceState(null, '', paths[loginView]);

    await setSession();
    if (code && !state.oauthError) {
      if (state.user) {
        location.replace(adminLogin ? paths.admin : paths.mine);
        return;
      }
      state.oauthError = 'oauth_exchange_failed';
    }

    state.view = returning ? loginView : permittedView(requested);
    if (!returning && requested !== state.view) {
      location.replace(paths[state.view]);
      return;
    }
    await Promise.all([
      loadCatalog(),
      state.view === 'mine' ? loadMine() : undefined,
      state.view === 'admin' ? loadRequests() : undefined
    ]);

  } catch (error) {
    state.error = error.message || 'Gagal menyiapkan aplikasi.';
  }
  state.loading = false;
  render();
}

async function setSession(signedOut = false) {
  const check = ++sessionCheck;
  let user = null;
  let role = 'peserta';
  if (!signedOut) {
    ({ user, role } = await verifiedSession(state.sb));
  }

  if (check !== sessionCheck) return;
  if (user?.id !== state.user?.id || role !== state.role) {
    dataVersion++;
    Object.assign(state, { courses: [], enrollments: [], progress: [], requests: [], lessons: [],
      report: null, current: null, index: 0, edit: null, editLessons: [] });
  }
  state.user = user;
  state.role = role;
}
async function loadCatalog() {
  if(!state.sb)return;
  const check = dataVersion;
  const {data,error}=await state.sb.from('academy_courses').select('id,title,description,category,level,premium,published,created_at').order('created_at',{ascending:false}).limit(200);
  if(check !== dataVersion)return;
  if(error) {notice('Gagal memuat kursus: '+error.message);return;}
  state.courses=data || [];
}
async function loadMine() {
  if(!state.user)return;
  const check = dataVersion;
  const [e,p] = await Promise.all([
    state.sb.from('academy_enrollments').select('id,course_id,status,user_id').eq('user_id',state.user.id),
    state.sb.from('academy_progress').select('lesson_id').eq('user_id',state.user.id)
  ]);
  if(check !== dataVersion)return;
  if(e.error || p.error)notice('Gagal memuat progres kelas.');
  state.enrollments=e.data||[];state.progress=p.data||[];
}
async function loadRequests() {
  if(!admin())return;
  const check = dataVersion;
  const {data,error}=await state.sb.from('academy_enrollments').select('id,course_id,user_id,status,created_at').eq('status','pending').order('created_at',{ascending:true}).limit(100);
  if(check !== dataVersion)return;
  if(error) notice('Tidak dapat memuat pengajuan.');
  state.requests=data||[];
  await loadAdminReport(0);
}
async function openCourse(id) {
  const check = dataVersion;
  state.current=state.courses.find(x=>x.id===id);
  if(!state.current)return;
  state.index=0;
  state.lessons=[];
  await loadMine();
  if(check !== dataVersion)return;
  const enrollment=state.enrollments.find(x=>x.course_id===id && x.status==='approved');
  if(admin() || enrollment) {
    const {data,error}=await state.sb.from('academy_lessons').select('id,course_id,title,youtube_id,position').eq('course_id',id).eq('archived',false).order('position');
    if(check !== dataVersion)return;
    if(!error)state.lessons=data||[];
    else notice('Belum dapat membuka video. Pastikan akses sudah disetujui.');
  }
  go('detail');
}
async function loginGoogle(isAdmin = false) {
  if (!state.sb) return notice('Koneksi Supabase belum siap.');
  if (authBusy) return;
  authBusy = true;
  const buttons = document.querySelectorAll('[data-action="google-admin"],[data-action="google-user"]');
  buttons.forEach(button => { button.disabled = true; });
  try {
    const returnPath = isAdmin ? paths['admin-login'] : paths.login;
    sessionStorage.setItem('academy_oauth_intent', isAdmin ? 'admin' : 'peserta');
    const { error } = await state.sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + returnPath, queryParams: { prompt: 'select_account' } }
    });
    if (error) throw error;
  } catch (error) {
    sessionStorage.removeItem('academy_oauth_intent');
    notice('Login Google tidak tersedia: ' + error.message);
  } finally {
    authBusy = false;
    buttons.forEach(button => { button.disabled = false; });
  }
}

async function signOut() {
  const { error } = await state.sb.auth.signOut({ scope: 'local' });
  if (error) return notice('Gagal keluar. Silakan coba kembali.');
  sessionStorage.removeItem('academy_oauth_intent');
  await setSession(true);
  location.replace(paths.home);
}
async function enroll() {
  if(!state.user)return go('login');
  if(!state.current)return;
  const existing=state.enrollments.find(e=>e.course_id===state.current.id);
  if(existing) return notice(existing.status==='pending'?'Permintaan premium sedang menunggu persetujuan.':'Anda sudah terdaftar.');
  const status=state.current.premium?'pending':'approved';
  const {error}=await state.sb.from('academy_enrollments').insert({course_id:state.current.id,user_id:state.user.id,status});
  if(error)return notice('Pendaftaran tidak berhasil: '+error.message);
  notice(status==='pending'?'Permintaan akses premium dikirim ke admin.':'Berhasil mendaftar kursus gratis.');
  await openCourse(state.current.id);
}
async function completeLesson() {
  if(!state.user || !state.current)return;
  const l=state.lessons[state.index];if(!l)return;
  const {error}=await state.sb.from('academy_progress').upsert({lesson_id:l.id,user_id:state.user.id},{onConflict:'user_id,lesson_id',ignoreDuplicates:true});
  if(error)return notice('Progres tidak dapat disimpan: '+error.message);
  await loadMine();notice('Pelajaran selesai!');render();
}
async function approve(id) {
  if(!admin())return;
  const {error}=await state.sb.from('academy_enrollments').update({status:'approved'}).eq('id',id).eq('status','pending');
  if(error)return notice('Gagal menyetujui akses: '+error.message);
  await loadRequests();notice('Akses premium disetujui.');render();
}
async function saveCourse(ev) {
  ev.preventDefault();if(!admin())return;
  const f=ev.target,title=f.elements.title.value.trim(),description=f.elements.description.value.trim(),category=f.elements.category.value,level=f.elements.level.value,premium=f.elements.premium.checked;
  const lessons = [...f.querySelectorAll('.lessonedit')].map(row => ({
    id: row.dataset.lessonId || null,
    title: row.querySelector('[name=lessonTitle]').value.trim(),
    youtube_id: youtube(row.querySelector('[name=lessonUrl]').value)
  }));
  if (!title || !lessons.length || lessons.some(l => !l.title || !l.youtube_id)) {
    return notice('Isi judul kursus, judul setiap pelajaran, dan URL YouTube yang valid.');
  }
  const submit = f.querySelector('[type=submit]');
  if (submit.disabled) return;
  submit.disabled = true;
  const check = dataVersion;
  try {
    const { error } = await state.sb.rpc('academy_save_course', {
      course: state.edit, details: { title, description, category, level, premium }, lessons
    });
    if (check !== dataVersion) return;
    if (error) return notice('Gagal menyimpan kursus: ' + error.message);
  } finally {
    submit.disabled = false;
  }
  state.edit=null;await loadCatalog();notice('Kursus berhasil disimpan.');go('admin');
}
async function removeCourse(id) {
  if(!admin() || !confirm('Hapus kursus dan semua pendaftaran/progres terkait secara permanen?'))return;
  const {error}=await state.sb.from('academy_courses').delete().eq('id',id);
  if(error)return notice('Tidak dapat menghapus kursus.');
  await loadCatalog();notice('Kursus dihapus.');render();
}
async function beginEdit(id=null) {
  if(!admin()) return;
  state.edit=id;
  state.editLessons=[];
  if(id) {
    const {data,error}=await state.sb.from('academy_lessons')
      .select('id,title,youtube_id,position').eq('course_id',id).eq('archived',false).order('position');
    if(error) return notice('Tidak dapat memuat pelajaran untuk diedit.');
    state.editLessons=data||[];
  }
  go('editor');
}
function addLesson() {const box=$('#lessonRows');if(box)box.insertAdjacentHTML('beforeend',lessonRow(box.children.length));}
function lessonRow(i,l={title:'',youtube_id:''}) {return '<div class="lessonedit" data-lesson-id="'+esc(l.id)+'"><input required name="lessonTitle" placeholder="Judul pelajaran '+(i+1)+'" value="'+esc(l.title)+'"><input required name="lessonUrl" placeholder="Link video YouTube" value="'+esc(l.youtube_id)+'"><button class="btn secondary" type="button" onclick="this.parentElement.remove()">×</button></div>';}
function authView(mode) {
  const register=mode==='register', administrator=mode==='admin-login';
  const blocked=administrator&&state.user&&!admin();
  const oauthError = state.oauthError;
  const oauthMessages = {
    admin_required: 'Akun Google ini belum diberi akses administrator. Gunakan akun yang sudah ditetapkan.',
    bad_oauth_callback: 'Sesi login Google terputus. Mulai lagi dari tombol Google di halaman ini.',
    oauth_exchange_failed: 'Kode login Google tidak dapat dipakai. Mulai lagi di browser yang sama.',
    access_denied: 'Permintaan login Google ditolak. Ulangi login dan setujui akses yang diperlukan.'
  };
  const oauthExplanation = oauthError
    ? Object.hasOwn(oauthMessages, oauthError) ? oauthMessages[oauthError] : 'Login Google gagal. Mulai ulang dari tombol Google.'
    : '';
  const oauthNotice=oauthExplanation?'<div class="notice" role="alert" style="margin:12px 0;border:1px solid #edc988">'+esc(oauthExplanation)+' (Kode: '+esc(oauthError.slice(0,60))+')</div>':'';

  const intro=administrator?'Hanya untuk Super Admin dan Admin yang sudah ditetapkan di database Academy.':
              register?'Peserta baru dapat mendaftar secara otomatis menggunakan akun Google.':
              'Masuk menggunakan akun Google yang telah Anda pilih.';
  return '<section class="auth-wrap"><div class="auth-art"><span class="pill">🎓 Guru Creator Academy</span><h1>Belajar. Bertumbuh. Berkarya.</h1><p>Platform kursus video YouTube gratis dan premium dengan progres tersimpan secara online.</p><div class="auth-illustration">📚 ✦ 🎓</div></div><div class="auth-panel">'
    +'<span class="eyebrow">'+(administrator?'PORTAL ADMINISTRATOR':register?'PENDAFTARAN PESERTA':'AKUN PESERTA')+'</span>'
    +'<h2>'+(administrator?'Login Administrator':register?'Daftar dengan Google':'Masuk dengan Google')+'</h2>'
    +'<p>'+intro+'</p>'
    +oauthNotice
    +(blocked&&oauthError!=='admin_required'?'<div class="notice" style="margin:16px 0">Akun Google ini belum diberi akses administrator. Pilih akun Google yang sudah ditetapkan.</div>':'')
    +'<button class="btn auth-submit" type="button" data-action="'+(administrator?'google-admin':'google-user')+'" style="margin:16px 0;width:100%;justify-content:center;background:#fff;border:1px solid #cfd8e8;color:#263853;font-size:14px"><span aria-hidden="true" style="font-weight:800;color:#4285f4;font-size:20px">G</span> '+(administrator?'Masuk sebagai Admin dengan Google':register?'Daftar dengan Google':'Masuk dengan Google')+' →</button>'
    +(blocked?'<button class="btn secondary" data-action="logout">Keluar dari akun peserta</button>':'')
    +'<div class="auth-switch">'+(administrator?'<button data-go="login">Login Peserta</button>':register?'Sudah terdaftar? <button data-go="login">Masuk</button>':'Belum terdaftar? <button data-go="register">Daftar menggunakan Google</button>')+(administrator?'':' · <button data-go="admin-login">Login Admin Sekolah</button>')+'</div>'
    +'<div class="notice" style="margin-top:14px">Login Google tidak otomatis memberikan hak administrator. Admin harus sudah diberi peran oleh pengelola database. '+(administrator?'Tidak ada pendaftaran admin publik.':'Pendaftaran peserta baru dilakukan saat pertama kali login Google.')+'</div>'
    +healthPanel()+'</div></section>';
}
function courseCard(c) {return '<article class="course" data-course="'+c.id+'"><div class="coursecover"><span style="font-size:65px;color:#3157d8">▶</span><span class="tier '+(c.premium?'premium':'')+'">'+(c.premium?'★ Premium':'Gratis')+'</span></div><div class="coursebody"><div class="eyebrow">'+esc(c.category)+' · '+esc(c.level)+'</div><h3>'+esc(c.title)+'</h3><p>'+esc(c.description||'Belajar melalui video YouTube terstruktur.')+'</p><div class="coursefoot"><span>Kursus video</span><b>Lihat Kelas →</b></div></div></article>';}
function catalog() {
 const list=state.courses.filter(c=>(state.filter==='Semua'||c.category===state.filter)&&[c.title,c.description,c.category].join(' ').toLowerCase().includes(state.query.toLowerCase()));
 return '<div class="pagehead"><span class="eyebrow">KATALOG AKADEMI</span><h1>Temukan kursus impianmu</h1><p>Jelajahi kursus gratis dan premium.</p></div><input class="search" id="searchBox" placeholder="Cari kursus atau topik..." value="'+esc(state.query)+'"><div class="filters">'+categories.map(x=>'<button class="filter '+(state.filter===x?'active':'')+'" data-category="'+esc(x)+'">'+esc(x)+'</button>').join('')+'</div><p style="color:#8793a5;font-size:12px">'+list.length+' kursus ditemukan</p>'+(list.length?'<div class="coursegrid">'+list.map(courseCard).join('')+'</div>':empty('Belum ada kursus yang cocok','Coba kategori atau kata kunci lain.'));}
function empty(a,b){return '<section class="empty"><div style="font-size:36px">📚</div><h3>'+esc(a)+'</h3><p>'+esc(b)+'</p></section>';}
function home() {return '<section class="hero"><div><div class="pill">✦ Platform Belajar Digital</div><h1>Belajar Hal Baru,<br><span>Berbagi Manfaat</span><br>untuk Semua.</h1><p>Bangun keterampilan melalui kursus YouTube terstruktur, gratis maupun premium.</p><button class="btn white" data-go="catalog">Jelajahi Kursus →</button></div><div class="hero-graphic">🎓</div></section><section class="stats"><div class="stat"><div class="stat-icon">📚</div><div><strong>'+state.courses.length+'</strong><small>Total Kursus</small></div></div><div class="stat"><div class="stat-icon">▶️</div><div><strong>'+state.courses.filter(c=>!c.premium).length+'</strong><small>Kursus Gratis</small></div></div><div class="stat"><div class="stat-icon">👑</div><div><strong>'+state.courses.filter(c=>c.premium).length+'</strong><small>Kursus Premium</small></div></div></section><div class="heading"><div><span class="eyebrow">PILIHAN UNTUKMU</span><h2>Mulai perjalanan belajarmu</h2></div><button data-go="catalog">Semua kursus →</button></div>'+(state.courses.length?'<div class="coursegrid">'+state.courses.slice(0,6).map(courseCard).join('')+'</div>':empty('Belum ada kursus','Administrator dapat membuat kursus melalui dashboard admin.'));}
function mine() {
 const records=state.enrollments.map(e=>({...e,course:state.courses.find(c=>c.id===e.course_id)})).filter(e=>e.course);
 return '<div class="pagehead"><span class="eyebrow">DASHBOARD PESERTA</span><h1>Kelas Saya</h1><p>Progres tersimpan di database online.</p></div>'+(records.length?'<div class="coursegrid">'+records.map(e=>'<div>'+courseCard(e.course)+'<p class="notice">Status: '+(e.status==='approved'?'Aktif':e.status==='pending'?'Menunggu persetujuan':'Ditolak')+'</p></div>').join('')+'</div>':empty('Belum mengikuti kelas','Pilih kursus melalui katalog.'));}
function detail() {
 const c=state.current;if(!c)return empty('Kursus tidak ditemukan','Kembali ke katalog.');
 const enrollment=state.enrollments.find(e=>e.course_id===c.id),permitted=admin()||enrollment?.status==='approved';
 const l=state.lessons[state.index];
 return '<button class="btn secondary" data-go="catalog">← Kembali ke Katalog</button><div class="panel" style="margin:22px 0"><span class="eyebrow">'+esc(c.category)+' · '+esc(c.level)+'</span><h2>'+esc(c.title)+'</h2><p>'+esc(c.description)+'</p><p>'+(c.premium?'👑 Premium':'✅ Gratis')+'</p></div>'+(permitted&&l?'<div class="playerarea"><div><div class="player"><iframe title="'+esc(l.title)+'" src="https://www.youtube-nocookie.com/embed/'+l.youtube_id+'?rel=0" allow="accelerometer;autoplay;encrypted-media;gyroscope;picture-in-picture;web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div><div class="panel"><span class="eyebrow">PELAJARAN '+(state.index+1)+' / '+state.lessons.length+'</span><h2>'+esc(l.title)+'</h2><p>Video dapat diputar jika pemiliknya mengizinkan penyematan.</p><button class="btn" data-action="complete">'+(state.progress.some(p=>p.lesson_id===l.id)?'✓ Selesai':'✓ Tandai Selesai')+'</button> <button class="btn secondary" data-action="next">Pelajaran Berikutnya →</button></div></div><aside class="lessons"><h3>Daftar Pelajaran</h3>'+state.lessons.map((x,i)=>'<button class="lesson '+(i===state.index?'current':'')+'" data-lesson="'+i+'">'+(state.progress.some(p=>p.lesson_id===x.id)?'✅':'▶')+' '+(i+1)+'. '+esc(x.title)+'</button>').join('')+'</aside></div>':'<div class="panel locked"><div style="font-size:45px">🔒</div><h2>'+(enrollment?.status==='pending'?'Permintaan Sedang Diproses':c.premium?'Akses Premium':'Ikuti Kelas Gratis')+'</h2><p>'+(enrollment?.status==='pending'?'Tunggu persetujuan admin untuk melihat video.':c.premium?'Ajukan akses premium; admin akan memeriksa pengajuan. Pembayaran belum tersedia.':'Daftar agar bisa menonton dan menyimpan progres.')+'</p>'+(enrollment?.status==='pending'?'':'<button class="btn" data-action="enroll">'+(c.premium?'Ajukan Akses Premium':'Ikuti Kursus Gratis')+'</button>')+'</div>');
}
const reportSize = 25;
let reportRequest = 0;
const dateLabel = value => new Date(value).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' });
const statusLabel = value => ({ approved: 'Aktif', pending: 'Menunggu', rejected: 'Ditolak' })[value] || value;

async function loadAdminReport(page) {
  if (!admin()) return;
  const check = dataVersion;
  const request = ++reportRequest;
  const start = page * reportSize;
  const [enrollments, activity] = await Promise.all([
    state.sb.from('academy_enrollments').select('id,user_id,course_id,status,created_at', { count: 'exact' })
      .order('created_at', { ascending: false }).order('id').range(start, start + reportSize - 1),
    state.sb.from('academy_activity').select('kind,occurred_at,user_id,course_id,item_id,detail', { count: 'exact' })
      .order('occurred_at', { ascending: false }).order('kind').order('item_id').order('user_id')
      .range(start, start + reportSize - 1)
  ]);
  if (check === dataVersion && request === reportRequest) state.report = { page, enrollments, activity };
}

function adminReport() {
  const report = state.report;
  if (!report) return '';
  const { page, enrollments, activity } = report;
  const rows = (result, summary) => result.error ? '<p role="alert">Data gagal dimuat. <button data-action="report-page" data-page="'+page+'">Muat ulang</button></p>' :
    result.data?.length ? result.data.map(row => {
      const course = state.courses.find(c => c.id === row.course_id)?.title || row.course_id;
      return '<div class="studioitem"><div class="details"><b>'+esc(course)+'</b><small>Peserta '+esc(row.user_id)+' · '+esc(dateLabel(row.created_at || row.occurred_at))+'</small></div><span>'+esc(summary(row))+'</span></div>';
    }).join('') : '<p>Belum ada catatan pada halaman ini.</p>';
  const next = (page+1)*reportSize < Math.max(enrollments.count || 0, activity.count || 0);
  return '<section class="panel academy-report"><h2>Pemantauan Peserta</h2><p>'+esc(enrollments.count ?? '—')+' pendaftaran kursus</p>'
    +rows(enrollments,row => statusLabel(row.status))+'<h2>Riwayat Aktivitas Belajar</h2>'
    +rows(activity,row => row.kind+' · '+statusLabel(row.detail))
    +'<div class="report-nav"><button class="btn secondary" data-action="report-page" data-page="'+Math.max(0,page-1)+'" '+(page===0?'disabled':'')+'>Sebelumnya</button><span>Halaman '+(page+1)+'</span><button class="btn secondary" data-action="report-page" data-page="'+(page+1)+'" '+(next?'':'disabled')+'>Berikutnya</button></div></section>';
}

async function loadHealth() {
  const button = $('[data-action="check-health"]');
  if (button) button.disabled = true;
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    state.health = await response.json();
  } catch {
    state.health = { message: 'Endpoint status Vercel tidak dapat dihubungi.' };
  }
  render();
}

function healthPanel() {
  const health = state.health;
  const item = (name,value) => '<dt>'+esc(name)+'</dt><dd>'+esc(value)+'</dd>';
  const status = value => value === true ? 'Terhubung' : value === false ? 'Gagal' : 'Belum diperiksa';
  const results = health ? item('Supabase Auth', status(health.auth?.ready))
    +item('Google Provider',health.auth?.googleEnabled===true?'Aktif':health.auth?.googleEnabled===false?'Nonaktif':'Belum diperiksa')
    +item('Database katalog',status(health.schema?.coursesReady))
    +item('Callback yang harus terdaftar di Google Cloud',health.googleCallback || 'Belum tersedia')
    +item('Pengalihan ke Google (peserta / admin)',[health.oauth?.participant,health.oauth?.admin].map(status).join(' / '))
    +item('Login lengkap dan hak akses akun', 'Perlu diuji dengan akun Google') : '';
  return '<section class="panel academy-health"><h2>Status Integrasi</h2><dl>'
    +item('URL aplikasi',location.origin)+item('Redirect peserta di Supabase',location.origin+'/login')
    +item('Redirect admin di Supabase',location.origin+'/admin/login')+results+'</dl>'
    +(health?.nextStep || health?.message ? '<p role="status">'+esc(health.nextStep || health.message)+'</p>' : '')
    +'<button class="btn secondary" type="button" data-action="check-health">Periksa konfigurasi</button></section>';
}

function adminPage() {
 return '<div class="pagehead"><span class="eyebrow">DASHBOARD ADMINISTRATOR · '+(superAdmin()?'SUPER ADMIN':'ADMIN')+'</span><h1>Kelola Guru Creator Academy</h1><p>Akses pengelolaan untuk Super Admin dan Admin Sekolah.</p></div><div class="stats"><div class="stat"><div class="stat-icon">📘</div><div><strong>'+state.courses.length+'</strong><small>Kursus</small></div></div><div class="stat"><div class="stat-icon">🕒</div><div><strong>'+state.requests.length+'</strong><small>Pengajuan Premium</small></div></div><div class="stat"><div class="stat-icon">🔐</div><div><strong>2</strong><small>Slot Administrator</small></div></div></div>'+healthPanel()+adminReport()+'<div class="panel"><div class="heading"><h2>Kursus dan Materi</h2><button class="btn" data-action="new">+ Kursus Baru</button></div>'+state.courses.map(c=>'<div class="studioitem"><div class="details"><b>'+esc(c.title)+'</b><small>'+esc(c.category)+' · '+(c.premium?'Premium':'Gratis')+'</small></div><button data-course="'+c.id+'">Lihat</button><button data-edit="'+c.id+'">Edit</button><button data-delete="'+c.id+'">Hapus</button></div>').join('')+'</div><div class="panel"><h2>Persetujuan Peserta Premium</h2>'+(state.requests.length?state.requests.map(r=>'<div class="studioitem"><div class="details"><b>'+esc(state.courses.find(c=>c.id===r.course_id)?.title||'Kursus')+'</b><small>Peserta '+esc(r.user_id.slice(0,8))+'… · '+esc(r.created_at.slice(0,10))+'</small></div><button class="btn" data-approve="'+r.id+'">Setujui</button></div>').join(''):'<p>Belum ada permintaan.</p>')+'</div>';
}
function editor() {
 const c=state.courses.find(c=>c.id===state.edit);
 return '<button class="btn secondary" data-go="admin">← Dashboard Admin</button><div class="panel"><h2>'+(c?'Edit Kursus':'Buat Kursus Baru')+'</h2><form class="form" id="courseForm"><label>Nama Kursus</label><input name="title" maxlength="160" required value="'+esc(c?.title||'')+'"><label>Deskripsi</label><textarea name="description" rows="3">'+esc(c?.description||'')+'</textarea><div class="formrow"><div><label>Kategori</label><select name="category">'+categories.slice(1).map(x=>'<option '+(c?.category===x?'selected':'')+'>'+esc(x)+'</option>').join('')+'</select></div><div><label>Level</label><select name="level">'+['Pemula','Menengah','Mahir','Semua Level'].map(x=>'<option '+(c?.level===x?'selected':'')+'>'+x+'</option>').join('')+'</select></div></div><label class="checkline"><input type="checkbox" name="premium" '+(c?.premium?'checked':'')+'> Premium (persetujuan admin)</label><h3>Video YouTube</h3><p>Setiap URL video menjadi satu pelajaran. Playlist ditambahkan satu per satu.</p><div id="lessonRows">'+(state.editLessons?.length?state.editLessons.map((l,i)=>lessonRow(i,l)).join(''):lessonRow(0))+'</div><button type="button" class="btn secondary" data-action="add-lesson">+ Pelajaran</button><p><button class="btn" type="submit">Simpan Kursus</button></p></form></div>';
}
function render() {
 if(state.loading){$('#app').innerHTML='<div class="empty"><h2>Memuat Guru Creator Academy…</h2></div>';return;}
 if(state.error){
  // Public landing page remains visible, but no fake account creation or premium access.
  $('#app').innerHTML='<div class="layout"><aside class="sidebar"><div class="logo"><div class="logo-mark">🎓</div><div><b>Guru Creator Academy</b><small>Platform Pembelajaran</small></div></div><div class="navlabel">MENU UTAMA</div><div class="navbtn active">▦ Beranda</div><div class="navbtn">▤ Katalog Kursus</div><div class="sidebar-tip"><b>✨ Belajar tanpa batas</b><p>Materi YouTube terstruktur, kelas gratis dan premium.</p></div></aside><main class="main"><header class="top"><div><div class="crumb">Platform Pembelajaran / Beranda</div><strong>Selamat datang di Academy 👋</strong></div><span style="color:#a05e05;font-size:12px">● Pengaturan diperlukan</span></header><div class="content"><section class="hero"><div><div class="pill">✦ Platform Belajar Digital</div><h1>Belajar Hal Baru,<br><span>Berbagi Manfaat</span><br>untuk Semua.</h1><p>Platform kursus online dengan video YouTube, kelas gratis dan premium, serta progres belajar.</p></div><div class="hero-graphic">🎓</div></section><section class="panel" style="margin-top:24px;border:1px solid #f2d399;background:#fffcf5"><h2>🔧 Koneksi belum dapat diverifikasi</h2><p>'+esc(state.error)+'</p><p>Sesi akun atau layanan database belum dapat diperiksa. Data privat tidak ditampilkan sampai koneksi terverifikasi.</p>'+healthPanel()+'<button class="btn" data-action="retry">Coba lagi</button></section><section class="features"><div class="feature"><span>▶️</span><h3>Materi YouTube</h3><p>Video dikelompokkan berdasarkan kursus.</p></div><div class="feature"><span>🎓</span><h3>Kelas Terstruktur</h3><p>Kursus gratis dan premium untuk peserta terdaftar.</p></div><div class="feature"><span>✅</span><h3>Progres Belajar</h3><p>Riwayat belajar tersimpan di database setelah aktivasi.</p></div></section></div></main></div>';
  return;
}
 const allowed=['home','catalog','mine','detail','admin','editor','login','register','admin-login'];
 if(!allowed.includes(state.view))state.view='home';
 state.view=permittedView(state.view);
 const views={home,catalog,mine,detail,admin:adminPage,editor,login:()=>authView('login'),register:()=>authView('register'),'admin-login':()=>authView('admin-login')};
 const names={home:'Beranda',catalog:'Katalog Kursus',mine:'Kelas Saya',detail:'Ruang Belajar',admin:'Dashboard Admin',editor:'Editor Kursus',login:'Login',register:'Daftar','admin-login':'Login Admin'};
 const menu=[['home','▦','Beranda'],['catalog','▤','Katalog Kursus'],...(state.user?[['mine','▣','Kelas Saya']]:[]),...(admin()?[['admin','▥','Dashboard Admin']]:[])];
 $('#app').innerHTML='<div class="layout"><aside class="sidebar '+(state.menu?'open':'')+'"><div class="logo"><div class="logo-mark">🎓</div><div><b>Guru Creator Academy</b><small>Platform Pembelajaran</small></div></div><div class="navlabel">MENU UTAMA</div>'+menu.map(([key,icon,name])=>'<button class="navbtn '+(state.view===key?'active':'')+'" data-go="'+key+'"><span style="font-size:20px">'+icon+'</span>'+name+'</button>').join('')+'<div class="sidebar-tip"><b>✨ Belajar tanpa batas</b><p>Video YouTube pilihan, kelas terstruktur, dan progres tersimpan online.</p></div></aside><main class="main"><header class="top"><div style="display:flex;gap:12px;align-items:center"><button class="mobilemenu" data-action="menu">☰</button><div><div class="crumb">Platform Pembelajaran / '+esc(names[state.view])+'</div><strong>Selamat datang di Academy 👋</strong></div></div><div class="topright">'+(state.user?'<span class="user-label">👤 '+esc(state.user.user_metadata?.full_name||state.user.email)+'</span><button class="btn secondary" data-action="logout">Keluar</button>':'<button class="btn secondary" data-go="login">Masuk</button><button class="btn" data-go="register">Daftar</button>')+'</div></header><div class="content">'+views[state.view]()+'</div></main></div>';
 if(state.view==='editor')$('#courseForm').addEventListener('submit',saveCourse);
}
document.addEventListener('click',async e => {
 const t=e.target.closest('button,[data-course]');if(!t)return;
 if(t.dataset.go){go(t.dataset.go);return;}
 if(t.dataset.course){await openCourse(t.dataset.course);return;}
 if(t.dataset.lesson!==undefined){state.index=Number(t.dataset.lesson);render();return;}
 if(t.dataset.category){state.filter=t.dataset.category;render();return;}
 if(t.dataset.edit){beginEdit(t.dataset.edit);return;}
 if(t.dataset.delete){await removeCourse(t.dataset.delete);return;}
 if(t.dataset.approve){await approve(t.dataset.approve);return;}
 switch(t.dataset.action){
 case 'google-admin':await loginGoogle(true);break;
 case 'google-user':await loginGoogle(false);break;
 case 'enroll':await enroll();break;
 case 'complete':await completeLesson();break;
 case 'next':state.index=Math.min(state.index+1,state.lessons.length-1);render();break;
 case 'new':beginEdit();break;
 case 'add-lesson':addLesson();break;
 case 'logout':await signOut();break;
 case 'menu':state.menu=!state.menu;render();break;
 case 'retry':location.reload();break;
 case 'check-health':await loadHealth();break;
 case 'report-page':await loadAdminReport(Number(t.dataset.page));render();break;
 }
});
document.addEventListener('input',e=>{if(e.target.id==='searchBox'){state.query=e.target.value;const box=$('.content');box.innerHTML=catalog();const input=$('#searchBox');input.focus();input.setSelectionRange(input.value.length,input.value.length);}});
function restoreRoute() {
  const requested = requestedView();
  const view = permittedView(requested);
  if (protectedViews.includes(requested)) {
    if (location.pathname === paths[requested] && !location.hash) location.reload();
    else location.replace(paths[requested]);
    return;
  }
  state.view = view;
  state.oauthError = '';
  render();
}
window.addEventListener('popstate', restoreRoute);
window.addEventListener('hashchange', restoreRoute);
init();
