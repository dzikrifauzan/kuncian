import { Brand, Icon } from '../ui.jsx';
import { isSafariIOS } from '../util.js';

/** Di iPhone, notifikasi push hanya jalan kalau aplikasi dipasang ke layar utama lewat Safari. */
export default function InstallGuide({ appName, onSkip }) {
  const safari = isSafariIOS();
  return (
    <main className="screen auth">
      <Brand name={appName} />
      <h1>Pasang dulu ke layar utama</h1>
      <p className="muted">
        Di iPhone, notifikasi pesan baru cuma bisa masuk kalau {appName} dipasang seperti aplikasi biasa. Cuma butuh semenit.
      </p>

      {!safari ? (
        <div className="card brass">
          <p><strong>Buka halaman ini di Safari dulu.</strong> Di iPhone, hanya Safari yang bisa memasang aplikasi ke layar utama. Salin alamat halaman ini, lalu tempel di Safari.</p>
        </div>
      ) : null}

      <ol className="steps card">
        <li><span>Ketuk tombol <strong>Bagikan</strong> <Icon className="inline-ico" name="share" size={20} /> di bagian bawah Safari.</span></li>
        <li><span>Gulir, lalu pilih <strong>Tambah ke Layar Utama</strong> <Icon className="inline-ico" name="plusSquare" size={20} />.</span></li>
        <li><span>Ketuk <strong>Tambah</strong>, lalu buka {appName} dari ikon di layar utama.</span></li>
        <li><span>Masuk atau daftar di aplikasi yang baru dibuka. Login di Safari tidak ikut terbawa, jadi perlu masuk sekali lagi.</span></li>
      </ol>

      <p className="small muted">Butuh iOS 16.4 atau lebih baru. Cek di Pengaturan, Umum, Info.</p>
      <button className="btn block" onClick={onSkip}>Lewati dulu, pakai lewat Safari</button>
      <p className="tiny muted">Kalau dilewati, kamu tetap bisa pakai, tapi notifikasinya cuma lewat email.</p>
    </main>
  );
}
