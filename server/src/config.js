import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Mode lokal (npm start / npm run dev): baca file .env di folder server atau folder induknya.
// Variabel yang sudah diset di lingkungan (misalnya oleh Docker) tidak ditimpa.
let envFile = "";
if (
  process.env.NO_DOTENV !== "1" &&
  typeof process.loadEnvFile === "function"
) {
  for (const rel of ["../.env", "../../.env"]) {
    const file = fileURLToPath(new URL(rel, import.meta.url));
    if (fs.existsSync(file)) {
      try {
        process.loadEnvFile(file);
        envFile = file;
      } catch (err) {
        console.warn(`[config] gagal membaca ${file}: ${err.message}`);
      }
      break;
    }
  }
}

const env = process.env;
// Di Docker frontend ada di ../public. Saat dev lokal, otomatis pakai hasil build ../../web/dist.
const bundledPublic = fileURLToPath(new URL("../public", import.meta.url));
const devPublic = fileURLToPath(new URL("../../web/dist", import.meta.url));
const port = Number(env.PORT) || 3000;
const appUrl = (env.APP_URL || `http://localhost:${port}`).replace(/\/+$/, "");

export const config = {
  envFile,
  port,
  appUrl,
  appName: (env.APP_NAME || "Kuncian").trim().slice(0, 30) || "Kuncian",
  dataDir: env.DATA_DIR || "./data",
  publicDir:
    env.PUBLIC_DIR ||
    (fs.existsSync(bundledPublic) ? bundledPublic : devPublic),
  // Batas total akun (0 = tanpa batas). Tiap pasangan tetap maksimal 2 akun.
  maxUsers: Number(env.MAX_USERS) || 0,
  // auto = wajib verifikasi email hanya kalau SMTP sudah diatur. true/false untuk memaksa.
  verifyEmail: (env.EMAIL_VERIFY || "auto").toLowerCase(),
  tz: env.APP_TZ || "Asia/Jakarta",
  trustProxy: env.TRUST_PROXY !== "false",
  secureCookie: appUrl.startsWith("https://"),
  smtp: {
    host: env.SMTP_HOST || "",
    port: Number(env.SMTP_PORT) || 587,
    secure: env.SMTP_SECURE === "true",
    user: env.SMTP_USER || "",
    pass: env.SMTP_PASS || "",
    from:
      env.MAIL_FROM ||
      (env.SMTP_USER ? `${env.APP_NAME || "Kuncian"} <${env.SMTP_USER}>` : ""),
  },
  vapid: {
    subject:
      env.VAPID_SUBJECT ||
      (appUrl.startsWith("https://") ? appUrl : "mailto:admin@example.com"),
    publicKey: env.VAPID_PUBLIC_KEY || "",
    privateKey: env.VAPID_PRIVATE_KEY || "",
  },
};

export const smtpEnabled = () => Boolean(config.smtp.host && config.smtp.from);
export const verifyRequired = () =>
  config.verifyEmail === "auto" ? smtpEnabled() : config.verifyEmail === "true";
