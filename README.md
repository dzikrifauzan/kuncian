# Kuncian

Kotak surat rahasia berdua. Kamu menulis pesan, memilih kunci, lalu pasanganmu harus memecahkannya dulu sebelum bisa membaca. Dia bisa membalas dengan cara yang sama.

Nama aplikasi bisa diganti lewat `APP_NAME` di `.env`.

## Cara kerja

**Kunci yang bisa dipilih per pesan** (boleh digabung, maksimal 6 kunci):

| Kunci | Cara membukanya |
|---|---|
| Pertanyaan | Jawab pertanyaan yang kamu tulis. Huruf besar dan tanda baca diabaikan. |
| Sandi huruf | Pesan diacak dengan sandi Vigenere. Penerima menebak kata kuncinya. |
| Tanggal | Terbuka otomatis di waktu yang kamu tentukan. Dicek server, jadi mengubah jam HP tidak berpengaruh. |
| Berantai | Terbuka setelah penerima membuka pesan lain yang kamu pilih. |

**Aturan gabungan:** `Semua harus` (semua kunci harus terbuka) atau `Salah satu` (satu kunci cukup).

**Percobaan:** tiap pesan punya batas percobaan salah (1 sampai 10). Kalau habis, pesan macet dan pengirim dikabari, lalu bisa menambah 3 kesempatan. Kunci pertanyaan dan sandi huruf bisa punya sampai 2 petunjuk yang dibuka satu per satu.

**Lainnya:** streak harian, lencana, buku sandi bersama, tarik pesan yang belum dibuka, notifikasi saat pesan baru, saat pesan dibuka, dan saat pesan berkunci tanggal sudah bisa dibuka.

**Keamanan pesan:** jawaban dan kata kunci hanya disimpan sebagai hash (scrypt). Isi pesan tidak dikirim ke penerima sebelum server memastikan kuncinya terpenuhi. Password di-hash dengan scrypt. Sesi lewat cookie `HttpOnly`. Notifikasi hanya berisi "ada pesan baru", tidak pernah isi pesannya.

## Pasang di VPS

Butuh Docker dengan Compose, dan Nginx yang sudah melayani HTTPS.

```bash
# 1. Taruh folder ini di VPS, lalu masuk ke dalamnya
cd kuncian

# 2. Isi pengaturan
cp .env.example .env
nano .env          # minimal: APP_URL (alamat https aplikasi) dan PORT

# 3. Jalankan
docker compose up -d --build

# 4. Cek
docker compose ps
docker compose logs -f kuncian
```

Container hanya membuka port di `127.0.0.1`. Tambahkan blok `location` dari `deploy/nginx.conf.example` ke server Nginx-mu, lalu:

```bash
nginx -t && systemctl reload nginx
```

Setelah itu buka `APP_URL`, daftar sebagai akun pertama, dan kamu dapat **kode undangan**. Kasih kode itu ke pasanganmu. Pasanganmu daftar lewat tab **Aku punya kode**. Siapa saja boleh daftar, tapi tiap kode cuma bisa dipakai 2 akun, jadi satu pasangan tidak bisa kemasukan orang ketiga. Batasi total akun lewat `MAX_USERS` kalau perlu.

**Penting di Nginx:** jalur `/api/events` harus `proxy_buffering off` (sudah ada di contoh). Kalau tidak, pesan baru baru muncul setelah beberapa saat.

## Pasang di iPhone

1. Buka alamat aplikasi di **Safari** (bukan Chrome).
2. Ketuk **Bagikan**, lalu **Tambah ke Layar Utama**.
3. Buka dari ikon di layar utama, lalu masuk. Login di Safari tidak ikut terbawa ke aplikasi yang dipasang, jadi perlu masuk sekali lagi.
4. Di Profil, ketuk **Aktifkan** pada Notifikasi dan izinkan.

Syarat: iOS 16.4 atau lebih baru. Notifikasi push di iPhone hanya jalan kalau aplikasi dipasang ke layar utama. Kalau belum dipasang, aplikasi menampilkan panduan ini, dan notifikasi tetap bisa lewat email.

