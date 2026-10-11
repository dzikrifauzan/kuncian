import { config, smtpEnabled } from './config.js';
import { db, tx } from './db.js';
import { HttpError } from './http.js';
import { hashSecret, verifySecret, sha256, randomToken, inviteCode, normalizeAnswer, normalizeKey } from './crypto.js';
import { prepareLocks, getLocks, getLocksFor, evaluate, publicLock, ATTEMPT_TYPES } from './locks.js';
import { userStats } from './stats.js';
import { addClient, removeClient, emit, notifyUser, pushPublicKey, sendMail, unreadCount } from './notify.js';

const COOKIE = 'kuncian_session';
const SESSION_MS = 60 * 24 * 3600 * 1000;
const HOUR = 3600 * 1000;
const DUMMY_HASH = await hashSecret('bukan-password-asli');

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-z0-9_.]{3,24}$/;

export function authenticate(ctx) {
  const token = ctx.cookies[COOKIE];
  if (!token) return null;
  const row = db
    .prepare('SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?')
    .get(sha256(token));
  if (!row || row.expires_at < Date.now()) return null;
  return row;
}

function startSession(ctx, userId) {
  const token = randomToken();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, Date.now() + SESSION_MS);
  ctx.setCookie(COOKIE, token, { maxAge: Math.floor(SESSION_MS / 1000) });
}

const getPartner = (user) => db.prepare('SELECT id, display_name FROM users WHERE couple_id = ? AND id != ?').get(user.couple_id, user.id);

function mePayload(u) {
  const partner = getPartner(u);
  const couple = db.prepare('SELECT invite_code FROM couples WHERE id = ?').get(u.couple_id);
  return {
    user: { id: u.id, username: u.username, email: u.email, displayName: u.display_name, emailNotify: Boolean(u.email_notify) },
    partner: partner ? { id: partner.id, displayName: partner.display_name } : null,
    inviteCode: partner ? null : couple.invite_code,
    unread: unreadCount(u.id),
    stats: userStats(u.id),
    emailEnabled: smtpEnabled(),
  };
}

function nameMap(coupleId) {
  return new Map(db.prepare('SELECT id, display_name FROM users WHERE couple_id = ?').all(coupleId).map((r) => [r.id, r.display_name]));
}

function loadMessage(id, user) {
  const m = db.prepare('SELECT * FROM messages WHERE id = ? AND (sender_id = ? OR recipient_id = ?)').get(Number(id), user.id, user.id);
  if (!m) throw new HttpError(404, 'Pesan tidak ketemu.');
  return m;
}

function summarize(m, locks, viewer, names) {
  const ev = evaluate(m, locks);
  const isSender = m.sender_id === viewer.id;
  return {
    id: m.id,
    direction: isSender ? 'out' : 'in',
    otherName: names.get(isSender ? m.recipient_id : m.sender_id) || 'Pasanganmu',
    createdAt: m.created_at,
    openedAt: m.opened_at,
    status: ev.status,
    mode: m.mode,
    attemptsLeft: ev.attemptsLeft,
    maxAttempts: m.max_attempts,
    locks: locks.map((l, i) => ({ type: l.type, satisfied: ev.sat[i], unlockAt: l.type === 'date' ? l.cfg.unlockAt : undefined })),
    preview: isSender ? m.body.slice(0, 80) : undefined,
  };
}

/** Dipanggil tiap menit: kabari penerima kalau pesan sudah bisa dibuka karena tanggalnya tiba. */
export function runUnlockNotifications() {
  const rows = db
    .prepare(
      `SELECT * FROM messages m WHERE opened_at IS NULL AND unlock_notified = 0
       AND EXISTS (SELECT 1 FROM locks WHERE message_id = m.id AND type = 'date')`,
    )
    .all();
  for (const m of rows) {
    const ev = evaluate(m, getLocks(m.id));
    if (!ev.unlockable) continue;
    db.prepare('UPDATE messages SET unlock_notified = 1 WHERE id = ?').run(m.id);
    const sender = db.prepare('SELECT display_name FROM users WHERE id = ?').get(m.sender_id);
    notifyUser(
      m.recipient_id,
      { title: config.appName, body: `Pesan dari ${sender.display_name} sudah bisa dibuka sekarang.`, url: `/pesan/${m.id}`, tag: `unlock-${m.id}` },
      { subject: `${sender.display_name}: pesannya sudah bisa dibuka`, text: `Pesan terkunci dari ${sender.display_name} sudah bisa dibuka.\n\nBuka di ${config.appUrl}\n` },
    );
  }
}

