import { useState } from "react";
import { api } from "../api.js";
import { useApp } from "../ctx.js";
import { Link, useNav, useSearch } from "../router.jsx";
import { Brand, Field } from "../ui.jsx";

function useForm(initial) {
  const [values, setValues] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const bind = (name) => ({
    id: `f-${name}`,
    value: values[name],
    onChange: (e) => {
      setValues((v) => ({ ...v, [name]: e.target.value }));
      setError("");
    },
  });
  const run = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn(values);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return { values, bind, error, setError, busy, run };
}

export function Login() {
  const { setMe, pub, appName } = useApp();
  const nav = useNav();
  const f = useForm({ username: "", password: "" });

  const submit = (e) => {
    e.preventDefault();
    f.run(async (v) => {
      setMe(await api.post("/auth/login", v));
      nav("/", { replace: true });
    });
  };

  return (
    <main className="screen auth">
      <Brand name={appName} />
      <p className="muted">Kotak surat rahasia berdua. Masuk dulu ya.</p>
      <form className="stack" onSubmit={submit}>
        <Field id="f-username" label="Username atau email">
          <input
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            required
            {...f.bind("username")}
          />
        </Field>
        <Field id="f-password" label="Password">
          <input
            type="password"
            autoComplete="current-password"
            required
            {...f.bind("password")}
          />
        </Field>
        {f.error ? (
          <p className="error" role="alert">
            {f.error}
          </p>
        ) : null}
        <button className="btn primary block" disabled={f.busy}>
          {f.busy ? "Masuk…" : "Masuk"}
        </button>
      </form>
      <div className="row between small">
        <Link className="link" to="/lupa">
          Lupa password?
        </Link>
      </div>
      {pub.registrationOpen ? (
        <Link className="btn block" to="/daftar">
          Belum punya akun? Daftar
        </Link>
      ) : null}
    </main>
  );
}

export function Register() {
  const { setMe, pub, appName } = useApp();
  const nav = useNav();
  const f = useForm({
    displayName: "",
    username: "",
    email: "",
    password: "",
    inviteCode: "",
  });

  const submit = (e) => {
    e.preventDefault();
    f.run(async (v) => {
      setMe(await api.post("/auth/register", v));
      nav("/", { replace: true });
    });
  };

  if (!pub.registrationOpen) {
    return (
      <main className="screen auth">
        <Brand name={appName} />
        <h1>Pendaftaran sudah ditutup</h1>
        <p className="muted">Aplikasi ini sedang tidak menerima akun baru.</p>
        <Link className="btn block" to="/">
          Kembali ke halaman masuk
        </Link>
      </main>
    );
  }

  return (
    <main className="screen auth">
      <Brand name={appName} />
      <h1>Bikin akun</h1>
      <p className="muted">
        Kalau pasanganmu sudah daftar duluan, isi kode undangannya. Kalau belum,
        kosongkan saja.
      </p>
      <form className="stack" onSubmit={submit}>
        <Field
          id="f-displayName"
          label="Nama panggilan"
          help="Ini yang tampil di pesan dan notifikasi."
        >
          <input
            type="text"
            autoComplete="nickname"
            maxLength={24}
            required
            {...f.bind("displayName")}
          />
        </Field>
        <Field
          id="f-username"
          label="Username"
          help="Huruf kecil, angka, titik, atau garis bawah."
        >
          <input
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            maxLength={24}
            required
            {...f.bind("username")}
          />
        </Field>
        <Field
          id="f-email"
          label="Email"
          help="Dipakai untuk reset password dan pemberitahuan."
        >
          <input
            type="email"
            autoComplete="email"
            required
            {...f.bind("email")}
          />
        </Field>
        <Field id="f-password" label="Password" help="Minimal 8 karakter.">
          <input
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            {...f.bind("password")}
          />
        </Field>
        <Field
          id="f-inviteCode"
          label="Kode undangan (opsional)"
          help="Kosongkan kalau kamu yang daftar duluan. Kamu akan dapat kode untuk dikasih ke pasanganmu."
        >
          <input
            type="text"
            autoCapitalize="characters"
            autoCorrect="off"
            maxLength={12}
            {...f.bind("inviteCode")}
          />
        </Field>
        {f.error ? (
          <p className="error" role="alert">
            {f.error}
          </p>
        ) : null}
        <button className="btn primary block" disabled={f.busy}>
          {f.busy ? "Mendaftar…" : "Daftar"}
        </button>
      </form>
      <p className="small muted">
        Sudah punya akun?{" "}
        <Link className="link" to="/">
          Masuk
        </Link>
      </p>
    </main>
  );
}

export function Forgot() {
  const { appName } = useApp();
  const f = useForm({ identifier: "" });
  const [sent, setSent] = useState(false);

  const submit = (e) => {
    e.preventDefault();
    f.run(async (v) => {
      await api.post("/auth/forgot", v);
      setSent(true);
    });
  };

  return (
    <main className="screen auth">
      <Brand name={appName} />
      <h1>Lupa password</h1>
      {sent ? (
        <>
          <p className="notice" role="status">
            Kalau akunnya ada, link reset sudah dikirim ke emailnya. Link
            berlaku 1 jam.
          </p>
          <p className="small muted">Belum masuk juga? Cek folder spam.</p>
        </>
      ) : (
        <form className="stack" onSubmit={submit}>
          <Field id="f-identifier" label="Username atau email">
            <input
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              required
              {...f.bind("identifier")}
            />
          </Field>
          {f.error ? (
            <p className="error" role="alert">
              {f.error}
            </p>
          ) : null}
          <button className="btn primary block" disabled={f.busy}>
            {f.busy ? "Mengirim…" : "Kirim link reset"}
          </button>
        </form>
      )}
      <Link className="link small" to="/">
        Kembali ke halaman masuk
      </Link>
    </main>
  );
}

export function Reset() {
  const { appName } = useApp();
  const token = useSearch().get("token") || "";
  const f = useForm({ password: "", again: "" });
  const [done, setDone] = useState(false);

  const submit = (e) => {
    e.preventDefault();
    f.run(async (v) => {
      if (v.password !== v.again) throw new Error("Kedua password belum sama.");
      await api.post("/auth/reset", { token, password: v.password });
      setDone(true);
    });
  };

  return (
    <main className="screen auth">
      <Brand name={appName} />
      <h1>Password baru</h1>
      {done ? (
        <>
          <p className="notice" role="status">
            Password sudah diganti. Silakan masuk.
          </p>
          <Link className="btn primary block" to="/">
            Masuk
          </Link>
        </>
      ) : (
        <form className="stack" onSubmit={submit}>
          <Field
            id="f-password"
            label="Password baru"
            help="Minimal 8 karakter."
          >
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              {...f.bind("password")}
            />
          </Field>
          <Field id="f-again" label="Ulangi password baru">
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              {...f.bind("again")}
            />
          </Field>
          {f.error ? (
            <p className="error" role="alert">
              {f.error}
            </p>
          ) : null}
          <button className="btn primary block" disabled={f.busy}>
            {f.busy ? "Menyimpan…" : "Simpan password"}
          </button>
        </form>
      )}
    </main>
  );
}
