import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

// ---- pembatas percobaan sederhana (di memori) ----
const buckets = new Map();
export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) {
    b = { n: 0, reset: now + windowMs };
    buckets.set(key, b);
  }
  b.n += 1;
  return b.n <= max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 60_000).unref();

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        /* abaikan cookie rusak */
      }
    }
  }
  return out;
}

export function clientIp(req) {
  if (config.trustProxy) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (xff.length) return xff[xff.length - 1];
    if (req.headers['x-real-ip']) return String(req.headers['x-real-ip']);
  }
  return req.socket.remoteAddress || '?';
}

function readBody(req, limit = 100_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'Isinya terlalu besar.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  if (config.secureCookie) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
}

function sendJson(res, status, data, cookies = []) {
  const body = JSON.stringify(data);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  };
  if (cookies.length) headers['Set-Cookie'] = cookies;
  res.writeHead(status, headers);
  res.end(body);
}

function serveStatic(req, res, pathname) {
  const root = path.resolve(config.publicDir);
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    rel = '/';
  }

  if (rel === '/manifest.webmanifest') {
    const manifest = {
      name: config.appName,
      short_name: config.appName,
      description: 'Kotak surat rahasia berdua.',
      lang: 'id',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#14213D',
      theme_color: '#14213D',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    };
    const body = JSON.stringify(manifest);
    res.writeHead(200, { 'Content-Type': MIME['.webmanifest'], 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }

  let file = path.resolve(root, '.' + path.normalize(rel));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  let stat = null;
  try {
    stat = fs.statSync(file);
  } catch {
    /* tidak ada */
  }
  if (!stat || !stat.isFile()) {
    if (path.extname(rel)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Tidak ketemu.');
      return;
    }
    file = path.join(root, 'index.html'); // fallback untuk rute di sisi klien
    try {
      stat = fs.statSync(file);
    } catch {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Frontend belum di-build.');
      return;
    }
  }

  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const isIndex = path.basename(file) === 'index.html';
  let cache = 'no-cache';
  if (rel.startsWith('/assets/')) cache = 'public, max-age=31536000, immutable';
  else if (rel.startsWith('/icons/')) cache = 'public, max-age=86400';

  if (isIndex) {
    const html = fs.readFileSync(file, 'utf8').replaceAll('{{APP_NAME}}', escapeHtml(config.appName));
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : html);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Cache-Control': cache });
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(file).pipe(res);
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * routes: [{ method, path:'/api/x/:id', auth?, limit?:{key,max,windowMs}, raw?, fn(ctx) }]
 * ctx: { req, res, query, params, body, ip, cookies, user, setCookie(name, value, {maxAge}) }
 */
export function createServer({ routes, authenticate }) {
  const compiled = routes.map((r) => {
    const keys = [];
    const re = new RegExp('^' + r.path.replace(/:([a-zA-Z]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
    return { ...r, re, keys };
  });

  async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    const pathname = url.pathname;
    securityHeaders(res);

    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end();
        return;
      }
      serveStatic(req, res, pathname);
      return;
    }

    let route = null;
    let params = {};
    let pathMatched = false;
    for (const r of compiled) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== req.method) continue;
      route = r;
      params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      break;
    }
    if (!route) throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'Metode tidak didukung.' : 'Tidak ketemu.');

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin) {
        let host = '';
        try {
          host = new URL(origin).host;
        } catch {
          /* origin aneh */
        }
        const allowed = [new URL(config.appUrl).host, req.headers['x-forwarded-host'], req.headers.host].filter(Boolean);
        if (!allowed.includes(host)) throw new HttpError(403, 'Permintaan ditolak.');
      }
    }

    const cookiesOut = [];
    const ctx = {
      req,
      res,
      query: Object.fromEntries(url.searchParams),
      params,
      body: null,
      ip: clientIp(req),
      cookies: parseCookies(req.headers.cookie),
      user: null,
      setCookie(name, value, { maxAge = 0 } = {}) {
        const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
        if (config.secureCookie) parts.push('Secure');
        cookiesOut.push(parts.join('; '));
      },
    };

    if (route.limit && !rateLimit(`${route.limit.key}:${ctx.ip}`, route.limit.max, route.limit.windowMs)) {
      throw new HttpError(429, 'Kebanyakan percobaan. Coba lagi beberapa menit lagi.');
    }
    if (route.auth) {
      ctx.user = authenticate(ctx);
      if (!ctx.user) throw new HttpError(401, 'Kamu belum masuk.');
    }
    if (!route.raw && req.method !== 'GET' && req.method !== 'HEAD') {
      const buf = await readBody(req);
      if (buf.length) {
        try {
          ctx.body = JSON.parse(buf.toString('utf8'));
        } catch {
          throw new HttpError(400, 'Format data salah.');
        }
      }
    }

    const result = await route.fn(ctx);
    if (route.raw) return;
    sendJson(res, 200, result ?? { ok: true }, cookiesOut);
  }

  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message });
      } else {
        console.error('[error]', err);
        sendJson(res, 500, { error: 'Servernya lagi bermasalah. Coba lagi sebentar.' });
      }
    });
  });
}