## Email (reset password dan cadangan notifikasi)

Isi `SMTP_*` dan `MAIL_FROM` di `.env`, lalu `docker compose up -d`. Pilihan SMTP yang punya paket gratis: Brevo, Resend, atau email domainmu sendiri. Untuk Gmail, pakai App Password.

Kalau SMTP belum diisi, aplikasi tetap jalan dan link reset password dicetak di log (`docker compose logs kuncian`).

## Lupa password dan perawatan

```bash
# lihat akun dan kode undangan
docker compose exec kuncian node src/cli.js list-users

# reset password langsung dari VPS (mengeluarkan semua sesi akun itu)
docker compose exec kuncian node src/cli.js reset-password <username> <passwordBaru>

# ganti email akun
docker compose exec kuncian node src/cli.js set-email <username> <email>
```

**Backup:** salinan database otomatis dibuat tiap hari di `/data/backups` (7 terakhir disimpan). Ambil ke VPS:

```bash
docker compose cp kuncian:/data/backups ./backups
```

**Pulihkan backup:**

```bash
docker compose stop
docker compose run --rm --no-deps --entrypoint sh kuncian -c "rm -f /data/kuncian.db-wal /data/kuncian.db-shm"
docker compose cp ./backups/kuncian-2026-10-10.db kuncian:/data/kuncian.db
docker compose start
```

**Update aplikasi:** timpa file proyek, lalu `docker compose up -d --build`. Data ada di volume `kuncian-data` dan tidak ikut terhapus.

## Struktur proyek

```
server/   Node.js murni (tanpa framework) + SQLite bawaan Node 22
  src/    index, routes, locks, notify, db, http, crypto, stats, cli
  scripts/smoke.mjs   uji alur dua akun terhadap server sungguhan
web/      React + esbuild (PWA: manifest, service worker, notifikasi push)
deploy/   contoh konfigurasi Nginx
```

Dependensi npm hanya `web-push` dan `nodemailer` di server, serta `react`, `react-dom`, dan `esbuild` untuk build frontend.

## Pengembangan lokal

Butuh Node 22.13 atau lebih baru. Pasang dependensi sekali saja:

```bash
cd web && npm install
cd ../server && npm install
```

**Mode dev** (dua terminal, biarkan keduanya jalan):

```bash
# terminal 1: bangun ulang frontend otomatis tiap file di web/src berubah
cd web && npm run dev

# terminal 2: jalankan server, restart otomatis tiap file di server/src berubah
cd server && npm run dev
```

Buka `http://localhost:3000`. Setelah mengubah kode frontend, tunggu tulisan "Build selesai" di terminal 1, lalu refresh browser. Data tersimpan di `server/data` (hapus folder itu untuk mulai dari nol).

**Tanpa mode dev** (build sekali lalu jalan): `cd web && npm run build`, lalu `cd server && npm start`.

**Uji backend:** `cd server && npm run smoke`.

## Catatan jujur

- SQLite yang dipakai adalah `node:sqlite` bawaan Node. Statusnya masih "experimental" di Node 22, jadi peringatannya disembunyikan lewat `--disable-warning`. API yang dipakai sederhana dan stabil, dan versi Node di Dockerfile terkunci ke seri 22.
- Backend diuji dengan `npm run smoke` (14 kelompok uji: pairing, kunci, percobaan, hint, kunci tanggal dan berantai, SSE, reset password, keamanan dasar), dan layar-layar utama diuji lewat browser headless di lebar HP. Pengiriman notifikasi push ke perangkat sungguhan, pengiriman email lewat SMTP asli, dan build Docker belum bisa diuji saat proyek ini dibuat. Hal pertama yang sebaiknya kamu coba setelah terpasang: Aktifkan notifikasi di HP, kirim satu pesan dari akun satunya, dan cek notifikasinya masuk.
- Pembatas percobaan login ada di memori server, jadi ter-reset saat container restart. Untuk dua pengguna ini cukup.
