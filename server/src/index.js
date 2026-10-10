import { config, smtpEnabled } from './config.js';
import { dailyBackup } from './db.js';
import { createServer } from './http.js';
import { initPush } from './notify.js';
import { buildRoutes, authenticate, runUnlockNotifications, cleanupExpired } from './routes.js';

await initPush();

const server = createServer({ routes: buildRoutes(), authenticate });

server.listen(config.port, '0.0.0.0', () => {
  console.log(`[${config.appName}] jalan di port ${config.port}`);
  console.log(`  alamat publik : ${config.appUrl}`);
  console.log(`  data          : ${config.dataDir}`);
  console.log(`  email (SMTP)  : ${smtpEnabled() ? config.smtp.host : 'belum diatur (link reset dicetak di log)'}`);
});

const tick = () => {
  try {
    runUnlockNotifications();
  } catch (err) {
    console.error('[jadwal] notifikasi buka-otomatis gagal:', err);
  }
};
const housekeeping = () => {
  try {
    cleanupExpired();
    const file = dailyBackup();
    if (file) console.log(`[backup] ${file}`);
  } catch (err) {
    console.error('[jadwal] housekeeping gagal:', err);
  }
};
setInterval(tick, 60_000).unref();
setInterval(housekeeping, 6 * 3600_000).unref();
housekeeping();

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
