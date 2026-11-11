# E-COURSE ACADEMY

Vercel frontend + Supabase Auth + PostgreSQL (RLS). Target desain: 10.000 peserta, bukan jaminan kapasitas tanpa load test.

## Setup wajib
1. Buat **proyek Supabase baru khusus Academy**, jangan gunakan database proyek lain.
2. Jalankan file `supabase/schema.sql` di SQL Editor proyek baru. Pastikan tidak ada error.
3. Aktifkan Email Auth dan konfirmasi email di Supabase; atur Site URL ke domain Vercel final dan redirect URL yang dibutuhkan.
4. Di Vercel, tetapkan environment variables `SUPABASE_URL` (https://<project>.supabase.co) dan `SUPABASE_PUBLISHABLE_KEY` (kunci publishable publik). **Jangan memasukkan service_role, secret key, atau database password.**
5. Deploy repository. Periksa /api/config dan login peserta.
6. Buat tepat dua akun terverifikasi melalui Supabase Authentication -> Users (undang/buat secara aman), lalu ambil UUID masing-masing.
7. Sebagai pengelola database, jalankan:
```sql
insert into public.academy_admins(user_id,role) values
('UUID_SUPER_ADMIN','super_admin'),
('UUID_ADMIN_KEDUA','admin');
```
Unique role memastikan satu super_admin dan satu admin. Tidak tersedia pendaftaran admin publik.
8. Login administrator melalui `/admin/login`. Peserta melalui halaman Masuk/Daftar.

## Hak akses
- Pengunjung bisa membaca katalog terbit (judul dan deskripsi).
- Peserta baru harus daftar untuk mengikuti kursus. Kursus gratis otomatis disetujui; premium harus disetujui admin.
- Video hanya dapat dibaca pengguna yang sudah disetujui (dan admin) melalui kebijakan RLS.
- Admin dapat mengelola kursus, pelajaran, dan permintaan premium.
- Tabel admin hanya dapat diisi via jalur administrasi DB tepercaya, tidak oleh klien publik.

## Batasan dan keamanan
- Konfigurasi runtime dari `/api/config` hanya mengembalikan URL dan **publishable** key (keduanya memang boleh tersedia di browser).
- Autentikasi peserta dikelola Supabase; tidak ada kata sandi yang disimpan di localStorage aplikasi.
- Tidak ada integrasi pembayaran. Premium berarti permintaan + persetujuan manual.
- Video YouTube adalah konten eksternal; jika video/playlist dihapus atau menolak embed, pemutaran gagal. URL video di database bukan DRM.
- Kursus yang diedit mengganti daftar pelajaran dan dapat mereset progres. Cadangkan data sebelum mengubah kursus yang sudah dipakai.
- Target 10.000 peserta membutuhkan pemeriksaan kuota, index, biaya, rate limit email, dan pengujian beban.
- Koneksi Supabase belum otomatis dibuat. Tanpa environment variables, UI menampilkan pesan konfigurasi, bukan login palsu.
- Akun admin harus diprovisi dengan UUID nyata; jangan menaruh email/password admin di file proyek.


## Login dengan Google (OAuth) — peserta dan admin

Frontend memakai tombol Google (tidak lagi menggunakan form email/password):
- Peserta login: `https://guru-creator-academy.vercel.app/login`
- Peserta baru mendaftar: `https://guru-creator-academy.vercel.app/daftar`
- Admin: `https://guru-creator-academy.vercel.app/admin/login`

### Konfigurasi Google Cloud dan Supabase (wajib)
1. Di Google Cloud Console → Google Auth Platform, siapkan consent screen dan OAuth Client tipe **Web application**.
2. **Authorized redirect URI Google**: `https://zejbfnngfsrhvdkywpgv.supabase.co/auth/v1/callback`.
3. Di Supabase → Authentication → Providers → Google, aktifkan provider, masukkan OAuth Client ID dan **Client Secret** dari Google Cloud langsung di dashboard Supabase. **Jangan tempel Client Secret di GitHub, Vercel public env, atau chat.**
4. Supabase → Authentication → URL Configuration: set Site URL `https://guru-creator-academy.vercel.app`. Tambahkan URL Redirect yang diizinkan:
   - `https://guru-creator-academy.vercel.app/login`
   - `https://guru-creator-academy.vercel.app/admin/login`
5. Jalankan `supabase/schema.sql` di SQL Editor proyek yang sama. Kode frontend tetap membutuhkan tabel `academy_admins`, `academy_courses`, `academy_lessons`, `academy_enrollments`, dan `academy_progress`.
6. Untuk kedua administrator, minta keduanya masuk Google terlebih dahulu, ambil masing-masing UUID dari Supabase Authentication → Users, lalu masukkan ke tabel `academy_admins` sebagai `super_admin` dan `admin`. Hanya admin yang sudah ditetapkan boleh masuk ke dashboard admin. Link admin bukan pintu registrasi admin.
7. Jika sebelumnya ada akun email/password dengan email Google yang sama, verifikasi cara pengaitan identitas di Supabase Auth sebelum migrasi. Jangan menghapus akun untuk mencoba memperbaiki login.

**Status:** konfigurasi Google Provider dan pemasangan schema tidak dapat diverifikasi dari koneksi ini karena akses Supabase proyek tersebut belum diizinkan. Tombol Google hanya bisa digunakan setelah kedua konfigurasi selesai. Pembayaran premium tidak diaktifkan.
