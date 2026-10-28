# Rencana Memecah `app.js` Menjadi ES Modules

## Ringkasan

Pecah `static/js/app.js` menjadi modul JavaScript native browser tanpa bundler. Tiap modul menangani satu kelompok fungsi, sementara satu entry point menginisialisasi aplikasi. Router menghubungkan navigasi, event halaman, dan pemuatan data.

## Pembagian modul

- `core/utils.js`: format angka/byte/uptime, `fetchAPI`, escaping HTML, status koneksi, dan error.
- `core/sidebar.js`: inisialisasi sidebar desktop/mobile dan penyimpanan status collapse.
- `core/router.js`: judul dan pemetaan halaman, navigasi hash, pemuatan template, binding event halaman, serta dispatch loader.
- `pages/dashboard.js`: pemuatan dan render ringkasan, stream, sesi, dan status server.
- `pages/paths.js`: halaman Paths dan Configuration Paths, modal tambah/edit, CRUD path, pencarian, dan refresh.
- `pages/config.js`: muat/simpan/reset konfigurasi Global dan Path Defaults.
- `pages/runtime.js`: koneksi/sesi HLS, RTSP, RTMP, runtime logs, dan aksi kick session.
- `app.js`: entry point untuk bootstrap sidebar/router, tombol refresh global, auto-refresh, dan cleanup.

Ubah tag script di `index.html` menjadi `type="module"`. Gunakan `import`/`export` eksplisit: modul halaman mengekspor loader dan binder event; router memilih modul berdasarkan page ID. Tidak perlu bundler atau proses build.

## Perubahan antarmuka internal

- Hilangkan ketergantungan pada fungsi lintas-file di global scope; impor fungsi dan state bersama secara eksplisit.
- Ganti `onclick` inline yang dibuat saat render tabel dengan atribut `data-action` dan event delegation pada modul pemilik fitur: dashboard/runtime untuk sesi, paths untuk path.
- Pertahankan route hash, endpoint, payload API, dan perilaku UI yang ada.

## Verifikasi

- Semua halaman dapat dibuka lewat hash dan navigasi Back/Forward tetap berfungsi.
- Modul berhasil dimuat oleh `/static` tanpa 404, kesalahan MIME type, atau error JavaScript.
- Periksa pencarian, refresh, CRUD path, modal, simpan/reset konfigurasi, kick session, filter log, serta auto-refresh.
- Pastikan status loading, error, dan empty state tetap tampil sesuai kondisi API.

## Asumsi

- Browser target mendukung ES Modules dan FastAPI tetap menyajikan aset dari `/static`.
- `paths.js` menangani halaman Paths dan Configuration Paths karena keduanya berbagi modal serta alur CRUD path.
- Pemecahan ini mempertahankan fitur dan kontrak API saat ini; perubahan fungsi produk berada di luar cakupan.
