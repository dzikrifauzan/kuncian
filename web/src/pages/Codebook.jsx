import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../ctx.js';
import { Field, Icon } from '../ui.jsx';
import { fmtShort } from '../util.js';

export default function Codebook() {
  const { tick } = useApp();
  const [entries, setEntries] = useState(null);
  const [term, setTerm] = useState('');
  const [meaning, setMeaning] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setEntries((await api.get('/codebook')).entries);
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load, tick]);

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/codebook', { term, meaning });
      setTerm('');
      setMeaning('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    try {
      await api.del(`/codebook/${id}`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <main className="screen">
      <h1>Buku sandi</h1>
      <p className="muted">Kamus rahasia kalian berdua: istilah, kode, dan candaan yang cuma kalian yang paham. Bisa jadi bahan kata kunci.</p>

      <form className="card stack" onSubmit={add}>
        <Field id="term" label="Istilah atau kode">
          <input id="term" type="text" maxLength={60} required value={term} onChange={(e) => setTerm(e.target.value)} placeholder="bakso" />
        </Field>
        <Field id="meaning" label="Artinya">
          <input id="meaning" type="text" maxLength={300} required value={meaning} onChange={(e) => setMeaning(e.target.value)} placeholder="kode untuk “kangen”" />
        </Field>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <button className="btn primary" disabled={busy}>Tambah ke buku sandi</button>
      </form>

      <details className="card soft">
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Cara kerja sandi huruf</summary>
        <div className="stack tight small" style={{ marginTop: 10 }}>
          <p>Sandi huruf memakai kata kunci. Tiap huruf pesan digeser sejauh urutan huruf kata kuncinya (a = 0, b = 1, dan seterusnya), dan kata kuncinya diulang sampai pesan habis.</p>
          <p>Contoh: pesan <strong>kangen</strong> dengan kata kunci <strong>ab</strong> menjadi <strong>kbnheo</strong>. Spasi, angka, dan tanda baca tidak berubah.</p>
          <p>Penerima cukup mengetik kata kuncinya. Kalau tebakannya benar, kunci terbuka.</p>
        </div>
      </details>

      <section>
        {entries === null ? (
          <p className="muted small">Memuat…</p>
        ) : entries.length === 0 ? (
          <div className="empty">
            <h3>Bukunya masih kosong</h3>
            <p>Tambahkan istilah pertama kalian di atas.</p>
          </div>
        ) : (
          <div className="stack">
            {entries.map((en) => (
              <div key={en.id} className="card row" style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <strong>{en.term}</strong>
                  <p className="small" style={{ overflowWrap: 'anywhere' }}>{en.meaning}</p>
                  <p className="tiny muted">{en.authorName}, {fmtShort(en.createdAt)}</p>
                </div>
                {en.mine ? (
                  <button className="btn ghost small" aria-label={`Hapus ${en.term}`} onClick={() => remove(en.id)}><Icon name="trash" size={18} /></button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
