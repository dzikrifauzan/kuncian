import { api } from './api.js';

// ---------- platform ----------
export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isSafariIOS = () => isIOS() && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(navigator.userAgent);
export const isStandalone = () => window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

// ---------- tema ----------
export function applyTheme() {
  let t = 'auto';
  try {
    t = localStorage.getItem('kuncian.theme') || 'auto';
  } catch {
    /* penyimpanan diblokir */
  }
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}
export function setTheme(t) {
  try {
    localStorage.setItem('kuncian.theme', t);
  } catch {
    /* abaikan */
  }
  applyTheme();
}
export function getTheme() {
  try {
    return localStorage.getItem('kuncian.theme') || 'auto';
  } catch {
    return 'auto';
  }
}

// ---------- tanggal & waktu ----------
const dt = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
const dShort = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' });
const tShort = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });
export const fmtDateTime = (ts) => dt.format(new Date(ts));
export function fmtShort(ts) {
  const d = new Date(ts);
  return d.toDateString() === new Date().toDateString() ? tShort.format(d) : dShort.format(d);
}
export function timeLeft(ts, now = Date.now()) {
  let s = Math.max(0, Math.floor((ts - now) / 1000));
  const d = Math.floor(s / 86400);
  s %= 86400;
  const h = Math.floor(s / 3600);
  s %= 3600;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (d) return `${d} hari ${h} jam ${m} menit`;
  if (h) return `${h} jam ${m} menit ${sec} detik`;
  if (m) return `${m} menit ${sec} detik`;
  return `${sec} detik`;
}
export const toLocalInput = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

// ---------- sandi huruf (sama dengan di server) ----------
export function vigenere(text, key, decrypt = false) {
  const k = String(key).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  if (!k) return text;
  let i = 0;
  return Array.from(text)
    .map((ch) => {
      const c = ch.charCodeAt(0);
      let base;
      if (c >= 65 && c <= 90) base = 65;
      else if (c >= 97 && c <= 122) base = 97;
      else return ch;
      const shift = k.charCodeAt(i % k.length) - 97;
      i += 1;
      return String.fromCharCode(base + ((c - base + (decrypt ? 26 - shift : shift)) % 26));
    })
    .join('');
}

export const LOCK_LABEL = { question: 'pertanyaan', cipher: 'sandi huruf', date: 'tanggal', chain: 'berantai' };

export function lockSummary(locks, mode) {
  const names = locks.map((l) => LOCK_LABEL[l.type]);
  let s = `Kunci: ${names.join(' + ')}`;
  if (locks.length > 1) s += mode === 'all' ? ' (semua harus)' : ' (salah satu)';
  return s;
}

// ---------- notifikasi push ----------
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function enablePush() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Izin notifikasi ditolak. Aktifkan lewat Pengaturan HP, lalu coba lagi.');
  const { publicKey } = await api.get('/push/key');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  await api.post('/push/subscribe', { subscription: sub.toJSON() });
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}
