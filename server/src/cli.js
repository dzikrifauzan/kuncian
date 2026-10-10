// Alat bantu admin. Di Docker:  docker compose exec kuncian node src/cli.js <perintah>
import { db } from './db.js';
import { hashSecret } from './crypto.js';

const [cmd, ...args] = process.argv.slice(2);

const usage = `Perintah:
  list-users                              tampilkan semua akun dan kode undangan
  reset-password <username> <password>    ganti password (minimal 8 karakter) dan keluarkan semua sesi
  set-email <username> <email>            ganti email akun`;

function findUser(name) {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(name || '').toLowerCase());
  if (!u) {
    console.error(`Akun "${name}" tidak ketemu.`);
    process.exit(1);
  }
  return u;
}

if (cmd === 'list-users') {
  const rows = db
    .prepare('SELECT u.id, u.username, u.email, u.display_name, c.invite_code FROM users u JOIN couples c ON c.id = u.couple_id ORDER BY u.id')
    .all();
  if (!rows.length) console.log('Belum ada akun.');
  for (const r of rows) console.log(`#${r.id}  ${r.username}  <${r.email}>  panggilan: ${r.display_name}  kode undangan: ${r.invite_code}`);
} else if (cmd === 'reset-password') {
  const [username, password] = args;
  if (!username || !password || password.length < 8) {
    console.error('Pemakaian: reset-password <username> <password>  (password minimal 8 karakter)');
    process.exit(1);
  }
  const u = findUser(username);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashSecret(password), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  console.log(`Password "${u.username}" sudah diganti.`);
} else if (cmd === 'set-email') {
  const [username, email] = args;
  if (!username || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) {
    console.error('Pemakaian: set-email <username> <email>');
    process.exit(1);
  }
  const u = findUser(username);
  db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email.toLowerCase(), u.id);
  console.log(`Email "${u.username}" sekarang ${email.toLowerCase()}.`);
} else {
  console.log(usage);
}
