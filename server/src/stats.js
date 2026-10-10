import { db, dayKey } from './db.js';
import { ATTEMPT_TYPES } from './locks.js';

const BADGES = [
  { code: 'kilat', name: 'Kilat', desc: 'Memecahkan kunci dan membuka pesan kurang dari semenit.' },
  { code: 'tanpa_petunjuk', name: 'Tanpa petunjuk', desc: 'Membuka pesan berkunci tanpa minta petunjuk sama sekali.' },
  { code: 'penunggu', name: 'Penunggu setia', desc: 'Membuka pesan yang kuncinya menunggu tanggal, lebih dari sehari setelah dikirim.' },
  { code: 'pemecah', name: 'Pemecah sandi', desc: 'Sudah membuka 5 pesan.' },
  { code: 'rajin', name: 'Rajin', desc: 'Streak 7 hari berturut-turut.' },
  { code: 'dalang', name: 'Dalang sandi', desc: 'Sudah mengirim 10 pesan.' },
];

const prevDay = (key) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

export function userStats(userId) {
  const sent = db.prepare('SELECT created_at FROM messages WHERE sender_id = ?').all(userId);
  const opened = db.prepare('SELECT id, created_at, opened_at FROM messages WHERE recipient_id = ? AND opened_at IS NOT NULL').all(userId);

  const locksByMsg = new Map(opened.map((m) => [m.id, []]));
  if (opened.length) {
    const rows = db
      .prepare(`SELECT message_id, type, hints_used FROM locks WHERE message_id IN (${opened.map(() => '?').join(',')})`)
      .all(...opened.map((m) => m.id));
    for (const r of rows) locksByMsg.get(r.message_id).push(r);
  }

  const days = new Set([...sent.map((m) => dayKey(m.created_at)), ...opened.map((m) => dayKey(m.opened_at))]);
  let cursor = dayKey();
  if (!days.has(cursor)) cursor = prevDay(cursor);
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = prevDay(cursor);
  }

  const withAttempts = opened.filter((m) => locksByMsg.get(m.id).some((l) => ATTEMPT_TYPES.includes(l.type)));
  const earned = {
    kilat: withAttempts.some((m) => m.opened_at - m.created_at < 60_000),
    tanpa_petunjuk: withAttempts.some((m) => locksByMsg.get(m.id).every((l) => l.hints_used === 0)),
    penunggu: opened.some((m) => locksByMsg.get(m.id).some((l) => l.type === 'date') && m.opened_at - m.created_at >= 86_400_000),
    pemecah: opened.length >= 5,
    rajin: streak >= 7,
    dalang: sent.length >= 10,
  };

  return {
    streak,
    sentCount: sent.length,
    openedCount: opened.length,
    badges: BADGES.map((b) => ({ ...b, earned: earned[b.code] })),
  };
}
