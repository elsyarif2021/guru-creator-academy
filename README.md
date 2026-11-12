# Guru Creator Academy

Aplikasi kursus YouTube dengan Google Sign-In, Vercel Functions, dan Supabase PostgreSQL.

## Rute aplikasi

| Rute | Akses |
| --- | --- |
| `/`, `/#catalog` | Publik |
| `/login`, `/daftar` | Login dan pendaftaran peserta melalui Google |
| `/kelas-saya` | Peserta yang telah masuk |
| `/admin/login` | Halaman masuk administrator melalui Google |
| `/admin` | Akun dengan peran `super_admin` atau `admin` di `academy_admins` |

Vercel memverifikasi sesi Supabase di server sebelum menampilkan rute terlindungi. Supabase Row Level Security (RLS) mengatur akses katalog, pengelolaan kursus, persetujuan premium, dan progres. Pelajaran tersedia bagi peserta yang pendaftarannya telah disetujui. Video tetap tunduk pada izin penyematan dari YouTube.

## Menyiapkan deployment

1. Gunakan proyek Supabase Academy `zejbfnngfsrhvdkywpgv`. Skema dan kebijakan RLS disimpan di `supabase/schema.sql`.
2. Atur `SUPABASE_URL` dan `SUPABASE_PUBLISHABLE_KEY` di lingkungan Vercel. Kunci publishable digunakan oleh aplikasi browser dan server. Simpan kredensial pengelola serta secret OAuth di pengaturan penyedia masing-masing.
3. Di Supabase → Authentication → URL Configuration, gunakan Site URL `https://guru-creator-academy.vercel.app` dan tambahkan `https://guru-creator-academy.vercel.app/login` serta `https://guru-creator-academy.vercel.app/admin/login` ke Redirect URLs.
4. Di Google Auth Platform, OAuth Client harus bertipe **Web application**. Authorized redirect URI untuk Google adalah `https://zejbfnngfsrhvdkywpgv.supabase.co/auth/v1/callback`. Masukkan Client ID dan Client Secret di pengaturan Google Provider Supabase.
5. Gunakan `npm ci` dan `npm run build` untuk membangun aset statis. Vercel membangun aplikasi ke `dist/` dan menyediakan fungsi di `api/`. Periksa `/api/health`, lalu mulai login dari tombol Google di aplikasi agar alur PKCE selesai dalam browser yang sama.

## Menetapkan administrator

Masing-masing akun Google harus memiliki akun Supabase Auth terlebih dahulu. Setelah pengelola memastikan identitas dan UUID-nya, tetapkan peran melalui SQL Editor proyek Academy:

```sql
insert into public.academy_admins (user_id, role) values
  ('UUID_SUPER_ADMIN', 'super_admin'),
  ('UUID_ADMIN_KEDUA', 'admin');
```

Satu akun dapat ditetapkan per peran. Jika seorang admin sudah masuk sebelum perannya ditetapkan, buka kembali `/admin` untuk memuat ulang hak aksesnya.

## Migrasi data dari AppDeploy

Unduh arsip JSON melalui **Panel Administrator → Unduh data migrasi**. Jalankan perintah berikut secara lokal setelah email pemilik kursus terverifikasi dan peran admin sudah ditetapkan di Supabase.

```sh
umask 077
node scripts/prepare-appdeploy-import.mjs arsip.json admin@example.org > academy-import.sql
```

Jalankan SQL yang dihasilkan di SQL Editor proyek Supabase Academy. Impor mencocokkan pendaftaran dan progres dengan akun Supabase yang memiliki email terverifikasi. Gunakan ulang arsip yang sama setelah akun yang belum cocok menyelesaikan verifikasi. Impor ulang mempertahankan catatan yang telah ada di tujuan. Simpan arsip dan SQL secara privat karena memuat data peserta.
