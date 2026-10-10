import { db } from './db.js';
import { HttpError } from './http.js';
import { hashSecret, normalizeAnswer, normalizeKey, vigenere } from './crypto.js';

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const hintList = (h) => (Array.isArray(h) ? h : []).map((x) => clip(x, 200)).filter(Boolean).slice(0, 2);

export const ATTEMPT_TYPES = ['question', 'cipher'];

/** Validasi kunci dari pengirim dan ubah jadi bentuk yang disimpan (jawaban tidak pernah disimpan polos). */
export async function prepareLocks(input, { body, senderId, recipientId }) {
  if (!Array.isArray(input) || input.length === 0) throw new HttpError(400, 'Pilih minimal satu kunci.');
  if (input.length > 6) throw new HttpError(400, 'Maksimal 6 kunci per pesan.');
  const seen = new Set();
  const chained = new Set();
  const out = [];

  for (const l of input) {
    const type = l?.type;
    if (['question', 'cipher', 'date'].includes(type)) {
      if (seen.has(type)) throw new HttpError(400, 'Satu jenis kunci cukup dipakai sekali per pesan.');
      seen.add(type);
    }

    if (type === 'question') {
      const question = clip(l.question, 200);
      const answer = normalizeAnswer(l.answer);
      if (!question) throw new HttpError(400, 'Tulis pertanyaannya dulu.');
      if (!answer) throw new HttpError(400, 'Tulis jawaban untuk pertanyaannya.');
      out.push({ type, config: { question, answerHash: await hashSecret(answer), hints: hintList(l.hints) } });
    } else if (type === 'cipher') {
      const key = normalizeKey(l.key);
      if (key.length < 2 || key.length > 20) throw new HttpError(400, 'Kata kunci sandi harus 2 sampai 20 huruf (a sampai z).');
      if ((body.match(/[A-Za-z]/g) || []).length < 3) throw new HttpError(400, 'Sandi huruf butuh pesan yang berisi huruf.');
      out.push({ type, config: { keyHash: await hashSecret(key), cipherText: vigenere(body, key), hints: hintList(l.hints) } });
    } else if (type === 'date') {
      const t = Date.parse(l.unlockAt);
      if (!Number.isFinite(t)) throw new HttpError(400, 'Tanggal buka tidak valid.');
      if (t < Date.now() + 30_000) throw new HttpError(400, 'Tanggal buka harus di masa depan.');
      if (t > Date.now() + 5 * 365 * 86_400_000) throw new HttpError(400, 'Tanggal buka terlalu jauh.');
      out.push({ type, config: { unlockAt: t } });
    } else if (type === 'chain') {
      const id = Number(l.requiresMessageId);
      const ok = db.prepare('SELECT id FROM messages WHERE id = ? AND sender_id = ? AND recipient_id = ?').get(id, senderId, recipientId);
      if (!ok) throw new HttpError(400, 'Pesan untuk kunci berantai tidak ditemukan.');
      if (chained.has(id)) throw new HttpError(400, 'Pesan yang sama dipilih dua kali.');
      chained.add(id);
      out.push({ type, config: { requiresMessageId: id, note: clip(l.note, 200) } });
    } else {
      throw new HttpError(400, 'Jenis kunci tidak dikenal.');
    }
  }
  return out;
}

const parse = (row) => ({ ...row, cfg: JSON.parse(row.config) });

export function getLocks(messageId) {
  return db.prepare('SELECT * FROM locks WHERE message_id = ? ORDER BY position').all(messageId).map(parse);
}

export function getLocksFor(messageIds) {
  const map = new Map(messageIds.map((id) => [id, []]));
  if (!messageIds.length) return map;
  const rows = db
    .prepare(`SELECT * FROM locks WHERE message_id IN (${messageIds.map(() => '?').join(',')}) ORDER BY position`)
    .all(...messageIds);
  for (const row of rows) map.get(row.message_id).push(parse(row));
  return map;
}

function satisfied(lock) {
  switch (lock.type) {
    case 'question':
    case 'cipher':
      return lock.solved_at != null;
    case 'date':
      return Date.now() >= lock.cfg.unlockAt;
    case 'chain': {
      const r = db.prepare('SELECT opened_at FROM messages WHERE id = ?').get(lock.cfg.requiresMessageId);
      return Boolean(r?.opened_at);
    }
    default:
      return false;
  }
}

/** Hitung keadaan pesan: kunci mana yang terbuka, sisa percobaan, dan status akhirnya. */
export function evaluate(msg, locks) {
  const sat = locks.map(satisfied);
  const unlockable = msg.mode === 'all' ? sat.every(Boolean) : sat.some(Boolean);
  const attemptsLeft = Math.max(0, msg.max_attempts - msg.wrong_attempts);
  const pendingAttemptLock = locks.some((l, i) => ATTEMPT_TYPES.includes(l.type) && !sat[i]);
  const canStillUnlock = msg.mode === 'any' && locks.some((l, i) => (l.type === 'date' || l.type === 'chain') && !sat[i]);

  let status = 'locked';
  if (msg.opened_at) status = 'opened';
  else if (unlockable) status = 'ready';
  else if (attemptsLeft <= 0 && pendingAttemptLock && !canStillUnlock) status = 'jammed';
  return { sat, unlockable, attemptsLeft, status };
}

/** Bentuk kunci yang aman dikirim ke klien. Jawaban dan kata kunci tidak pernah ikut. */
export function publicLock(lock, isSat, isSender) {
  const base = { id: lock.id, type: lock.type, satisfied: isSat };
  if (lock.type === 'question' || lock.type === 'cipher') {
    const hints = lock.cfg.hints;
    return {
      ...base,
      ...(lock.type === 'question' ? { question: lock.cfg.question } : { cipherText: lock.cfg.cipherText }),
      hintsTotal: hints.length,
      hintsUsed: lock.hints_used,
      hints: isSender ? hints : hints.slice(0, lock.hints_used),
    };
  }
  if (lock.type === 'date') return { ...base, unlockAt: lock.cfg.unlockAt };
  const req = db.prepare('SELECT created_at, opened_at FROM messages WHERE id = ?').get(lock.cfg.requiresMessageId);
  return {
    ...base,
    requires: {
      messageId: lock.cfg.requiresMessageId,
      note: lock.cfg.note,
      createdAt: req?.created_at ?? null,
      opened: Boolean(req?.opened_at),
    },
  };
}
