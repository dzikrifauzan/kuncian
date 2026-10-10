import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const env = process.env;
// Di Docker frontend ada di ../public. Saat dev lokal, otomatis pakai hasil build ../../web/dist.
const bundledPublic = fileURLToPath(new URL('../public', import.meta.url));
const devPublic = fileURLToPath(new URL('../../web/dist', import.meta.url));
const port = Number(env.PORT) || 3000;
const appUrl = (env.APP_URL || `http://localhost:${port}`).replace(/\/+$/, '');

export const config = {
  port,
  appUrl,
  appName: (env.APP_NAME || 'Kuncian').trim().slice(0, 30) || 'Kuncian',
  dataDir: env.DATA_DIR || './data',
  publicDir: env.PUBLIC_DIR || (fs.existsSync(bundledPublic) ? bundledPublic : devPublic),
  // Pendaftaran otomatis tertutup kalau jumlah akun sudah segini.
  maxUsers: Number(env.MAX_USERS) || 2,
  allowNewCouples: env.ALLOW_NEW_COUPLES === 'true',
  tz: env.APP_TZ || 'Asia/Jakarta',
  trustProxy: env.TRUST_PROXY !== 'false',
  secureCookie: appUrl.startsWith('https://'),
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT) || 587,
    secure: env.SMTP_SECURE === 'true',
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || (env.SMTP_USER ? `${env.APP_NAME || 'Kuncian'} <${env.SMTP_USER}>` : ''),
  },
  vapid: {
    subject: env.VAPID_SUBJECT || (appUrl.startsWith('https://') ? appUrl : 'mailto:admin@example.com'),
    publicKey: env.VAPID_PUBLIC_KEY || '',
    privateKey: env.VAPID_PRIVATE_KEY || '',
  },
};

export const smtpEnabled = () => Boolean(config.smtp.host && config.smtp.from);
