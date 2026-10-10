import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../ctx.js';
import { Link, useNav, useSearch } from '../router.jsx';
import { Chip, Icon } from '../ui.jsx';
import { currentSubscription, enablePush, fmtDateTime, fmtShort, isIOS, isStandalone, lockSummary, pushSupported } from '../util.js';

const STATUS = {
  in: {
    locked: { icon: 'lock', tone: 'info', chip: ['info', 'Terkunci'] },
    ready: { icon: 'unlock', tone: 'ok', chip: ['brass', 'Siap dibuka'] },
    jammed: { icon: 'lock', tone: 'bad', chip: ['bad', 'Macet'] },
    opened: { icon: 'mail', tone: 'ok', chip: ['ok', 'Sudah dibuka'] },
  },
  out: {
    locked: { icon: 'send', tone: '', chip: ['', 'Belum dibuka'] },
    ready: { icon: 'send', tone: '', chip: ['', 'Belum dibuka'] },
    jammed: { icon: 'lock', tone: 'bad', chip: ['bad', 'Macet'] },
    opened: { icon: 'mail', tone: 'ok', chip: ['ok', 'Dibuka'] },
  },
};

function MessageRow({ m }) {
  const s = STATUS[m.direction][m.status];
  const waiting = m.status === 'locked' ? m.locks.find((l) => l.type === 'date' && !l.satisfied) : null;
  return (
    <Link className="env" to={`/pesan/${m.id}`}>
      <div className={`ico ${s.tone}`}><Icon name={s.icon} size={22} /></div>
      <div className="grow">
        <div className="title">{m.direction === 'in' ? `Dari ${m.otherName}` : `Untuk ${m.otherName}`}</div>
        <div className="sub">{lockSummary(m.locks, m.mode)}</div>
        {waiting ? <div className="sub">Terbuka {fmtDateTime(waiting.unlockAt)}</div> : null}
        {m.preview ? <div className="sub">“{m.preview}{m.preview.length >= 80 ? '…' : ''}”</div> : null}
      </div>
      <div className="side">
        <Chip tone={s.chip[0]}>{s.chip[1]}</Chip>
        <span className="tiny muted">{fmtShort(m.createdAt)}</span>
      </div>
    </Link>
  );
}

function PushPrompt() {
  const [state, setState] = useState('hidden');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isIOS() && !isStandalone()) {
      setState('install');
      return;
    }
    if (!pushSupported() || Notification.permission !== 'default') return;
    currentSubscription().then((sub) => {
      if (!sub) setState('ask');
    }).catch(() => {});
  }, []);

  if (state === 'hidden') return null;
  if (state === 'install') {
    return (
      <div className="card brass stack tight">
        <strong>Notifikasi di iPhone butuh aplikasi terpasang.</strong>
        <p className="small">Sekarang notifikasinya cuma lewat email. Pasang ke layar utama supaya ada bunyi dan angka di ikon.</p>
        <button
          className="btn small"
          onClick={() => {
            try {
              localStorage.removeItem('kuncian.skipInstall');
            } catch {
              /* abaikan */
            }
            location.reload();
          }}
        >
          Lihat caranya
        </button>
      </div>
    );
  }
  return (
    <div className="card brass stack tight">
      <strong>Mau dikabari kalau ada pesan baru?</strong>
      <p className="small">Notifikasi cuma bilang “ada pesan baru”, isinya tetap rahasia.</p>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <button
        className="btn primary small"
        onClick={async () => {
          try {
            await enablePush();
            setState('hidden');
          } catch (err) {
            setError(err.message);
          }
        }}
      >
        <Icon name="bell" size={16} /> Aktifkan notifikasi
      </button>
    </div>
  );
}

export default function Home() {
  const { me, tick, appName } = useApp();
  const nav = useNav();
  const box = useSearch().get('kotak') === 'out' ? 'out' : 'in';
  const [data, setData] = useState({ in: null, out: null });
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const [i, o] = await Promise.all([api.get('/messages?box=in'), api.get('/messages?box=out')]);
      setData({ in: i.messages, out: o.messages });
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load, tick]);

  const list = data[box];
  const partner = me.partner?.displayName;
  const waiting = me.unread;
  const streak = me.stats.streak;

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(me.inviteCode);
      setCopied(true);
    } catch {
      /* clipboard diblokir, kodenya tetap kelihatan */
    }
  };

  return (
    <main className="screen">
      <header className="hero">
        <div>
          <h1>Halo, {me.user.displayName}</h1>
          <p className="muted">{waiting > 0 ? `Ada ${waiting} pesan menunggu kamu` : `Belum ada pesan baru di ${appName}`}</p>
        </div>
        {streak > 0 ? <Chip tone="brass" icon="zap">{streak} hari</Chip> : null}
      </header>

      {!me.partner ? (
        <div className="card stack tight">
          <strong>Pasanganmu belum gabung</strong>
          <p className="small muted">Kasih kode ini ke dia, lalu minta dia daftar dengan kode itu.</p>
          <div className="row between">
            <span className="code">{me.inviteCode}</span>
            <button className="btn small" onClick={copyCode}><Icon name="copy" size={16} /> {copied ? 'Tersalin' : 'Salin'}</button>
          </div>
        </div>
      ) : null}

      <PushPrompt />

      <div className="seg" role="group" aria-label="Kotak pesan">
        <button aria-pressed={box === 'in'} onClick={() => nav('/', { replace: true })}>Masuk</button>
        <button aria-pressed={box === 'out'} onClick={() => nav('/?kotak=out', { replace: true })}>Terkirim</button>
      </div>

      {error ? <p className="error" role="alert">{error}</p> : null}

      <section aria-live="polite">
        {list === null ? (
          <p className="muted small">Memuat pesan…</p>
        ) : list.length === 0 ? (
          <div className="empty">
            {box === 'in' ? (
              <>
                <h3>Belum ada pesan buat kamu</h3>
                <p>Kalau {partner || 'pasanganmu'} kirim sesuatu, amplopnya muncul di sini.</p>
              </>
            ) : (
              <>
                <h3>Belum ada pesan terkirim</h3>
                <p>Tulis pesan terkunci pertamamu.</p>
                <p style={{ marginTop: 12 }}><Link className="btn primary" to="/tulis">Tulis pesan</Link></p>
              </>
            )}
          </div>
        ) : (
          list.map((m) => <MessageRow key={m.id} m={m} />)
        )}
      </section>
    </main>
  );
}
