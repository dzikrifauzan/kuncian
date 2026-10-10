import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../ctx.js';
import { Link, useNav } from '../router.jsx';
import { Chip, Icon, ScrambleText, useNow } from '../ui.jsx';
import { fmtDateTime, LOCK_LABEL, timeLeft } from '../util.js';

const LOCK_ICON = { question: 'help', cipher: 'type', date: 'calendar', chain: 'link' };

/** Satu kunci di sisi penerima. */
function LockCard({ msg, lock, onChanged }) {
  const now = useNow(1000);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  const attemptType = lock.type === 'question' || lock.type === 'cipher';
  const out = msg.attemptsLeft <= 0;

  const attempt = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.post(`/messages/${msg.id}/attempt`, { lockId: lock.id, answer });
      if (!r.correct) {
        setShake(true);
        setTimeout(() => setShake(false), 400);
        setError(r.attemptsLeft > 0 ? `Belum tepat. Sisa ${r.attemptsLeft} kesempatan.` : 'Belum tepat, dan kesempatanmu habis.');
        setAnswer('');
      }
      await onChanged();
    } catch (err) {
      setError(err.message);
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const hint = async () => {
    setError('');
    try {
      await api.post(`/messages/${msg.id}/hint`, { lockId: lock.id });
      await onChanged();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className={`lockcard ${lock.satisfied ? 'done' : ''} ${shake ? 'shake' : ''}`}>
      <div className="row between">
        <h3><Icon name={LOCK_ICON[lock.type]} size={18} /> Kunci: {LOCK_LABEL[lock.type]}</h3>
        {lock.satisfied ? <Chip tone="ok" icon="check">Terbuka</Chip> : null}
      </div>

      {lock.type === 'question' ? <p>{lock.question}</p> : null}
      {lock.type === 'cipher' ? (
        <>
          <p className="small muted">Pesannya diacak dengan sandi huruf. Tebak kata kuncinya.</p>
          <div className="cipher">{lock.cipherText}</div>
        </>
      ) : null}

      {lock.type === 'date' ? (
        lock.satisfied ? (
          <p className="small">Waktunya sudah tiba.</p>
        ) : (
          <>
            <p className="small muted">Baru bisa dibuka {fmtDateTime(lock.unlockAt)}.</p>
            <p className="countdown" aria-live="off">{timeLeft(lock.unlockAt, now)}</p>
          </>
        )
      ) : null}

      {lock.type === 'chain' ? (
        lock.satisfied ? (
          <p className="small">Pesan sebelumnya sudah kamu buka.</p>
        ) : (
          <>
            <p className="small muted">Buka dulu pesan sebelumnya.{lock.requires.note ? ` Petunjuk: ${lock.requires.note}` : ''}</p>
            <Link className="btn small" to={`/pesan/${lock.requires.messageId}`}>Ke pesan itu</Link>
          </>
        )
      ) : null}

      {attemptType && lock.hints.length ? (
        <div className="stack tight">
          {lock.hints.map((h, i) => <p key={i} className="hint">Petunjuk {i + 1}: {h}</p>)}
        </div>
      ) : null}

      {attemptType && !lock.satisfied ? (
        <form className="stack tight" onSubmit={attempt}>
          <input
            type="text"
            id={`answer-${lock.id}`}
            aria-label={lock.type === 'question' ? 'Jawabanmu' : 'Kata kunci sandi'}
            placeholder={lock.type === 'question' ? 'Jawabanmu' : 'Kata kuncinya'}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            value={answer}
            disabled={out}
            onChange={(e) => {
              setAnswer(e.target.value);
              setError('');
            }}
          />
          {error ? <p className="error" role="alert">{error}</p> : null}
          <div className="row wrap">
            <button className="btn primary grow" disabled={busy || out || !answer.trim()}>
              <Icon name="key" size={18} /> {busy ? 'Mengecek…' : 'Coba buka'}
            </button>
            {lock.hintsUsed < lock.hintsTotal ? (
              <button type="button" className="btn" onClick={hint}>Minta petunjuk ({lock.hintsUsed}/{lock.hintsTotal})</button>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}

function RecipientView({ msg, reload }) {
  const { refresh } = useApp();
  const [fresh, setFresh] = useState(null); // isi pesan yang baru saja dibuka (untuk animasi)
  const [animating, setAnimating] = useState(false);
  const [error, setError] = useState('');

  const open = async () => {
    setError('');
    try {
      const r = await api.post(`/messages/${msg.id}/open`);
      setFresh(r.body);
      setAnimating(true);
      await refresh();
    } catch (err) {
      setError(err.message);
      reload();
    }
  };

  const body = fresh ?? msg.body;

  return (
    <>
      <div className="row between wrap">
        <h1>Dari {msg.otherName}</h1>
        {msg.status === 'opened' || fresh ? <Chip tone="ok" icon="check">Dibuka</Chip> : <Chip tone={msg.status === 'ready' ? 'brass' : msg.status === 'jammed' ? 'bad' : 'info'}>{{ ready: 'Siap dibuka', jammed: 'Macet', locked: 'Terkunci' }[msg.status]}</Chip>}
      </div>
      <p className="small muted">Dikirim {fmtDateTime(msg.createdAt)}</p>

      {body ? (
        <div className="card">
          {fresh ? <ScrambleText text={body} onDone={() => setAnimating(false)} /> : <p className="msg-body">{body}</p>}
        </div>
      ) : msg.status === 'ready' ? (
        <div className="card ok stack">
          <strong>Semua kunci sudah terbuka</strong>
          <button className="btn primary block" onClick={open}><Icon name="unlock" size={18} /> Buka pesan</button>
          {error ? <p className="error" role="alert">{error}</p> : null}
        </div>
      ) : (
        <>
          <p className="small muted">{msg.locks.length > 1 ? (msg.mode === 'all' ? 'Semua kunci harus terbuka dulu.' : 'Cukup satu kunci yang terbuka.') : 'Pecahkan kuncinya untuk membaca pesan ini.'}</p>
          {msg.status === 'jammed' ? (
            <div className="card bad stack tight" role="alert">
              <strong>Kesempatan habis</strong>
              <p className="small">Pesannya macet. {msg.otherName} sudah dikabari, minta dia kasih kesempatan tambahan.</p>
            </div>
          ) : msg.hasAttemptLock ? (
            <p className="small">Sisa <strong>{msg.attemptsLeft}</strong> dari {msg.maxAttempts} kesempatan.</p>
          ) : null}
          {msg.locks.map((l) => <LockCard key={l.id} msg={msg} lock={l} onChanged={async () => { await reload(); await refresh(); }} />)}
        </>
      )}

      {body && !animating ? <Link className="btn block" to="/tulis"><Icon name="edit" size={18} /> Balas {msg.otherName}</Link> : null}
      <Link className="link small" to="/">Kembali ke beranda</Link>
    </>
  );
}

function SenderView({ msg, reload }) {
  const nav = useNav();
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [note, setNote] = useState('');
  const used = msg.maxAttempts - msg.attemptsLeft;

  const grant = async () => {
    setError('');
    try {
      await api.post(`/messages/${msg.id}/grant`, { extra: 3 });
      setNote('Ditambah 3 kesempatan. Pasanganmu sudah dikabari.');
      reload();
    } catch (err) {
      setError(err.message);
    }
  };
  const remove = async () => {
    try {
      await api.del(`/messages/${msg.id}`);
      nav('/?kotak=out', { replace: true });
    } catch (err) {
      setError(err.message);
      setConfirmDelete(false);
    }
  };

  return (
    <>
      <div className="row between wrap">
        <h1>Untuk {msg.otherName}</h1>
        <Chip tone={msg.status === 'opened' ? 'ok' : msg.status === 'jammed' ? 'bad' : ''}>{msg.status === 'opened' ? 'Dibuka' : msg.status === 'jammed' ? 'Macet' : 'Belum dibuka'}</Chip>
      </div>
      <p className="small muted">
        Dikirim {fmtDateTime(msg.createdAt)}
        {msg.openedAt ? `. Dibuka ${fmtDateTime(msg.openedAt)}.` : '.'}
      </p>

      <div className="card"><p className="msg-body">{msg.body}</p></div>

      <div className="card stack tight">
        <h3>Kuncinya</h3>
        <p className="small muted">{msg.locks.length > 1 ? (msg.mode === 'all' ? 'Semua kunci harus terbuka.' : 'Cukup satu kunci yang terbuka.') : 'Satu kunci.'}</p>
        {msg.locks.map((l) => (
          <div key={l.id} className="row between small">
            <span className="row"><Icon name={LOCK_ICON[l.type]} size={16} /> {LOCK_LABEL[l.type]}{l.question ? `: ${l.question}` : ''}{l.type === 'date' ? `: ${fmtDateTime(l.unlockAt)}` : ''}</span>
            {l.satisfied ? <Chip tone="ok" icon="check">Terbuka</Chip> : <Chip>Terkunci</Chip>}
          </div>
        ))}
        {msg.hasAttemptLock ? <p className="small muted">Percobaan salah: {used} dari {msg.maxAttempts}.</p> : null}
      </div>

      {msg.status === 'jammed' ? (
        <div className="card bad stack tight" role="alert">
          <strong>{msg.otherName} kehabisan kesempatan</strong>
          <p className="small">Mau kasih kesempatan tambahan?</p>
        </div>
      ) : null}

      {!msg.openedAt ? (
        <div className="stack tight">
          {msg.hasAttemptLock ? <button className="btn" onClick={grant}>Tambah 3 kesempatan</button> : null}
          {confirmDelete ? (
            <div className="row">
              <button className="btn danger grow" onClick={remove}>Ya, tarik pesan</button>
              <button className="btn grow" onClick={() => setConfirmDelete(false)}>Batal</button>
            </div>
          ) : (
            <button className="btn danger" onClick={() => setConfirmDelete(true)}><Icon name="trash" size={18} /> Tarik pesan</button>
          )}
        </div>
      ) : null}
      {note ? <p className="notice" role="status">{note}</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      <Link className="link small" to="/?kotak=out">Kembali ke pesan terkirim</Link>
    </>
  );
}

export default function Message({ id }) {
  const { tick } = useApp();
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setMsg(await api.get(`/messages/${id}`));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load, tick]);

  return (
    <main className="screen">
      {error && !msg ? (
        <>
          <h1>Pesan tidak ketemu</h1>
          <p className="muted">{error}</p>
          <Link className="btn" to="/">Ke beranda</Link>
        </>
      ) : !msg ? (
        <p className="muted" role="status">Memuat…</p>
      ) : msg.direction === 'in' ? (
        <RecipientView msg={msg} reload={load} />
      ) : (
        <SenderView msg={msg} reload={load} />
      )}
    </main>
  );
}
