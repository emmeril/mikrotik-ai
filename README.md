# MikroTik AI Console

Dashboard open source berbasis Express.js, Alpine.js, dan Bootstrap untuk membantu pengguna mengelola MikroTik RouterOS 6/7. Setiap pengguna membuat akun, menyimpan router miliknya, lalu meminta Gemini menyusun rencana konfigurasi atau diagnostik. Rencana selalu ditampilkan untuk ditinjau sebelum diterapkan.

## Menjalankan

1. Jalankan `npm install`.
2. Salin `.env.example` menjadi `.env`.
3. Isi `GEMINI_API_KEY` dan buat `APP_SECRET` acak, misalnya dengan `openssl rand -hex 32`.
4. Jalankan `npm run dev`.
5. Buka `http://127.0.0.1:3000`, daftar, lalu tambahkan router.

Aktifkan layanan RouterOS `api-ssl` pada port 8729, lalu isi host, port, username, dan password pada dashboard. Opsi sertifikat self-signed tersedia untuk router dengan sertifikat yang belum dipercaya sistem. Koneksi API biasa pada port 8728 tersedia untuk jaringan uji yang terisolasi, tetapi lalu lintasnya tidak terenkripsi. Kunci Gemini hanya berada di server.

Untuk akses publik, atur `HOST=0.0.0.0`, gunakan reverse proxy HTTPS, dan ubah `COOKIE_SECURE=true`. Server dan router harus dapat saling terhubung pada port RouterOS API yang dipilih.

## Akun dan data

- Registrasi tersedia dari halaman awal. Password akun di-hash dengan scrypt.
- Data pengguna, sesi, dan router disimpan di SQLite pada `DATABASE_PATH`.
- Setiap query router dibatasi dengan ID pengguna yang sedang login.
- Sesi disimpan sebagai cookie `HttpOnly` dan token sesi di database hanya disimpan dalam bentuk hash.
- Rencana AI disimpan sementara selama 15 menit dan hanya dapat dibuka oleh pemiliknya.

## Router tersimpan

Isi nama profil lalu tekan `Simpan router`. Aplikasi menguji koneksi sebelum menyimpan dan profil akan muncul pada pilihan router milik akun tersebut. Password router dienkripsi dengan AES-256-GCM menggunakan kunci yang diturunkan dari `APP_SECRET`. API daftar router tidak pernah mengirim password kembali ke browser.

Simpan `APP_SECRET` di tempat aman dan gunakan nilai yang sama setiap kali aplikasi dijalankan. Jika nilai ini hilang atau berubah, password router yang sudah tersimpan tidak dapat dibuka.

## Konfigurasi lingkungan

| Variabel | Kegunaan |
| --- | --- |
| `HOST` | Alamat bind server. Gunakan `0.0.0.0` jika diakses melalui reverse proxy. |
| `PORT` | Port HTTP aplikasi. |
| `APP_SECRET` | Kunci utama untuk enkripsi kredensial router. Wajib diisi. |
| `COOKIE_SECURE` | Isi `true` saat aplikasi diakses melalui HTTPS. |
| `DATABASE_PATH` | Lokasi file SQLite. Bawaan `./data/mikrotik-ai.db`. |
| `GEMINI_API_KEY` | API key Gemini di sisi server. |
| `GEMINI_MODEL` | Model Gemini untuk structured output. |
| `GEMINI_FALLBACK_MODELS` | Daftar model cadangan dipisahkan koma ketika model utama sedang penuh. |

## Konfigurasi dan pemeriksaan sebelum eksekusi

Gemini dapat membuat action khusus untuk identity, DNS, alamat IP, static route, firewall, dan monitoring traffic. Action RouterOS umum memperluas dukungan ke DHCP, pool, bridge, VLAN, NAT, mangle, queue, routing, WireGuard, PPP profile, Netwatch, IPv6, dan menu konfigurasi lain yang menyediakan operasi API `add`, `set`, `remove`, `enable`, atau `disable`.

Saat membuat rencana, aplikasi membaca snapshot konfigurasi existing dan mengirim versi yang sudah disaring ke Gemini. Tepat sebelum eksekusi, aplikasi membaca snapshot baru lalu menjalankan dua lapis pemeriksaan:

1. Pemeriksaan lokal memastikan interface dan ID tersedia serta mendeteksi alamat IP atau route duplikat.
2. Gemini menilai konflik, urutan firewall, gateway, subnet, perubahan sejak rencana dibuat, dan risiko kehilangan akses.

Jika salah satu pemeriksaan gagal, tidak ada perintah yang dikirim. Reset, reboot, shutdown, perubahan user, script, scheduler, package, fetch, file, import, dan certificate selalu diblokir dari eksekusi otomatis.

Setiap aksi yang lolos diterapkan berurutan dan proses berhenti pada kesalahan pertama. Belum ada rollback otomatis. Pemeriksaan ini mengurangi risiko tetapi tidak dapat menjamin seluruh dampak jaringan. Tinjau perintah dan siapkan akses cadangan untuk perubahan jalur utama atau firewall.

AI memakai Gemini Generate Content API dengan structured output JSON. Model bawaan adalah `gemini-3.5-flash-lite` dan dapat diganti melalui `GEMINI_MODEL`. Formulir cepat tetap dapat digunakan tanpa kunci Gemini.
