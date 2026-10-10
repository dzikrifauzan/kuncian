import { config, smtpEnabled } from './config.js';
import { db, getSetting, setSetting } from './db.js';

// ---------- SSE (pembaruan langsung di aplikasi) ----------
const clients = new Map(); // userId -> Set<res>

export function addClient(userId, res) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);
}
export function removeClient(userId, res) {
  clients.get(userId)?.delete(res);
}
export function emit(userId, event = 'refresh') {
  for (const res of clients.get(userId) ?? []) {
    try {
      res.write(`event: ${event}\ndata: {}\n\n`);
    } catch {
      /* koneksi sudah putus */
    }
  }
}

// ---------- Web push ----------
let webpush = null;
let vapidPublic = '';

export async function initPush() {
  try {
    webpush = (await import('web-push')).default;
  } catch {
    console.warn('[push] Paket web-push tidak terpasang, notifikasi push dimatikan.');
    return;
  }
  let publicKey = config.vapid.publicKey || getSetting('vapid_public');
  let privateKey = config.vapid.privateKey || getSetting('vapid_private');
  if (!publicKey || !privateKey) {
    const keys = webpush.generateVAPIDKeys();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
    setSetting('vapid_public', publicKey);
    setSetting('vapid_private', privateKey);
    console.log('[push] Kunci VAPID baru dibuat dan disimpan di database.');
  }
  webpush.setVapidDetails(config.vapid.subject, publicKey, privateKey);
  vapidPublic = publicKey;
}

export const pushPublicKey = () => vapidPublic;

async function sendPush(userId, payload) {
  if (!webpush) return;
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 60 * 24, urgency: 'high' },
        );
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
        } else {
          console.warn('[push] gagal kirim:', err.statusCode || err.message);
        }
      }
    }),
  );
}

// ---------- Email ----------
let transporter = null;

export async function sendMail({ to, subject, text }) {
  if (!smtpEnabled()) {
    console.log(`[mail] SMTP belum diatur, email tidak dikirim.\n  kepada : ${to}\n  subjek : ${subject}\n  isi    :\n${text.replace(/^/gm, '    ')}`);
    return false;
  }
  if (!transporter) {
    const nodemailer = (await import('nodemailer')).default;
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  await transporter.sendMail({ from: config.smtp.from, to, subject, text });
  return true;
}

export const unreadCount = (userId) =>
  db.prepare('SELECT COUNT(*) AS n FROM messages WHERE recipient_id = ? AND opened_at IS NULL').get(userId).n;

/**
 * Kabari satu orang. Isi pesan tidak pernah ikut terkirim, hanya pemberitahuan.
 * email: { subject, text } kalau mau dikirim lewat email juga (mengikuti pengaturan penerima).
 */
export function notifyUser(userId, { title, body, url = '/', tag }, email = null) {
  emit(userId);
  const user = db.prepare('SELECT id, email, email_notify FROM users WHERE id = ?').get(userId);
  if (!user) return;
  sendPush(userId, { title, body, url, tag, badge: unreadCount(userId) }).catch((e) => console.warn('[push]', e.message));
  if (email && user.email_notify) {
    sendMail({ to: user.email, subject: email.subject, text: email.text }).catch((e) => console.warn('[mail] gagal kirim:', e.message));
  }
}
