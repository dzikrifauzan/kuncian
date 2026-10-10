import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../ctx.js';
import { Link, useNav } from '../router.jsx';
import { Field, Icon } from '../ui.jsx';
import { fmtShort, toLocalInput, vigenere } from '../util.js';

function LockOption({ icon, title, desc, on, onToggle, children }) {
  return (
    <div className={`opt ${on ? 'on' : ''}`}>
      <label>
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} />
        <Icon className="ico" name={icon} size={22} />
        <span className="grow">
          <strong>{title}</strong>
          <span className="small muted" style={{ display: 'block' }}>{desc}</span>
        </span>
      </label>
      {on ? <div className="panel">{children}</div> : null}
    </div>
  );
}

export default function Compose() {
  const { me } = useApp();
  const nav = useNav();
  const partner = me.partner;

  const [body, setBody] = useState('');
  const [q, setQ] = useState({ on: true, question: '', answer: '', h1: '', h2: '' });
  const [c, setC] = useState({ on: false, key: '', hint: '' });
  const [d, setD] = useState({ on: false, value: toLocalInput(new Date(Date.now() + 3600_000)) });
  const [ch, setCh] = useState({ on: false, ids: [], note: '' });
  const [mode, setMode] = useState('all');
  const [attempts, setAttempts] = useState(3);
  const [candidates, setCandidates] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/messages?box=out').then((r) => setCandidates(r.messages.filter((m) => !m.openedAt))).catch(() => setCandidates([]));
  }, []);

  if (!partner) {
    return (
      <main className="screen">
        <h1>Tulis pesan</h1>
        <div className="card stack tight">
          <strong>Pasanganmu belum gabung</strong>
          <p className="small muted">Pesan baru bisa dikirim setelah dia daftar. Kasih dia kode ini:</p>
          <span className="code">{me.inviteCode}</span>
        </div>
      </main>
    );
  }

  const lockCount = [q.on, c.on, d.on].filter(Boolean).length + (ch.on ? ch.ids.length : 0);
  const hasAttempt = q.on || c.on;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const locks = [];
    if (q.on) locks.push({ type: 'question', question: q.question, answer: q.answer, hints: [q.h1, q.h2].filter((h) => h.trim()) });
    if (c.on) locks.push({ type: 'cipher', key: c.key, hints: c.hint.trim() ? [c.hint] : [] });
    if (d.on) {
      const t = new Date(d.value);
      if (Number.isNaN(t.getTime())) return setError('Pilih tanggal dan jam bukanya.');
      locks.push({ type: 'date', unlockAt: t.toISOString() });
    }
    if (ch.on) {
      if (!ch.ids.length) return setError('Pilih pesan yang harus dibuka dulu untuk kunci berantai.');
      ch.ids.forEach((id) => locks.push({ type: 'chain', requiresMessageId: id, note: ch.note }));
    }
    if (!locks.length) return setError('Pilih minimal satu kunci.');

    setBusy(true);
    try {
      await api.post('/messages', { body, mode, maxAttempts: attempts, locks });
      nav('/?kotak=out');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const toggleChain = (id) => setCh((v) => ({ ...v, ids: v.ids.includes(id) ? v.ids.filter((x) => x !== id) : [...v.ids, id] }));

  return (
    <main className="screen">
      <h1>Tulis pesan</h1>
      <p className="muted">Untuk {partner.displayName}. Pesannya terkunci sampai dia memecahkan kuncinya.</p>

      <form className="stack" onSubmit={submit}>
        <Field id="body" label="Isi pesan" help={`${body.length} dari 2000 huruf`}>
          <textarea id="body" maxLength={2000} required value={body} onChange={(e) => setBody(e.target.value)} placeholder="Kangen kamu. Nanti malam kita makan bakso ya." />
        </Field>

        <h2>Pilih kunci</h2>

        <LockOption icon="help" title="Pertanyaan" desc="Jawabannya jadi kunci. Cuma kalian yang tahu." on={q.on} onToggle={(on) => setQ({ ...q, on })}>
          <Field id="q-question" label="Pertanyaan">
            <input id="q-question" type="text" maxLength={200} value={q.question} onChange={(e) => setQ({ ...q, question: e.target.value })} placeholder="Di mana kita pertama kali makan bareng?" />
          </Field>
          <Field id="q-answer" label="Jawaban" help="Huruf besar dan tanda baca diabaikan.">
            <input id="q-answer" type="text" autoCapitalize="none" value={q.answer} onChange={(e) => setQ({ ...q, answer: e.target.value })} placeholder="bakso pak slamet" />
          </Field>
          <Field id="q-h1" label="Petunjuk 1 (boleh kosong)">
            <input id="q-h1" type="text" maxLength={200} value={q.h1} onChange={(e) => setQ({ ...q, h1: e.target.value })} />
          </Field>
          <Field id="q-h2" label="Petunjuk 2 (boleh kosong)">
            <input id="q-h2" type="text" maxLength={200} value={q.h2} onChange={(e) => setQ({ ...q, h2: e.target.value })} />
          </Field>
        </LockOption>

        <LockOption icon="type" title="Sandi huruf" desc="Pesan diacak. Dia perlu kata kuncinya." on={c.on} onToggle={(on) => setC({ ...c, on })}>
          <Field id="c-key" label="Kata kunci" help="Huruf a sampai z saja, 2 sampai 20 huruf. Kasih tahu dia lewat cara lain.">
            <input id="c-key" type="text" autoCapitalize="none" autoCorrect="off" maxLength={20} value={c.key} onChange={(e) => setC({ ...c, key: e.target.value })} placeholder="cinta" />
          </Field>
          {body && c.key.replace(/[^a-z]/gi, '').length >= 2 ? (
            <div>
              <p className="tiny muted">Begini tampilan acaknya buat dia:</p>
              <div className="cipher">{vigenere(body.slice(0, 90), c.key)}{body.length > 90 ? '…' : ''}</div>
            </div>
          ) : null}
          <Field id="c-hint" label="Petunjuk (boleh kosong)">
            <input id="c-hint" type="text" maxLength={200} value={c.hint} onChange={(e) => setC({ ...c, hint: e.target.value })} placeholder="Lima huruf, dimulai c" />
          </Field>
        </LockOption>

        <LockOption icon="calendar" title="Tanggal" desc="Baru bisa dibuka di waktu tertentu." on={d.on} onToggle={(on) => setD({ ...d, on })}>
          <Field id="d-value" label="Bisa dibuka mulai">
            <input id="d-value" type="datetime-local" min={toLocalInput(new Date())} value={d.value} onChange={(e) => setD({ ...d, value: e.target.value })} />
          </Field>
        </LockOption>

        <LockOption icon="link" title="Berantai" desc="Dia harus membuka pesan lain dulu." on={ch.on} onToggle={(on) => setCh({ ...ch, on })}>
          {candidates === null ? (
            <p className="small muted">Memuat pesan…</p>
          ) : candidates.length === 0 ? (
            <p className="small muted">Belum ada pesan terkirim yang belum dibuka. Kirim pesan lain dulu, lalu kembali ke sini.</p>
          ) : (
            <div className="stack tight">
              <span className="small">Pilih pesan yang harus dibuka lebih dulu:</span>
              {candidates.map((m) => (
                <label key={m.id} className="row small" style={{ alignItems: 'flex-start' }}>
                  <input type="checkbox" style={{ width: 20, height: 20, accentColor: 'var(--brass)' }} checked={ch.ids.includes(m.id)} onChange={() => toggleChain(m.id)} />
                  <span>{fmtShort(m.createdAt)}: “{m.preview}”</span>
                </label>
              ))}
            </div>
          )}
          <Field id="ch-note" label="Petunjuk (boleh kosong)">
            <input id="ch-note" type="text" maxLength={200} value={ch.note} onChange={(e) => setCh({ ...ch, note: e.target.value })} placeholder="Kuncinya ada di pesan sebelumnya" />
          </Field>
        </LockOption>

        {lockCount > 1 ? (
          <div className="stack tight">
            <span className="label" style={{ fontWeight: 600, fontSize: 14 }}>Aturan kunci</span>
            <div className="seg" role="group" aria-label="Aturan kunci">
              <button type="button" aria-pressed={mode === 'all'} onClick={() => setMode('all')}>Semua harus</button>
              <button type="button" aria-pressed={mode === 'any'} onClick={() => setMode('any')}>Salah satu</button>
            </div>
            <span className="small muted">{mode === 'all' ? 'Semua kunci harus terbuka.' : 'Satu kunci yang terbuka sudah cukup.'}</span>
          </div>
        ) : null}

        {hasAttempt ? (
          <Field id="attempts" label="Batas percobaan salah" help="Kalau habis, pesannya macet sampai kamu kasih kesempatan tambahan.">
            <select id="attempts" value={attempts} onChange={(e) => setAttempts(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n} kali</option>)}
            </select>
          </Field>
        ) : null}

        {error ? <p className="error" role="alert">{error}</p> : null}
        <button className="btn primary block" disabled={busy}>
          <Icon name="send" size={18} /> {busy ? 'Mengirim…' : 'Kirim pesan terkunci'}
        </button>
        <Link className="link small" to="/">Batal</Link>
      </form>
    </main>
  );
}
