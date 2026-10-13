import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { AppCtx } from './ctx.js';
import Codebook from './pages/Codebook.jsx';
import Compose from './pages/Compose.jsx';
import Home from './pages/Home.jsx';
import InstallGuide from './pages/Install.jsx';
import Message from './pages/Message.jsx';
import Profile from './pages/Profile.jsx';
import { Forgot, Login, Register, Reset, Verify } from './pages/Auth.jsx';
import { Link, matchPath, useLoc } from './router.jsx';
import { Icon } from './ui.jsx';
import { isIOS, isStandalone } from './util.js';

const TABS = [
  { to: '/', icon: 'home', label: 'Beranda' },
  { to: '/tulis', icon: 'edit', label: 'Tulis' },
  { to: '/sandi', icon: 'book', label: 'Sandi' },
  { to: '/profil', icon: 'user', label: 'Profil' },
];

function TabBar({ path, unread }) {
  return (
    <nav className="tabbar" aria-label="Menu utama">
      {TABS.map((t) => {
        const active = t.to === '/' ? path === '/' || path.startsWith('/pesan') : path.startsWith(t.to);
        return (
          <Link key={t.to} to={t.to} aria-current={active ? 'page' : undefined}>
            <Icon name={t.icon} size={22} />
            {t.label}
            {t.to === '/' && unread > 0 ? <span className="dot">{unread > 9 ? '9+' : unread}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

function VerifyBanner({ email }) {
  const [state, setState] = useState('idle');
  const resend = async () => {
    setState('busy');
    try {
      await api.post('/auth/resend-verification');
      setState('sent');
    } catch {
      setState('error');
    }
  };
  return (
    <div className="notice verify-banner" role="status">
      <strong>Email belum diverifikasi.</strong> Kami kirim link ke {email}. Cek inbox dan folder spam.{' '}
      {state === 'sent' ? (
        <span>Link baru sudah dikirim.</span>
      ) : (
        <button type="button" className="link" onClick={resend} disabled={state === 'busy'}>
          {state === 'busy' ? 'Mengirim…' : state === 'error' ? 'Gagal, coba lagi' : 'Kirim ulang'}
        </button>
      )}
    </div>
  );
}

export default function App() {
  const { path } = useLoc();
  const [pub, setPub] = useState(null);
  const [me, setMe] = useState(undefined); // undefined = memuat, null = belum masuk
  const [tick, setTick] = useState(0);
  const [skipInstall, setSkipInstall] = useState(() => {
    try {
      return localStorage.getItem('kuncian.skipInstall') === '1';
    } catch {
      return false;
    }
  });

  const refresh = useCallback(async () => {
    try {
      setMe(await api.get('/me'));
    } catch (err) {
      if (err.status === 401) setMe(null);
    }
  }, []);

  useEffect(() => {
    api.get('/public').then(setPub).catch(() => setPub({ appName: 'Kuncian', registrationOpen: true }));
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onUnauth = () => setMe(null);
    window.addEventListener('kuncian:unauth', onUnauth);
    return () => window.removeEventListener('kuncian:unauth', onUnauth);
  }, []);

  useEffect(() => {
    if (pub) document.title = pub.appName;
  }, [pub]);

  // Pembaruan langsung (SSE), ditambah cek berkala dan saat aplikasi dibuka lagi.
  const loggedIn = Boolean(me);
  useEffect(() => {
    if (!loggedIn) return undefined;
    let es;
    try {
      es = new EventSource('/api/events');
      es.addEventListener('refresh', () => setTick((t) => t + 1));
    } catch {
      /* SSE tidak tersedia, cek berkala tetap jalan */
    }
    const timer = setInterval(() => setTick((t) => t + 1), 30_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') setTick((t) => t + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      es?.close();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loggedIn]);

  useEffect(() => {
    if (tick > 0) refresh();
  }, [tick, refresh]);

  const unread = me?.unread ?? 0;
  useEffect(() => {
    if (me === undefined || me === null) return;
    try {
      if (unread > 0) navigator.setAppBadge?.(unread);
      else navigator.clearAppBadge?.();
    } catch {
      /* badge tidak didukung */
    }
  }, [unread, me]);

  const ctx = useMemo(() => ({ me, pub, tick, refresh, setMe, appName: pub?.appName || 'Kuncian' }), [me, pub, tick, refresh]);

  if (isIOS() && !isStandalone() && !skipInstall) {
    return (
      <InstallGuide
        appName={pub?.appName || 'Kuncian'}
        onSkip={() => {
          try {
            localStorage.setItem('kuncian.skipInstall', '1');
          } catch {
            /* abaikan */
          }
          setSkipInstall(true);
        }}
      />
    );
  }

  if (me === undefined || !pub) {
    return (
      <div className="screen auth">
        <p className="muted" role="status">Memuat…</p>
      </div>
    );
  }

  if (!me) {
    let page = <Login />;
    if (path === '/daftar') page = <Register />;
    else if (path === '/lupa') page = <Forgot />;
    else if (path === '/reset') page = <Reset />;
    else if (path === '/verifikasi') page = <Verify />;
    return <AppCtx.Provider value={ctx}>{page}</AppCtx.Provider>;
  }

  const msg = matchPath('/pesan/:id', path);
  let page = <Home />;
  if (path === '/verifikasi') page = <Verify />;
  else if (msg) page = <Message key={msg.id} id={msg.id} />;
  else if (path === '/tulis') page = <Compose />;
  else if (path === '/sandi') page = <Codebook />;
  else if (path === '/profil') page = <Profile />;

  return (
    <AppCtx.Provider value={ctx}>
      {me.user.emailVerified || path === '/verifikasi' ? null : <VerifyBanner email={me.user.email} />}
      {page}
      <TabBar path={path} unread={unread} />
    </AppCtx.Provider>
  );
}
