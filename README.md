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
