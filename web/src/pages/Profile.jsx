import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../ctx.js';
import { useNav } from '../router.jsx';
import { Chip, Field, Icon } from '../ui.jsx';
import { currentSubscription, disablePush, enablePush, getTheme, isIOS, isStandalone, pushSupported, setTheme } from '../util.js';

function NameForm() {
  const { me, setMe } = useApp();
  const [name, setName] = useState(me.user.displayName);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const save = async (e) => {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      setMe(await api.patch('/me', { displayName: name }));
      setMsg('Tersimpan.');
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <form className="stack tight" onSubmit={save}>
      <Field id="displayName" label="Nama panggilan">
        <input id="displayName" type="text" maxLength={24} required value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="row">
        <button className="btn small" disabled={!name.trim() || name === me.user.displayName}>Simpan nama</button>
        {msg ? <span className="notice" role="status">{msg}</span> : null}
        {error ? <span className="error" role="alert">{error}</span> : null}
      </div>
    </form>
  );
}

function Notifications() {
  const { me, setMe } = useApp();
  const [pushOn, setPushOn] = useState(null);
  const [error, setError] = useState('');
  const supported = pushSupported();
  const needInstall = isIOS() && !isStandalone();

  useEffect(() => {
    if (!supported) return;
    currentSubscription()
      .then((s) => setPushOn(Boolean(s) && Notification.permission === 'granted'))
      .catch(() => setPushOn(false));
  }, [supported]);

  const togglePush = async () => {
    setError('');
    try {
      if (pushOn) await disablePush();
      else await enablePush();
      setPushOn(!pushOn);
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleEmail = async () => {
    setError('');
    try {
      setMe(await api.patch('/me', { emailNotify: !me.user.emailNotify }));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="stack tight">
      <div className="row between">
        <div className="grow">
          <strong>Notifikasi di HP ini</strong>
          <p className="small muted">
            {needInstall
              ? 'Di iPhone, pasang aplikasi ke layar utama dulu (lewat Safari).'
              : !supported
                ? 'Browser ini tidak mendukung notifikasi push.'
                : 'Bunyi dan angka di ikon kalau ada pesan baru.'}
          </p>
        </div>
        <button className="btn small" onClick={togglePush} disabled={!supported || needInstall || pushOn === null}>
          {pushOn ? 'Matikan' : 'Aktifkan'}
        </button>
      </div>
      <div className="row between">
        <div className="grow">
          <strong>Notifikasi email</strong>
          <p className="small muted">{me.emailEnabled ? `Dikirim ke ${me.user.email}.` : 'Pengirim email belum diatur di server, jadi belum ada yang terkirim.'}</p>
        </div>
        <button className="btn small" onClick={toggleEmail}>{me.user.emailNotify ? 'Matikan' : 'Aktifkan'}</button>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
    </div>
  );
}

function PasswordForm() {
  const [v, setV] = useState({ current: '', next: '' });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const save = async (e) => {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      await api.post('/me/password', v);
      setV({ current: '', next: '' });
      setMsg('Password diganti. Perangkat lain perlu masuk lagi.');
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <form className="stack tight" onSubmit={save}>
      <Field id="pw-current" label="Password sekarang">
        <input id="pw-current" type="password" autoComplete="current-password" required value={v.current} onChange={(e) => setV({ ...v, current: e.target.value })} />
      </Field>
      <Field id="pw-next" label="Password baru" help="Minimal 8 karakter.">
        <input id="pw-next" type="password" autoComplete="new-password" minLength={8} required value={v.next} onChange={(e) => setV({ ...v, next: e.target.value })} />
      </Field>
      <div className="row wrap">
        <button className="btn small">Ganti password</button>
        {msg ? <span className="notice" role="status">{msg}</span> : null}
        {error ? <span className="error" role="alert">{error}</span> : null}
      </div>
    </form>
  );
}

function JoinForm() {
  const { setMe } = useApp();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setMe(await api.post('/couple/join', { code }));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <form className="stack tight" onSubmit={submit} style={{ marginTop: 12 }}>
      <Field id="join-code" label="Atau isi kode dari pasanganmu" help="Dipakai kalau pasanganmu yang daftar duluan.">
        <input id="join-code" type="text" autoCapitalize="characters" autoCorrect="off" maxLength={12} required value={code} onChange={(e) => { setCode(e.target.value); setError(''); }} />
      </Field>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <button className="btn block" disabled={busy}>{busy ? 'Menyambungkan…' : 'Sambungkan'}</button>
    </form>
  );
}

export default function Profile() {
  const { me, setMe } = useApp();
  const nav = useNav();
  const [theme, setThemeState] = useState(getTheme());
  const { stats } = me;

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* tetap keluar di sisi ini */
    }
    setMe(null);
    nav('/', { replace: true });
  };

  return (
    <main className="screen">
      <h1>Profil</h1>
      <p className="muted">@{me.user.username}{me.partner ? `, berdua dengan ${me.partner.displayName}` : ''}</p>

      <section className="stack">
        <div className="row between">
          <h2>Pencapaian</h2>
          <Chip tone={stats.streak > 0 ? 'brass' : ''} icon="zap">{stats.streak} hari berturut-turut</Chip>
        </div>
        <p className="small muted">Streak naik tiap hari kamu mengirim atau membuka pesan. Terkirim {stats.sentCount}, dibuka {stats.openedCount}.</p>
        <div className="badges">
          {stats.badges.map((b) => (
            <div key={b.code} className={`badge ${b.earned ? '' : 'off'}`}>
              <Icon className="ico" name="award" size={22} />
              <strong>{b.name}</strong>
              <span className="tiny muted">{b.desc}</span>
            </div>
          ))}
        </div>
      </section>

      {!me.partner ? (
        <section className="card stack tight">
          <strong>Kode undangan kamu</strong>
          <p className="small muted">Kasih kode ini ke pasanganmu. Dia mengisinya saat daftar, atau di Profil kalau sudah punya akun.</p>
          <span className="code">{me.inviteCode}</span>
          <JoinForm />
        </section>
      ) : null}

      <section className="card stack"><h2>Nama</h2><NameForm /></section>
      <section className="card stack"><h2>Notifikasi</h2><Notifications /></section>

      <section className="card stack">
        <h2>Tampilan</h2>
        <div className="seg" role="group" aria-label="Tema">
          {[['auto', 'Ikuti HP'], ['light', 'Terang'], ['dark', 'Gelap']].map(([id, label]) => (
            <button
              key={id}
              aria-pressed={theme === id}
              onClick={() => {
                setTheme(id);
                setThemeState(id);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="card stack"><h2>Password</h2><PasswordForm /></section>

      <button className="btn danger block" onClick={logout}>Keluar</button>
    </main>
  );
}
