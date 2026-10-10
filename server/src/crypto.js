import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

/** Hash password / jawaban dengan scrypt + salt acak. Format: salt:hash (hex). */
export async function hashSecret(secret) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(String(secret), salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifySecret(secret, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(String(secret), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export function inviteCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i += 1) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

const stripMarks = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Jawaban pertanyaan: abaikan huruf besar, tanda baca, dan spasi berlebih. */
export function normalizeAnswer(s) {
  return stripMarks(s).toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

/** Kata kunci sandi: hanya huruf a sampai z. */
export function normalizeKey(s) {
  return stripMarks(s).toLowerCase().replace(/[^a-z]/g, '');
}

/** Sandi Vigenere. Huruf selain a-z (spasi, angka, emoji) dibiarkan apa adanya. */
export function vigenere(text, key, decrypt = false) {
  const k = normalizeKey(key);
  if (!k) return String(text);
  let i = 0;
  return Array.from(String(text))
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
