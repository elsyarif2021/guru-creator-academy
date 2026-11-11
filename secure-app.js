import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const categories = ['Semua','Pendidikan','Teknologi & AI','Desain','Bisnis','Bahasa','Keislaman','Pengembangan Diri','Lainnya'];
const state = { sb:null, user:null, role:'peserta', view:'home', courses:[], lessons:[], enrollments:[], progress:[], requests:[], current:null, index:0, filter:'Semua', query:'', edit:null, menu:false, loading:true, error:'' };
const admin = () => ['admin','super_admin'].includes(state.role);
const superAdmin = () => state.role === 'super_admin';
const go = (view) => { state.view=view; if(view==='admin' && !admin()) state.view='admin-login'; if(view==='mine' && !state.user) state.view='login'; state.menu=false; location.hash = '#'+state.view; render(); };
const notice = (message) => { const n=document.createElement('div'); n.className='toast'; n.textContent=message; document.body.append(n); setTimeout(()=>n.remove(),4500); };
const youtube = (raw) => { try { const u=new URL(raw); if(!['youtube.com','www.youtube.com','m.youtube.com','youtu.be','www.youtube-nocookie.com'].includes(u.hostname)) return ''; const v = u.hostname === 'youtu.be' ? u.pathname.split('/')[1] : u.searchParams.get('v') || u.pathname.match(/\/(?:shorts|embed|live)\/([^/]+)/)?.[1]; return /^[\w-]{11}$/.test(v||'')?v:''; } catch { return /^[\w-]{11}$/.test(raw)?raw:''; } };
async function init() {
  try {
    const response = await fetch('/api/config',{cache:'no-store'});
    if(!response.ok) throw new Error('Koneksi Supabase belum disiapkan. Administrator perlu mengisi SUPABASE_URL dan SUPABASE_PUBLISHABLE_KEY di Vercel.');
    const conf = await response.json();
    if(!conf.configured) throw new Error('Supabase belum terhubung.');
    state.sb = createClient(conf.url, conf.key, {auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}});
    const {data:{session}} = await state.sb.auth.getSession();
    await setSession(session);
    state.sb.auth.onAuthStateChange((_event,s) => { queueMicrotask(async()=> { await setSession(s); render(); }); });
    const requested=location.pathname.startsWith('/admin/login')?'admin-login':location.hash.slice(1);
    if(['home','catalog','mine','admin','login','register','admin-login'].includes(requested))state.view=requested;
    if(state.view==='admin'&&!admin())state.view='admin-login';
    if(state.view==='mine'&&!state.user)state.view='login';
    await loadCatalog();
  } catch(e) {state.error=e.message || 'Gagal menyiapkan aplikasi.';}
  state.loading=false; render();
}
async function setSession(session) {
  state.user=session?.user || null;
  state.role='peserta';
  if(state.user) {
    const {data,error}=await state.sb.from('academy_admins').select('role').eq('user_id',state.user.id).maybeSingle();
    if(!error && data?.role)state.role=data.role;
  }
}
async function loadCatalog() {
  if(!state.sb)return;
  const {data,error}=await state.sb.from('academy_courses').select('id,title,description,category,level,premium,published,created_at').order('created_at',{ascending:false}).limit(200);
  if(error) {notice('Gagal memuat kursus: '+error.message);return;}
  state.courses=data || [];
}
async function loadMine() {
  if(!state.user)return;
  const [e,p] = await Promise.all([
    state.sb.from('academy_enrollments').select('id,course_id,status,user_id').eq('user_id',state.user.id),
    state.sb.from('academy_progress').select('lesson_id').eq('user_id',state.user.id)
  ]);
  if(e.error || p.error)notice('Gagal memuat progres kelas.');
  state.enrollments=e.data||[];state.progress=p.data||[];
}
async function loadRequests() {
  if(!admin())return;
  const {data,error}=await state.sb.from('academy_enrollments').select('id,course_id,user_id,status,created_at').eq('status','pending').order('created_at',{ascending:true}).limit(100);
  if(error) notice('Tidak dapat memuat pengajuan.');
  state.requests=data||[];
}
async function openCourse(id) {
  state.current=state.courses.find(x=>x.id===id);
  if(!state.current)return;
  state.index=0;
  state.lessons=[];
  await loadMine();
  const enrollment=state.enrollments.find(x=>x.course_id===id && x.status==='approved');
  if(admin() || enrollment) {
    const {data,error}=await state.sb.from('academy_lessons').select('id,course_id,title,youtube_id,position').eq('course_id',id).order('position');
    if(!error)state.lessons=data||[];
    else notice('Belum dapat membuka video. Pastikan akses sudah disetujui.');
  }
  go('detail');
}
async function signIn(ev,isAdmin=false) {
  ev.preventDefault();
  const f=ev.target;
  const email=f.elements.email.value.trim();
  const password=f.elements.password.value;
  const {error}=await state.sb.auth.signInWithPassword({email,password});
  if(error)return notice('Login gagal: periksa email, kata sandi, atau verifikasi email.');
  await setSession((await state.sb.auth.getSession()).data.session);
  if(isAdmin && !admin()) {await state.sb.auth.signOut();state.user=null;state.role='peserta';return notice('Akun ini bukan administrator. Gunakan halaman login peserta.');}
  await loadCatalog(); await loadMine();
  if(admin())await loadRequests();
  go(isAdmin?'admin':'mine');
}
async function signUp(ev) {
  ev.preventDefault();
  const f=ev.target, name=f.elements.fullname.value.trim(), email=f.elements.email.value.trim();
  if(name.length<2)return notice('Nama lengkap minimal dua karakter.');
  if(f.elements.password.value.length<8)return notice('Kata sandi minimal 8 karakter.');
  if(f.elements.password.value!==f.elements.confirmation.value)return notice('Konfirmasi kata sandi tidak sama.');
  const {data,error}=await state.sb.auth.signUp({email,password:f.elements.password.value,options:{data:{full_name:name}}});
  if(error)return notice('Pendaftaran gagal: '+error.message);
  notice(data.session?'Pendaftaran berhasil.':'Pendaftaran berhasil, periksa email untuk verifikasi akun.');
  if(data.session){await setSession(data.session);go('mine');}else go('login');
}
async function signOut() {await state.sb.auth.signOut();state.user=null;state.role='peserta';state.enrollments=[];state.lessons=[];go('home');}
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
  const titles=[...f.querySelectorAll('[name=lessonTitle]')];
  const urls=[...f.querySelectorAll('[name=lessonUrl]')];
  const lessons=titles.map((x,i)=>({title:x.value.trim(),youtube_id:youtube(urls[i].value),position:i}));
  if(!title||!lessons.length||lessons.some(x=>!x.title||!x.youtube_id))return notice('Isi judul kursus, setiap judul pelajaran dan URL YouTube valid.');
  let id=state.edit;
  if(id) {
    const {error}=await state.sb.from('academy_courses').update({title,description,category,level,premium}).eq('id',id);
    if(error)return notice('Gagal memperbarui kursus: '+error.message);
    // Replace lessons only after course edit succeeds; deletions may cascade to lesson progress.
    const del=await state.sb.from('academy_lessons').delete().eq('course_id',id);
    if(del.error)return notice('Kursus tersimpan, tetapi pembaruan pelajaran gagal.');
  } else {
    const {data,error}=await state.sb.from('academy_courses').insert({title,description,category,level,premium,created_by:state.user.id}).select('id').single();
    if(error)return notice('Tidak dapat menyimpan kursus: '+error.message);
    id=data.id;
  }
  const {error}=await state.sb.from('academy_lessons').insert(lessons.map(l=>({...l,course_id:id})));
  if(error)return notice('Kursus dibuat, tetapi penyimpanan daftar pelajaran gagal: '+error.message);
  state.edit=null;await loadCatalog();notice('Kursus berhasil disimpan.');go('admin');
}
async function removeCourse(id) {
  if(!admin() || !confirm('Hapus kursus dan semua pendaftaran/progres terkait secara permanen?'))return;
  const {error}=await state.sb.from('academy_courses').delete().eq('id',id);
  if(error)return notice('Tidak dapat menghapus kursus.');
  await loadCatalog();notice('Kursus dihapus.');render();
}
function beginEdit(id=null) {if(!admin())return;state.edit=id;go('editor');}
function addLesson() {const box=$('#lessonRows');if(box)box.insertAdjacentHTML('beforeend',lessonRow(box.children.length));}
function lessonRow(i,l={title:'',youtube_id:''}) {return '<div class="lessonedit"><input required name="lessonTitle" placeholder="Judul pelajaran '+(i+1)+'" value="'+esc(l.title)+'"><input required name="lessonUrl" placeholder="Link video YouTube" value="'+esc(l.youtube_id)+'"><button class="btn secondary" type="button" onclick="this.parentElement.remove()">×</button></div>';}
function authView(mode) {
 const register=mode==='register',administrator=mode==='admin-login';
 return '<section class="auth-wrap"><div class="auth-art"><span class="pill">🎓 E-COURSE ACADEMY</span><h1>Belajar. Bertumbuh. Berkarya.</h1><p>Portal belajar digital melalui kursus YouTube dengan progres tersimpan secara online.</p><div class="auth-illustration">📚 ✦ 🎓</div></div><div class="auth-panel"><span class="eyebrow">'+(administrator?'PORTAL ADMINISTRATOR':register?'PENDAFTARAN PESERTA':'AKUN PESERTA')+'</span><h2>'+(administrator?'Login Administrator':register?'Daftar Akun Baru':'Selamat Datang Kembali')+'</h2><p>'+(administrator?'Hanya untuk dua akun administrator yang ditunjuk.':register?'Daftar terlebih dahulu untuk mengikuti kursus.':'Masuk menggunakan akun peserta terdaftar.')+'</p><form class="form" id="authForm">'+(register?'<label>Nama lengkap</label><input name="fullname" autocomplete="name" required minlength="2" maxlength="100" placeholder="Nama lengkap">':'')+'<label>Email</label><input type="email" name="email" autocomplete="email" required placeholder="nama@email.com"><label>Kata sandi</label><input name="password" type="password" autocomplete="'+(register?'new-password':'current-password')+'" required minlength="'+(register?8:1)+'" placeholder="Kata sandi">'+(register?'<label>Konfirmasi kata sandi</label><input type="password" name="confirmation" autocomplete="new-password" minlength="8" required placeholder="Ulangi kata sandi">':'')+'<button class="btn auth-submit" type="submit">'+(register?'Daftar Sekarang':'Masuk')+' →</button></form><div class="auth-switch">'+(administrator?'<button data-go="login">Login Peserta</button>':register?'Sudah punya akun? <button data-go="login">Masuk</button>':'Belum terdaftar? <button data-go="register">Daftar</button>')+'</div></div></section>';
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
function adminPage() {
 return '<div class="pagehead"><span class="eyebrow">DASHBOARD ADMINISTRATOR · '+(superAdmin()?'SUPER ADMIN':'ADMIN')+'</span><h1>Kelola E-COURSE ACADEMY</h1><p>Hanya dua akun administrator yang telah disahkan.</p></div><div class="stats"><div class="stat"><div class="stat-icon">📘</div><div><strong>'+state.courses.length+'</strong><small>Kursus</small></div></div><div class="stat"><div class="stat-icon">🕒</div><div><strong>'+state.requests.length+'</strong><small>Pengajuan Premium</small></div></div><div class="stat"><div class="stat-icon">🔐</div><div><strong>2</strong><small>Slot Administrator</small></div></div></div><div class="panel"><div class="heading"><h2>Kursus</h2><button class="btn" data-action="new">+ Kursus Baru</button></div>'+state.courses.map(c=>'<div class="studioitem"><div class="details"><b>'+esc(c.title)+'</b><small>'+esc(c.category)+' · '+(c.premium?'Premium':'Gratis')+'</small></div><button data-course="'+c.id+'">Lihat</button><button data-edit="'+c.id+'">Edit</button><button data-delete="'+c.id+'">Hapus</button></div>').join('')+'</div><div class="panel"><h2>Persetujuan Peserta Premium</h2>'+(state.requests.length?state.requests.map(r=>'<div class="studioitem"><div class="details"><b>'+esc(state.courses.find(c=>c.id===r.course_id)?.title||'Kursus')+'</b><small>Peserta '+esc(r.user_id.slice(0,8))+'… · '+esc(r.created_at.slice(0,10))+'</small></div><button class="btn" data-approve="'+r.id+'">Setujui</button></div>').join(''):'<p>Belum ada permintaan.</p>')+'</div>';
}
function editor() {
 const c=state.courses.find(c=>c.id===state.edit);
 return '<button class="btn secondary" data-go="admin">← Dashboard Admin</button><div class="panel"><h2>'+(c?'Edit Kursus':'Buat Kursus Baru')+'</h2><form class="form" id="courseForm"><label>Nama Kursus</label><input name="title" maxlength="160" required value="'+esc(c?.title||'')+'"><label>Deskripsi</label><textarea name="description" rows="3">'+esc(c?.description||'')+'</textarea><div class="formrow"><div><label>Kategori</label><select name="category">'+categories.slice(1).map(x=>'<option '+(c?.category===x?'selected':'')+'>'+esc(x)+'</option>').join('')+'</select></div><div><label>Level</label><select name="level">'+['Pemula','Menengah','Mahir','Semua Level'].map(x=>'<option '+(c?.level===x?'selected':'')+'>'+x+'</option>').join('')+'</select></div></div><label class="checkline"><input type="checkbox" name="premium" '+(c?.premium?'checked':'')+'> Premium (persetujuan admin)</label><h3>Video YouTube</h3><p>Setiap URL video menjadi satu pelajaran. Playlist ditambahkan satu per satu.</p><div id="lessonRows">'+lessonRow(0)+'</div><button type="button" class="btn secondary" data-action="add-lesson">+ Pelajaran</button><p><button class="btn" type="submit">Simpan Kursus</button></p></form></div>';
}
function render() {
 if(state.loading){$('#app').innerHTML='<div class="empty"><h2>Memuat E-COURSE ACADEMY…</h2></div>';return;}
 if(state.error){$('#app').innerHTML='<div class="empty"><h2>Pengaturan Backend Dibutuhkan</h2><p>'+esc(state.error)+'</p><p>Isi environment Vercel dan jalankan supabase/schema.sql terlebih dahulu.</p></div>';return;}
 const allowed=['home','catalog','mine','detail','admin','editor','login','register','admin-login'];
 if(!allowed.includes(state.view))state.view='home';
 if(['admin','editor'].includes(state.view)&&!admin())state.view='admin-login';
 const views={home,catalog,mine,detail,admin:adminPage,editor,login:()=>authView('login'),register:()=>authView('register'),'admin-login':()=>authView('admin-login')};
 const names={home:'Beranda',catalog:'Katalog Kursus',mine:'Kelas Saya',detail:'Ruang Belajar',admin:'Dashboard Admin',editor:'Editor Kursus',login:'Login',register:'Daftar','admin-login':'Login Admin'};
 const menu=[['home','▦','Beranda'],['catalog','▤','Katalog Kursus'],...(state.user?[['mine','▣','Kelas Saya']]:[]),...(admin()?[['admin','▥','Dashboard Admin']]:[])];
 $('#app').innerHTML='<div class="layout"><aside class="sidebar '+(state.menu?'open':'')+'"><div class="logo"><div class="logo-mark">🎓</div><div><b>E-COURSE ACADEMY</b><small>Platform Pembelajaran</small></div></div><div class="navlabel">MENU UTAMA</div>'+menu.map(([key,icon,name])=>'<button class="navbtn '+(state.view===key?'active':'')+'" data-go="'+key+'"><span style="font-size:20px">'+icon+'</span>'+name+'</button>').join('')+'<div class="sidebar-tip"><b>✨ Belajar tanpa batas</b><p>Video YouTube pilihan, kelas terstruktur, dan progres tersimpan online.</p></div></aside><main class="main"><header class="top"><div style="display:flex;gap:12px;align-items:center"><button class="mobilemenu" data-action="menu">☰</button><div><div class="crumb">Platform Pembelajaran / '+esc(names[state.view])+'</div><strong>Selamat datang di Academy 👋</strong></div></div><div class="topright">'+(state.user?'<span class="user-label">👤 '+esc(state.user.user_metadata?.full_name||state.user.email)+'</span><button class="btn secondary" data-action="logout">Keluar</button>':'<button class="btn secondary" data-go="login">Masuk</button><button class="btn" data-go="register">Daftar</button>')+'</div></header><div class="content">'+views[state.view]()+'</div></main></div>';
 if(state.view==='admin-login' || state.view==='login')$('#authForm').addEventListener('submit',e=>signIn(e,state.view==='admin-login'));
 if(state.view==='register')$('#authForm').addEventListener('submit',signUp);
 if(state.view==='editor')$('#courseForm').addEventListener('submit',saveCourse);
}
document.addEventListener('click',async e => {
 const t=e.target.closest('button,[data-course]');if(!t)return;
 if(t.dataset.go){go(t.dataset.go);if(t.dataset.go==='mine')await loadMine();if(t.dataset.go==='admin')await loadRequests();render();return;}
 if(t.dataset.course){await openCourse(t.dataset.course);return;}
 if(t.dataset.lesson!==undefined){state.index=Number(t.dataset.lesson);render();return;}
 if(t.dataset.category){state.filter=t.dataset.category;render();return;}
 if(t.dataset.edit){beginEdit(t.dataset.edit);return;}
 if(t.dataset.delete){await removeCourse(t.dataset.delete);return;}
 if(t.dataset.approve){await approve(t.dataset.approve);return;}
 switch(t.dataset.action){
 case 'enroll':await enroll();break;
 case 'complete':await completeLesson();break;
 case 'next':state.index=Math.min(state.index+1,state.lessons.length-1);render();break;
 case 'new':beginEdit();break;
 case 'add-lesson':addLesson();break;
 case 'logout':await signOut();break;
 case 'menu':state.menu=!state.menu;render();break;
 }
});
document.addEventListener('input',e=>{if(e.target.id==='searchBox'){state.query=e.target.value;const box=$('.content');box.innerHTML=catalog();const input=$('#searchBox');input.focus();input.setSelectionRange(input.value.length,input.value.length);}});
window.addEventListener('hashchange',()=>{const v=location.hash.slice(1);if(['home','catalog','mine','admin','login','register','admin-login'].includes(v)){state.view=v;render();}});
init();
