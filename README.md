# BERBAGI RAHMAT E-COURSE ACADEMY — Vercel Frontend

## Deploy ke Vercel
1. Ekstrak ZIP ini.
2. Unggah seluruh isi folder ke repository GitHub baru.
3. Di https://vercel.com/new, pilih repository tersebut dan klik Deploy.
4. Framework Preset: Other; build command kosong; output directory `.`.

## Fitur
- Beranda responsif, katalog dengan pencarian dan kategori
- YouTube embed berdasarkan URL video
- Pengelolaan kursus: tambah, edit, hapus
- Kelas gratis dan simulasi pengajuan premium
- Kelas Saya dan penyimpanan progres

## Penting: Mode frontend mandiri
- Ini adalah frontend **demo fungsional**: data disimpan di localStorage pada masing-masing browser.
- Pemilihan mode Pengajar/Peserta adalah simulasi, **bukan login aman**.
- Kursus tidak tersinkron antar perangkat, premium belum diproteksi pada server, dan belum ada pembayaran.
- Untuk produksi, sambungkan Supabase/Firebase/layanan backend dengan autentikasi, database, RLS dan payment gateway. Jangan menjual kelas premium sebelum akses dijaga pada server.
- Playlist YouTube perlu dipecah menjadi video individual; pemutaran tergantung izin embed pemilik video.