export function cleanupExpired() {
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM reset_tokens WHERE expires_at < ?').run(now);
}

export function buildRoutes() {
  const R = [];
  const add = (method, path, opts, fn) => R.push({ method, path, ...opts, fn });
  const authLimit = (key, max, windowMs = 15 * 60_000) => ({ key, max, windowMs });

  add('GET', '/api/health', {}, () => ({ ok: true }));

  add('GET', '/api/public', {}, () => {
    const n = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    return {
      appName: config.appName,
      registrationOpen: !config.maxUsers || n < config.maxUsers,
    };
  });

  // ---------- akun ----------
  add('POST', '/api/auth/register', { limit: authLimit('register', 10, 3600_000) }, async (c) => {
    const b = c.body || {};
    const username = clip(b.username, 24).toLowerCase();
    const email = clip(b.email, 120).toLowerCase();
    const password = String(b.password || '');
    const displayName = clip(b.displayName, 24) || username;
    const code = clip(b.inviteCode, 12).toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (!USERNAME_RE.test(username)) throw new HttpError(400, 'Username 3 sampai 24 karakter: huruf kecil, angka, titik, atau garis bawah.');
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Emailnya belum valid. Email dipakai untuk reset password.');
    if (password.length < 8) throw new HttpError(400, 'Password minimal 8 karakter.');

    const passwordHash = await hashSecret(password);
    try {
      const userId = tx(() => {
        const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
        if (config.maxUsers && count >= config.maxUsers) throw new HttpError(403, 'Pendaftaran sudah ditutup.');
        let coupleId;
        if (!code) {
          coupleId = Number(db.prepare('INSERT INTO couples (invite_code, created_at) VALUES (?, ?)').run(inviteCode(), Date.now()).lastInsertRowid);
        } else {
          const couple = db.prepare('SELECT id FROM couples WHERE invite_code = ?').get(code);
          if (!couple) throw new HttpError(400, 'Kode undangan tidak ketemu. Cek lagi ke pasanganmu.');
          if (db.prepare('SELECT COUNT(*) AS n FROM users WHERE couple_id = ?').get(couple.id).n >= 2) {
            throw new HttpError(400, 'Kode ini sudah dipakai berdua. Satu kode cuma untuk satu pasangan.');
          }
          coupleId = couple.id;
        }
        const r = db
          .prepare('INSERT INTO users (couple_id, username, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(coupleId, username, email, displayName, passwordHash, Date.now());
        return Number(r.lastInsertRowid);
      });
      startSession(c, userId);
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      const partner = getPartner(user);
      if (partner) notifyUser(partner.id, { title: config.appName, body: `${displayName} sudah bergabung. Sekarang kalian bisa saling kirim pesan.`, url: '/', tag: 'joined' });
      return mePayload(user);
    } catch (err) {
      if (/UNIQUE/i.test(String(err.message))) throw new HttpError(409, 'Username atau email itu sudah dipakai.');
      throw err;
    }
  });

  add('POST', '/api/auth/login', { limit: authLimit('login', 20) }, async (c) => {
    const id = clip(c.body?.username, 120).toLowerCase();
    const user = id ? db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(id, id) : null;
    const ok = await verifySecret(String(c.body?.password || ''), user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) throw new HttpError(401, 'Username atau password salah.');
    startSession(c, user.id);
    return mePayload(user);
  });

  add('POST', '/api/auth/logout', {}, (c) => {
    const token = c.cookies[COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    c.setCookie(COOKIE, '', { maxAge: 0 });
    return { ok: true };
  });

  add('POST', '/api/auth/forgot', { limit: authLimit('forgot', 5) }, (c) => {
    const id = clip(c.body?.identifier, 120).toLowerCase();
    const user = id ? db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(id, id) : null;
    if (user) {
      const token = randomToken();
      db.prepare('DELETE FROM reset_tokens WHERE user_id = ?').run(user.id);
      db.prepare('INSERT INTO reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), user.id, Date.now() + HOUR);
      sendMail({
        to: user.email,
        subject: `Reset password ${config.appName}`,
        text: `Halo ${user.display_name},\n\nAda permintaan reset password untuk akun "${user.username}". Buka link ini dalam 1 jam:\n\n${config.appUrl}/reset?token=${token}\n\nKalau bukan kamu yang minta, abaikan saja email ini.\n`,
      }).catch((e) => console.warn('[mail] gagal kirim:', e.message));
    }
    return { ok: true }; // jawaban sama supaya akun tidak bisa ditebak
  });

  add('POST', '/api/auth/reset', { limit: authLimit('reset', 10) }, async (c) => {
    const password = String(c.body?.password || '');
    if (password.length < 8) throw new HttpError(400, 'Password minimal 8 karakter.');
    const row = db.prepare('SELECT * FROM reset_tokens WHERE token_hash = ?').get(sha256(String(c.body?.token || '')));
    if (!row || row.expires_at < Date.now()) throw new HttpError(400, 'Link reset sudah kedaluwarsa. Minta link baru.');
    const hash = await hashSecret(password);
    tx(() => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, row.user_id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
      db.prepare('DELETE FROM reset_tokens WHERE user_id = ?').run(row.user_id);
    });
    return { ok: true };
  });

  add('GET', '/api/me', { auth: true }, (c) => mePayload(c.user));

  add('PATCH', '/api/me', { auth: true }, (c) => {
    const b = c.body || {};
    if (b.displayName !== undefined) {
      const name = clip(b.displayName, 24);
      if (!name) throw new HttpError(400, 'Nama panggilan tidak boleh kosong.');
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, c.user.id);
    }
    if (b.emailNotify !== undefined) db.prepare('UPDATE users SET email_notify = ? WHERE id = ?').run(b.emailNotify ? 1 : 0, c.user.id);
    return mePayload(db.prepare('SELECT * FROM users WHERE id = ?').get(c.user.id));
  });

  add('POST', '/api/me/password', { auth: true, limit: authLimit('chpw', 10) }, async (c) => {
    const next = String(c.body?.next || '');
    if (next.length < 8) throw new HttpError(400, 'Password baru minimal 8 karakter.');
    if (!(await verifySecret(String(c.body?.current || ''), c.user.password_hash))) throw new HttpError(400, 'Password lamamu belum benar.');
    const hash = await hashSecret(next);
    const current = sha256(c.cookies[COOKIE] || '');
    tx(() => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, c.user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(c.user.id, current);
    });
    return { ok: true };
  });

  // ---------- notifikasi ----------
  add('GET', '/api/push/key', { auth: true }, () => {
    const publicKey = pushPublicKey();
    if (!publicKey) throw new HttpError(503, 'Notifikasi push belum aktif di server.');
    return { publicKey };
  });

  add('POST', '/api/push/subscribe', { auth: true }, (c) => {
    const s = c.body?.subscription;
    if (!s?.endpoint || !s?.keys?.p256dh || !s?.keys?.auth || !String(s.endpoint).startsWith('https://')) {
      throw new HttpError(400, 'Data langganan notifikasi tidak valid.');
    }
    db.prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    ).run(c.user.id, String(s.endpoint), String(s.keys.p256dh), String(s.keys.auth), Date.now());
    return { ok: true };
  });

  add('POST', '/api/push/unsubscribe', { auth: true }, (c) => {
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(String(c.body?.endpoint || ''), c.user.id);
    return { ok: true };
  });

  add('GET', '/api/events', { auth: true, raw: true }, (c) => {
    c.res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    c.res.write('retry: 5000\n\n');
    const uid = c.user.id;
    addClient(uid, c.res);
    const ping = setInterval(() => c.res.write(': ping\n\n'), 25_000);
    c.req.on('close', () => {
      clearInterval(ping);
      removeClient(uid, c.res);
    });
  });

  // ---------- pesan ----------
  add('GET', '/api/messages', { auth: true }, (c) => {
    const out = c.query.box === 'out';
    const rows = db
      .prepare(`SELECT * FROM messages WHERE ${out ? 'sender_id' : 'recipient_id'} = ? ORDER BY created_at DESC, id DESC LIMIT 200`)
      .all(c.user.id);
    const lockMap = getLocksFor(rows.map((r) => r.id));
    const names = nameMap(c.user.couple_id);
    return { messages: rows.map((m) => summarize(m, lockMap.get(m.id), c.user, names)) };
  });

  add('POST', '/api/messages', { auth: true, limit: authLimit('send', 60, 3600_000) }, async (c) => {
    const b = c.body || {};
    const body = String(b.body || '').trim();
    if (!body) throw new HttpError(400, 'Tulis pesannya dulu.');
    if (body.length > 2000) throw new HttpError(400, 'Pesannya kepanjangan, maksimal 2000 huruf.');
    const partner = getPartner(c.user);
    if (!partner) throw new HttpError(400, 'Pasanganmu belum daftar. Bagikan kode undangan dulu.');
    const mode = b.mode === 'any' ? 'any' : 'all';
    const maxAttempts = Math.min(10, Math.max(1, Math.floor(Number(b.maxAttempts)) || 3));
    const locks = await prepareLocks(b.locks, { body, senderId: c.user.id, recipientId: partner.id });

    const id = tx(() => {
      const r = db
        .prepare('INSERT INTO messages (couple_id, sender_id, recipient_id, body, mode, max_attempts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(c.user.couple_id, c.user.id, partner.id, body, mode, maxAttempts, Date.now());
      const mid = Number(r.lastInsertRowid);
      locks.forEach((l, i) => db.prepare('INSERT INTO locks (message_id, type, position, config) VALUES (?, ?, ?, ?)').run(mid, l.type, i, JSON.stringify(l.config)));
      return mid;
    });

    notifyUser(
      partner.id,
      { title: config.appName, body: `Ada pesan rahasia dari ${c.user.display_name}. Bisa kamu buka nggak ya?`, url: `/pesan/${id}`, tag: `msg-${id}` },
      { subject: `${c.user.display_name} kirim pesan rahasia buat kamu`, text: `${c.user.display_name} baru kirim pesan terkunci. Bisa kamu buka nggak ya?\n\nBuka di ${config.appUrl}\n` },
    );
    emit(c.user.id);
    return { id };
  });

  add('GET', '/api/messages/:id', { auth: true }, (c) => {
    const m = loadMessage(c.params.id, c.user);
    const locks = getLocks(m.id);
    const ev = evaluate(m, locks);
    const isSender = m.sender_id === c.user.id;
    const names = nameMap(c.user.couple_id);
    return {
      id: m.id,
      direction: isSender ? 'out' : 'in',
      otherName: names.get(isSender ? m.recipient_id : m.sender_id) || 'Pasanganmu',
      createdAt: m.created_at,
      openedAt: m.opened_at,
      status: ev.status,
      mode: m.mode,
      attemptsLeft: ev.attemptsLeft,
      maxAttempts: m.max_attempts,
      hasAttemptLock: locks.some((l) => ATTEMPT_TYPES.includes(l.type)),
      locks: locks.map((l, i) => publicLock(l, ev.sat[i], isSender)),
      body: isSender || m.opened_at ? m.body : null,
    };
  });

  add('POST', '/api/messages/:id/attempt', { auth: true, limit: authLimit('attempt', 60, 10 * 60_000) }, async (c) => {
    const m = loadMessage(c.params.id, c.user);
    if (m.recipient_id !== c.user.id) throw new HttpError(403, 'Ini bukan pesan untukmu.');
    if (m.opened_at) throw new HttpError(400, 'Pesan ini sudah terbuka.');
    const locks = getLocks(m.id);
    const lock = locks.find((l) => l.id === Number(c.body?.lockId));
    if (!lock || !ATTEMPT_TYPES.includes(lock.type)) throw new HttpError(400, 'Kunci tidak ketemu.');
    if (lock.solved_at) throw new HttpError(400, 'Kunci ini sudah terbuka.');
    if (evaluate(m, locks).attemptsLeft <= 0) {
      throw new HttpError(409, 'Kesempatan habis. Minta pasanganmu memberi kesempatan tambahan.');
    }
    const answer = lock.type === 'question' ? normalizeAnswer(c.body?.answer) : normalizeKey(c.body?.answer);
    if (!answer) throw new HttpError(400, 'Isi jawabannya dulu.');
    const correct = await verifySecret(answer, lock.type === 'question' ? lock.cfg.answerHash : lock.cfg.keyHash);

    tx(() => {
      if (correct) db.prepare('UPDATE locks SET solved_at = ? WHERE id = ? AND solved_at IS NULL').run(Date.now(), lock.id);
      else db.prepare('UPDATE messages SET wrong_attempts = MIN(max_attempts, wrong_attempts + 1) WHERE id = ?').run(m.id);
    });

    const fresh = db.prepare('SELECT * FROM messages WHERE id = ?').get(m.id);
    const ev = evaluate(fresh, getLocks(m.id));
    if (!correct && ev.status === 'jammed') {
      notifyUser(m.sender_id, {
        title: config.appName,
        body: `${c.user.display_name} kehabisan kesempatan buka pesanmu. Mau kasih kesempatan tambahan?`,
        url: `/pesan/${m.id}`,
        tag: `jam-${m.id}`,
      });
    } else {
      emit(m.sender_id);
    }
    return { correct, attemptsLeft: ev.attemptsLeft, ready: ev.unlockable, status: ev.status };
  });

  add('POST', '/api/messages/:id/hint', { auth: true }, (c) => {
    const m = loadMessage(c.params.id, c.user);
    if (m.recipient_id !== c.user.id) throw new HttpError(403, 'Ini bukan pesan untukmu.');
    if (m.opened_at) throw new HttpError(400, 'Pesan ini sudah terbuka.');
    const lock = getLocks(m.id).find((l) => l.id === Number(c.body?.lockId));
    if (!lock || !ATTEMPT_TYPES.includes(lock.type)) throw new HttpError(400, 'Kunci tidak ketemu.');
    if (lock.hints_used >= lock.cfg.hints.length) throw new HttpError(400, 'Tidak ada petunjuk lagi untuk kunci ini.');
    db.prepare('UPDATE locks SET hints_used = hints_used + 1 WHERE id = ?').run(lock.id);
    return { hint: lock.cfg.hints[lock.hints_used], hintsUsed: lock.hints_used + 1 };
  });

  add('POST', '/api/messages/:id/open', { auth: true }, (c) => {
    const m = loadMessage(c.params.id, c.user);
    if (m.recipient_id !== c.user.id) throw new HttpError(403, 'Ini bukan pesan untukmu.');
    if (m.opened_at) return { body: m.body, openedAt: m.opened_at };
    if (!evaluate(m, getLocks(m.id)).unlockable) throw new HttpError(403, 'Pesan ini masih terkunci.');
    const now = Date.now();
    db.prepare('UPDATE messages SET opened_at = ? WHERE id = ? AND opened_at IS NULL').run(now, m.id);
    notifyUser(m.sender_id, {
      title: config.appName,
      body: `${c.user.display_name} sudah membuka pesanmu.`,
      url: `/pesan/${m.id}`,
      tag: `open-${m.id}`,
    });
    emit(c.user.id);
    return { body: m.body, openedAt: now };
  });

  add('POST', '/api/messages/:id/grant', { auth: true }, (c) => {
    const m = loadMessage(c.params.id, c.user);
    if (m.sender_id !== c.user.id) throw new HttpError(403, 'Cuma pengirim yang bisa kasih kesempatan tambahan.');
    if (m.opened_at) throw new HttpError(400, 'Pesan ini sudah terbuka.');
    const extra = Math.min(5, Math.max(1, Math.floor(Number(c.body?.extra)) || 3));
    const maxAttempts = Math.min(50, m.max_attempts + extra);
    db.prepare('UPDATE messages SET max_attempts = ? WHERE id = ?').run(maxAttempts, m.id);
    notifyUser(m.recipient_id, {
      title: config.appName,
      body: `${c.user.display_name} kasih kesempatan tambahan buat buka pesannya.`,
      url: `/pesan/${m.id}`,
      tag: `grant-${m.id}`,
    });
    return { maxAttempts };
  });

  add('DELETE', '/api/messages/:id', { auth: true }, (c) => {
    const m = loadMessage(c.params.id, c.user);
    if (m.sender_id !== c.user.id) throw new HttpError(403, 'Cuma pengirim yang bisa menarik pesan.');
    if (m.opened_at) throw new HttpError(400, 'Pesan yang sudah dibuka tidak bisa ditarik.');
    const used = db.prepare("SELECT 1 AS x FROM locks WHERE type = 'chain' AND json_extract(config, '$.requiresMessageId') = ?").get(m.id);
    if (used) throw new HttpError(400, 'Pesan ini dipakai sebagai kunci berantai di pesan lain. Tarik pesan itu dulu.');
    db.prepare('DELETE FROM messages WHERE id = ?').run(m.id);
    emit(m.recipient_id);
    return { ok: true };
  });

  // ---------- buku sandi ----------
  add('GET', '/api/codebook', { auth: true }, (c) => {
    const names = nameMap(c.user.couple_id);
    const rows = db.prepare('SELECT * FROM codebook WHERE couple_id = ? ORDER BY created_at DESC, id DESC').all(c.user.couple_id);
    return {
      entries: rows.map((r) => ({
        id: r.id,
        term: r.term,
        meaning: r.meaning,
        createdAt: r.created_at,
        authorName: names.get(r.author_id) || '?',
        mine: r.author_id === c.user.id,
      })),
    };
  });

  add('POST', '/api/codebook', { auth: true }, (c) => {
    const term = clip(c.body?.term, 60);
    const meaning = clip(c.body?.meaning, 300);
    if (!term || !meaning) throw new HttpError(400, 'Isi istilah dan artinya.');
    if (db.prepare('SELECT COUNT(*) AS n FROM codebook WHERE couple_id = ?').get(c.user.couple_id).n >= 300) {
      throw new HttpError(400, 'Buku sandi sudah penuh. Hapus beberapa dulu.');
    }
    const r = db.prepare('INSERT INTO codebook (couple_id, author_id, term, meaning, created_at) VALUES (?, ?, ?, ?, ?)').run(c.user.couple_id, c.user.id, term, meaning, Date.now());
    const partner = getPartner(c.user);
    if (partner) emit(partner.id);
    return { id: Number(r.lastInsertRowid) };
  });

  add('DELETE', '/api/codebook/:id', { auth: true }, (c) => {
    const r = db.prepare('DELETE FROM codebook WHERE id = ? AND author_id = ?').run(Number(c.params.id), c.user.id);
    if (!r.changes) throw new HttpError(404, 'Catatan tidak ketemu, atau bukan punyamu.');
    const partner = getPartner(c.user);
    if (partner) emit(partner.id);
    return { ok: true };
  });

  return R;
}
