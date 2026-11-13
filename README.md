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

Satu Super Admin dan dua Admin ditetapkan untuk Academy. Jika seorang admin sudah masuk sebelum perannya ditetapkan, buka kembali `/admin` untuk memuat ulang hak aksesnya.

## Migrasi data dari AppDeploy

Unduh arsip JSON melalui **Panel Administrator → Unduh data migrasi**. Jalankan perintah berikut secara lokal setelah email pemilik kursus terverifikasi dan peran admin sudah ditetapkan di Supabase.

```sh
umask 077
node scripts/prepare-appdeploy-import.mjs arsip.json admin@example.org > academy-import.sql
```

Jalankan SQL yang dihasilkan di SQL Editor proyek Supabase Academy. Impor mencocokkan pendaftaran dan progres dengan akun Supabase yang memiliki email terverifikasi. Gunakan ulang arsip yang sama setelah akun yang belum cocok menyelesaikan verifikasi. Impor ulang mempertahankan catatan yang telah ada di tujuan. Simpan arsip dan SQL secara privat karena memuat data peserta.

## Perbaikan integrasi autentikasi

Frontend dan halaman terlindungi memakai pemeriksaan sesi server yang sama:

1. Browser menuntaskan Google OAuth PKCE dan menulis cookie Supabase.
2. Browser memperbarui cookie bila token kedaluwarsa, lalu meminta `GET /api/session` dengan cookie origin yang sama.
3. Backend memverifikasi identitas dengan Supabase Auth `getUser()`, lalu membaca peran dari `academy_admins` menggunakan sesi pengguna tersebut. Tidak ada `service_role` atau secret key di browser, dan metadata yang dapat diedit pengguna tidak memberikan hak admin.
4. `/kelas-saya`, `/admin`, dan API sesi menggunakan pemeriksaan yang sama. Query kursus, pendaftaran dan progres tetap dibatasi oleh RLS Supabase menggunakan JWT pengguna.
5. Cookie hasil refresh diteruskan ke respons server. Respons autentikasi tidak boleh di-cache. Logout dan pergantian akun menghapus state privat, termasuk membuang hasil query lama yang belum selesai.

`GET /api/session` mengembalikan `200` beserta identitas ringkas/peran bila valid, `401` bila belum masuk, atau `503` bila konfigurasi, Auth, maupun database tidak dapat diverifikasi. Tidak ada access token/refresh token dalam respons API ini. Metode selain GET ditolak.

`SUPABASE_ANON_KEY` dapat dipakai sebagai fallback untuk proyek yang masih menggunakan kunci anon JWT. Semua endpoint konfigurasi, sesi, halaman terlindungi, dan health membaca konfigurasi yang sama; kunci secret/service_role ditolak oleh endpoint publik.

### Mengatasi error Google yang terkonfirmasi

Pada pemeriksaan browser, Google mengembalikan **Error 400: `redirect_uri_mismatch`**. Katalog dan Auth settings tersedia, tetapi hal itu belum membuktikan Google OAuth berhasil.

Di **Google Cloud Console → Google Auth Platform → Clients**, pilih **OAuth Client Web application yang Client ID-nya sama dengan konfigurasi Google Provider di Supabase**. Pada **Authorized redirect URIs**, tambahkan persis:

```text
https://zejbfnngfsrhvdkywpgv.supabase.co/auth/v1/callback
```

Alamat tersebut adalah callback Google ke Supabase. `/login` dan `/admin/login` milik Vercel masuk ke **Redirect URLs di Supabase**, bukan menjadi pengganti callback Google. Pada Supabase, daftarkan alamat login untuk setiap domain Vercel yang benar-benar digunakan. Mulai ulang login dari tombol Google pada browser dan domain yang sama setelah perubahan tersimpan. Jangan mengirim Client Secret atau password melalui chat/repository.

Pengaturan Google Cloud tidak dapat diubah melalui koneksi tools pada sesi perbaikan ini; pengelola OAuth Client perlu menyimpan URI tersebut. Mengaktifkan fitur Supabase **OAuth Server** tidak memperbaiki Google social login; aplikasi ini menggunakan Google Provider Supabase.

Sesudah login pertama berhasil, barulah UUID akun tersedia untuk penetapan administrator. Jangan menunjuk akun peserta secara otomatis menjadi admin dan jangan mematikan RLS. Saat pemeriksaan awal, `auth.users` dan `academy_admins` masih kosong.

### Pengujian

- `npm ci && npm test && npm run build` — 14 pengujian sesi/config/frontend-backend, termasuk refresh cookie kedaluwarsa dan cookie terpotong menjadi beberapa chunk.
- `npm run build`, lalu `python3 tests/run-browser.py` — membutuhkan Python Playwright dan Chromium pada `/usr/bin/chromium`. Harness lokal memakai respons Supabase sintetis, bukan akun sungguhan. Tujuh skenario browser mencakup pengunjung anonim, callback PKCE peserta, penolakan admin, logout, callback admin, kode OAuth tidak valid, serta pemulihan setelah backend gagal.
- `tests/rls.sql` — uji database sebagai pemilik database pada sesi tepercaya. Fixture disisipkan dalam transaksi dan seluruhnya di-rollback. Memeriksa akses pelajaran peserta yang disetujui, pemisahan enrollment/progres, penolakan self-approval premium/admin, serta persetujuan oleh admin. File ini sudah dijalankan dan lulus pada database Academy dalam sesi perbaikan.

Build, 14 pengujian Node, tujuh skenario browser lokal dan uji RLS database asli lulus. Pengujian Google dengan akun sungguhan belum selesai karena redirect URI Google masih perlu diperbaiki oleh pengelola. Tidak ada akun uji permanen yang dibuat dan tidak ada skema/data produksi yang diubah oleh pengujian transaksi.

## Dashboard dan riwayat belajar

Terapkan migrasi `supabase/migrations/20261113095000_academy_dashboard.sql` sebelum
mengaktifkan build baru. Migrasi menambahkan laporan pendaftaran dan penyelesaian
pelajaran dengan akses sesuai RLS. Edit kursus menyimpan perubahan dalam satu
transaksi dan mengarsipkan pelajaran yang dikeluarkan dari daftar aktif agar
rekaman progres lama tetap tersimpan.

Panel Status Integrasi tersedia di halaman masuk dan dashboard admin. Pemeriksaan
awal OAuth memakai URL produksi Vercel dan menunjukkan respons pengalihan
Supabase. Uji login lengkap secara terpisah dengan akun peserta, Super Admin,
dan Admin, termasuk membuka kembali kursus untuk memastikan progres tersimpan.

Pemeriksaan lanjutan menggunakan data sementara di transaksi database. Status akun nyata dan login Google harus diperiksa terpisah. Uji browser lokal pada lingkungan saat ini terhalang izin socket Chromium.
