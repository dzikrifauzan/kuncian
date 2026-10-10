// Uji alur lengkap dua akun terhadap server sungguhan (data sementara, dihapus setelah selesai).
//   cd server && npm run smoke
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vigenere } from '../src/crypto.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = 4100 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuncian-smoke-'));
const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuncian-public-'));
fs.writeFileSync(path.join(publicDir, 'index.html'), '<title>{{APP_NAME}}</title>');

let log = '';
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, '../src/index.js')], {
  env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, PUBLIC_DIR: publicDir, APP_URL: base, APP_NAME: 'Kuncian Uji', SMTP_HOST: '' },
});
child.stdout.on('data', (d) => (log += d));
child.stderr.on('data', (d) => (log += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 100 && !log.includes('jalan di port'); i += 1) await sleep(100);
assert.ok(log.includes('jalan di port'), `server tidak mau jalan:\n${log}`);

function client(name) {
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const pair = c.split(';')[0];
      cookie = pair.endsWith('=') ? '' : pair;
    }
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* bukan json */
    }
    return { status: res.status, data, text };
  };
  return { name, call, get cookie() { return cookie; } };
}

let passed = 0;
const ok = (label) => {
  passed += 1;
  console.log(`  ok  ${label}`);
};

try {
  const A = client('Dika');
  const B = client('Rara');

  // --- pendaftaran dan pairing ---
  let r = await A.call('GET', '/api/public');
  assert.equal(r.data.firstUser, true);
  assert.equal(r.data.appName, 'Kuncian Uji');
  r = await A.call('POST', '/api/auth/register', { username: 'dika', email: 'dika@example.com', password: 'pendek', displayName: 'Dika' });
  assert.equal(r.status, 400);
  r = await A.call('POST', '/api/auth/register', { username: 'dika', email: 'dika@example.com', password: 'passwordku1', displayName: 'Dika' });
  assert.equal(r.status, 200);
  const code = r.data.inviteCode;
  assert.match(code, /^[A-Z0-9]{6}$/);
  assert.equal(r.data.partner, null);
  ok('akun pertama dibuat dan dapat kode undangan');

  r = await B.call('POST', '/api/auth/register', { username: 'rara', email: 'rara@example.com', password: 'passwordku2', displayName: 'Rara' });
  assert.equal(r.status, 400, 'tanpa kode harus ditolak');
  r = await B.call('POST', '/api/auth/register', { username: 'rara', email: 'rara@example.com', password: 'passwordku2', displayName: 'Rara', inviteCode: 'ZZZZZZ' });
  assert.equal(r.status, 400, 'kode salah harus ditolak');
  r = await B.call('POST', '/api/auth/register', { username: 'rara', email: 'rara@example.com', password: 'passwordku2', displayName: 'Rara', inviteCode: code.toLowerCase() });
  assert.equal(r.status, 200);
  assert.equal(r.data.partner.displayName, 'Dika');
  const C = client('Orang ketiga');
  r = await C.call('POST', '/api/auth/register', { username: 'tamu', email: 'tamu@example.com', password: 'passwordku3', inviteCode: code });
  assert.equal(r.status, 403, 'akun ketiga harus ditolak');
  ok('pairing berdua jalan, akun ketiga ditolak');

  r = await A.call('GET', '/api/me');
  assert.equal(r.data.partner.displayName, 'Rara');
  assert.equal(r.data.inviteCode, null);
  r = await A.call('POST', '/api/messages', { body: 'x', locks: [{ type: 'question', question: 'a', answer: 'b' }] }, { Origin: 'https://jahat.example' });
  assert.equal(r.status, 403, 'Origin asing harus ditolak');
  r = await new client('anon').call('GET', '/api/messages');
  assert.equal(r.status, 401);
  ok('Origin asing dan akses tanpa login ditolak');

  // --- SSE: Rara harus langsung dikabari saat Dika kirim pesan ---
  const sseCtl = new AbortController();
  const sseRes = await fetch(`${base}/api/events`, { headers: { Cookie: B.cookie }, signal: sseCtl.signal });
  assert.equal(sseRes.status, 200);
  const reader = sseRes.body.getReader();
  let sseText = '';
  const ssePromise = (async () => {
    const dec = new TextDecoder();
    while (!sseText.includes('event: refresh')) {
      const { value, done } = await reader.read();
      if (done) break;
      sseText += dec.decode(value);
    }
  })();

  // --- pesan dengan dua kunci, mode salah satu ---
  const body1 = 'Kangen kamu. Nanti malam kita makan bakso ya.';
  r = await A.call('POST', '/api/messages', {
    body: body1,
    mode: 'any',
    maxAttempts: 2,
    locks: [
      { type: 'question', question: 'Di mana kita pertama makan bareng?', answer: 'Bakso Pak Slamet!', hints: ['Warungnya kecil', 'Ada gerobak biru'] },
      { type: 'cipher', key: 'cinta', hints: ['Lima huruf, dimulai c'] },
    ],
  });
  assert.equal(r.status, 200, r.text);
  const m1 = r.data.id;
  await Promise.race([ssePromise, sleep(3000)]);
  assert.ok(sseText.includes('event: refresh'), 'SSE tidak mengirim refresh');
  sseCtl.abort();
  ok('pesan terkirim dan penerima dikabari lewat SSE');

  r = await B.call('GET', '/api/messages?box=in');
  assert.equal(r.data.messages.length, 1);
  assert.equal(r.data.messages[0].status, 'locked');
  assert.equal(r.data.messages[0].otherName, 'Dika');
  r = await B.call('GET', `/api/messages/${m1}`);
  assert.equal(r.data.body, null, 'isi pesan tidak boleh bocor sebelum terbuka');
  assert.ok(!r.text.includes('answerHash') && !r.text.includes('keyHash') && !r.text.includes('pak slamet'), 'rahasia kunci bocor');
  const qLock = r.data.locks.find((l) => l.type === 'question');
  const cLock = r.data.locks.find((l) => l.type === 'cipher');
  assert.notEqual(cLock.cipherText, body1);
  assert.equal(vigenere(cLock.cipherText, 'cinta', true), body1, 'sandi harus bisa dibalik dengan kata kunci');
  assert.equal(qLock.hints.length, 0);
  ok('isi pesan dan jawaban tidak bocor, sandi huruf benar');

  r = await B.call('POST', `/api/messages/${m1}/attempt`, { lockId: qLock.id, answer: 'warteg' });
  assert.equal(r.data.correct, false);
  assert.equal(r.data.attemptsLeft, 1);
  r = await B.call('POST', `/api/messages/${m1}/hint`, { lockId: qLock.id });
  assert.equal(r.data.hint, 'Warungnya kecil');
  r = await B.call('POST', `/api/messages/${m1}/attempt`, { lockId: cLock.id, answer: 'salah' });
  assert.equal(r.data.attemptsLeft, 0);
  assert.equal(r.data.status, 'jammed');
  r = await B.call('POST', `/api/messages/${m1}/attempt`, { lockId: qLock.id, answer: 'bakso pak slamet' });
  assert.equal(r.status, 409, 'harus macet setelah kesempatan habis');
  r = await B.call('POST', `/api/messages/${m1}/grant`, { extra: 3 });
  assert.equal(r.status, 403, 'penerima tidak boleh kasih kesempatan');
  r = await A.call('POST', `/api/messages/${m1}/grant`, { extra: 3 });
  assert.equal(r.data.maxAttempts, 5);
  ok('percobaan, petunjuk, macet, dan kesempatan tambahan');

  r = await B.call('POST', `/api/messages/${m1}/open`);
  assert.equal(r.status, 403, 'belum boleh dibuka');
  r = await B.call('POST', `/api/messages/${m1}/attempt`, { lockId: qLock.id, answer: '  BAKSO   pak slamet ' });
  assert.equal(r.data.correct, true);
  assert.equal(r.data.ready, true, 'mode salah satu: satu kunci cukup');
  r = await B.call('POST', `/api/messages/${m1}/open`);
  assert.equal(r.data.body, body1);
  r = await A.call('GET', `/api/messages/${m1}`);
  assert.ok(r.data.openedAt, 'pengirim harus tahu pesan sudah dibuka');
  assert.equal(r.data.status, 'opened');
  r = await B.call('GET', `/api/messages/${m1}`);
  assert.equal(r.data.body, body1, 'pesan yang sudah dibuka tetap bisa dibaca');
  ok('jawaban dinormalkan, pesan terbuka, pengirim tahu');

  // --- kunci tanggal + mode semua ---
  const soon = new Date(Date.now() + 120_000).toISOString();
  r = await A.call('POST', '/api/messages', { body: 'Buka setelah tanggal.', mode: 'all', locks: [{ type: 'date', unlockAt: new Date(Date.now() - 1000).toISOString() }] });
  assert.equal(r.status, 400, 'tanggal lampau ditolak');
  r = await A.call('POST', '/api/messages', {
    body: 'Buka setelah tanggal.',
    mode: 'all',
    locks: [{ type: 'question', question: 'Warna favorit?', answer: 'biru' }, { type: 'date', unlockAt: soon }],
  });
  const m2 = r.data.id;
  r = await B.call('GET', `/api/messages/${m2}`);
  const q2 = r.data.locks.find((l) => l.type === 'question');
  r = await B.call('POST', `/api/messages/${m2}/attempt`, { lockId: q2.id, answer: 'Biru' });
  assert.equal(r.data.correct, true);
  assert.equal(r.data.ready, false, 'mode semua: tanggal belum tiba');
  r = await B.call('POST', `/api/messages/${m2}/open`);
  assert.equal(r.status, 403);
  ok('mode "semua harus" menunggu kunci tanggal');

  // --- kunci berantai ---
  r = await A.call('POST', '/api/messages', { body: 'Potongan pertama.', mode: 'all', locks: [{ type: 'question', question: 'Satu tambah satu?', answer: 'dua' }] });
  const first = r.data.id;
  r = await A.call('POST', '/api/messages', { body: 'Potongan kedua.', mode: 'all', locks: [{ type: 'chain', requiresMessageId: first, note: 'Petunjuknya ada di pesan sebelumnya' }] });
  const second = r.data.id;
  r = await A.call('POST', '/api/messages', { body: 'x', mode: 'all', locks: [{ type: 'chain', requiresMessageId: 99999 }] });
  assert.equal(r.status, 400);
  r = await B.call('POST', `/api/messages/${second}/open`);
  assert.equal(r.status, 403, 'berantai harus menunggu pesan pertama');
  r = await A.call('DELETE', `/api/messages/${first}`);
  assert.equal(r.status, 400, 'pesan yang dipakai berantai tidak boleh ditarik');
  r = await B.call('GET', `/api/messages/${first}`);
  r = await B.call('POST', `/api/messages/${first}/attempt`, { lockId: r.data.locks[0].id, answer: 'dua' });
  assert.equal(r.data.correct, true);
  r = await B.call('POST', `/api/messages/${first}/open`);
  assert.equal(r.status, 200);
  r = await B.call('POST', `/api/messages/${second}/open`);
  assert.equal(r.data.body, 'Potongan kedua.');
  ok('kunci berantai terbuka setelah pesan sebelumnya dibuka');

  r = await A.call('DELETE', `/api/messages/${m2}`);
  assert.equal(r.status, 200, 'pesan yang belum dibuka boleh ditarik');
  r = await A.call('DELETE', `/api/messages/${m1}`);
  assert.equal(r.status, 400, 'pesan yang sudah dibuka tidak boleh ditarik');
  ok('tarik pesan');

  // --- statistik ---
  r = await B.call('GET', '/api/me');
  assert.ok(r.data.stats.streak >= 1);
  assert.ok(r.data.stats.badges.find((b) => b.code === 'kilat').earned, 'lencana Kilat');
  assert.equal(r.data.unread, 0);
  ok('streak dan lencana');

  // --- buku sandi ---
  r = await A.call('POST', '/api/codebook', { term: 'bakso', meaning: 'kode untuk "kangen"' });
  const entry = r.data.id;
  r = await B.call('GET', '/api/codebook');
  assert.equal(r.data.entries.length, 1);
  assert.equal(r.data.entries[0].mine, false);
  r = await B.call('DELETE', `/api/codebook/${entry}`);
  assert.equal(r.status, 404);
  r = await A.call('DELETE', `/api/codebook/${entry}`);
  assert.equal(r.status, 200);
  ok('buku sandi bersama');

  // --- reset password ---
  r = await new client('anon').call('POST', '/api/auth/forgot', { identifier: 'rara@example.com' });
  assert.equal(r.status, 200);
  const nobody = await new client('anon').call('POST', '/api/auth/forgot', { identifier: 'tidakada@example.com' });
  assert.deepEqual(nobody.data, r.data, 'jawaban harus sama supaya akun tidak bisa ditebak');
  await sleep(300);
  const token = /reset\?token=([\w-]+)/.exec(log)?.[1];
  assert.ok(token, `link reset tidak tercetak di log:\n${log}`);
  r = await new client('anon').call('POST', '/api/auth/reset', { token: 'ngawur', password: 'passwordbaru1' });
  assert.equal(r.status, 400);
  r = await new client('anon').call('POST', '/api/auth/reset', { token, password: 'passwordbaru1' });
  assert.equal(r.status, 200);
  r = await new client('anon').call('POST', '/api/auth/reset', { token, password: 'passwordbaru2' });
  assert.equal(r.status, 400, 'token hanya sekali pakai');
  r = await B.call('GET', '/api/me');
  assert.equal(r.status, 401, 'sesi lama harus keluar setelah reset');
  r = await new client('anon').call('POST', '/api/auth/login', { username: 'rara', password: 'passwordku2' });
  assert.equal(r.status, 401);
  r = await new client('anon').call('POST', '/api/auth/login', { username: 'RARA@example.com', password: 'passwordbaru1' });
  assert.equal(r.status, 200);
  ok('reset password lewat link (sekali pakai) dan login ulang');

  // --- file statis ---
  const idx = await fetch(`${base}/pesan/123`);
  assert.ok((await idx.text()).includes('<title>Kuncian Uji</title>'), 'index.html harus memuat nama aplikasi');
  assert.ok(idx.headers.get('content-security-policy').includes("script-src 'self'"));
  const man = await (await fetch(`${base}/manifest.webmanifest`)).json();
  assert.equal(man.short_name, 'Kuncian Uji');
  const trav = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: '/%2e%2e/%2e%2e/%2e%2e/etc/passwd' }, (res) => {
      let t = '';
      res.on('data', (d) => (t += d));
      res.on('end', () => resolve({ status: res.statusCode, t }));
    });
  });
  assert.ok(!trav.t.includes('root:'), 'path traversal berhasil, bahaya');
  ok('file statis, manifest, CSP, dan path traversal aman');

  console.log(`\nSemua ${passed} kelompok uji lulus.`);
} catch (err) {
  console.error('\nGAGAL:', err);
  console.error('\nLog server:\n' + log);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  await sleep(200);
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(publicDir, { recursive: true, force: true });
}
