'use strict';

/**
 * Gounari & Nyberg — marketing site server.
 *
 * Zero dependencies: static file serving + a JSON endpoint for the
 * contact form. Run with `npm start` (or `npm run dev` to auto-reload).
 */

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const INQUIRIES_FILE = path.join(DATA_DIR, 'inquiries.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

const IMMUTABLE = new Set(['.jpg', '.jpeg', '.png', '.webp', '.svg', '.woff2', '.ico']);

/* ------------------------------------------------------------------ */
/* Contact submissions                                                 */
/* ------------------------------------------------------------------ */

const MAX_BODY_BYTES = 16 * 1024;
const RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 5 };
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_LIMIT.windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear(); // crude memory guard
  return recent.length > RATE_LIMIT.max;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const clean = (value, max) => String(value == null ? '' : value).trim().slice(0, max);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validate(payload) {
  const inquiry = {
    name: clean(payload.name, 120),
    email: clean(payload.email, 160),
    company: clean(payload.company, 160),
    topic: clean(payload.topic, 80),
    message: clean(payload.message, 4000)
  };

  const errors = {};
  if (inquiry.name.length < 2) errors.name = 'Please tell us your name.';
  if (!EMAIL_RE.test(inquiry.email)) errors.email = 'Please enter a valid email address.';
  if (inquiry.message.length < 10) errors.message = 'A sentence or two about your challenge helps.';
  // Honeypot: real people never fill this in.
  if (clean(payload.website, 200) !== '') errors.website = 'Rejected.';

  return { inquiry, errors };
}

async function saveInquiry(inquiry) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  let existing = [];
  try {
    existing = JSON.parse(await fsp.readFile(INQUIRIES_FILE, 'utf8'));
    if (!Array.isArray(existing)) existing = [];
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const record = { id: crypto.randomUUID(), receivedAt: new Date().toISOString(), ...inquiry };
  existing.push(record);
  await fsp.writeFile(INQUIRIES_FILE, JSON.stringify(existing, null, 2) + '\n', 'utf8');
  return record;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

async function handleContact(req, res) {
  const ip = req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip)) {
    return sendJson(res, 429, {
      ok: false,
      message: 'Too many messages from this address. Please email us directly.'
    });
  }

  let payload;
  try {
    payload = JSON.parse((await readBody(req)) || '{}');
  } catch (err) {
    return sendJson(res, err.status === 413 ? 413 : 400, {
      ok: false,
      message: 'We could not read that submission.'
    });
  }

  const { inquiry, errors } = validate(payload);
  if (Object.keys(errors).length) {
    // Silently accept honeypot hits so bots learn nothing.
    if (errors.website) return sendJson(res, 200, { ok: true, message: 'Thank you — we will be in touch.' });
    return sendJson(res, 422, { ok: false, errors, message: 'Please check the highlighted fields.' });
  }

  try {
    const record = await saveInquiry(inquiry);
    console.log(
      `[inquiry] ${record.receivedAt} — ${record.name} <${record.email}>` +
        (record.company ? ` · ${record.company}` : '')
    );
    return sendJson(res, 201, {
      ok: true,
      message: `Thanks, ${inquiry.name.split(' ')[0]} — we have your note and will reply within one business day.`
    });
  } catch (err) {
    console.error('[inquiry] failed to save:', err);
    return sendJson(res, 500, {
      ok: false,
      message: 'Something went wrong on our side. Please email hello@gounarinyberg.co.'
    });
  }
}

/* ------------------------------------------------------------------ */
/* Static files                                                        */
/* ------------------------------------------------------------------ */

function resolveStatic(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const candidate = path.resolve(PUBLIC_DIR, relative);
  // Never serve anything outside public/.
  if (candidate !== PUBLIC_DIR && !candidate.startsWith(PUBLIC_DIR + path.sep)) return null;
  return candidate;
}

function serveStatic(req, res, pathname) {
  const filePath = resolveStatic(pathname);
  if (!filePath) return sendError(res, 403, 'Forbidden');

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) return streamFile(req, res, path.join(filePath, 'index.html'));
    if (err) {
      // Pretty URLs: /approach -> /approach.html
      if (!path.extname(filePath)) return streamFile(req, res, filePath + '.html');
      return sendError(res, 404, 'Not found');
    }
    streamFile(req, res, filePath);
  });
}

function streamFile(req, res, filePath) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return sendError(res, 404, 'Not found');

    const ext = path.extname(filePath).toLowerCase();
    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag });
      return res.end();
    }

    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      ETag: etag,
      'Cache-Control': IMMUTABLE.has(ext) ? 'public, max-age=604800' : 'public, max-age=0, must-revalidate',
      'X-Content-Type-Options': 'nosniff'
    });

    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath)
      .on('error', () => res.end())
      .pipe(res);
  });
}

function sendError(res, status, message) {
  const notFoundPage = path.join(PUBLIC_DIR, '404.html');
  if (status === 404 && fs.existsSync(notFoundPage)) {
    const body = fs.readFileSync(notFoundPage);
    res.writeHead(404, { 'Content-Type': MIME['.html'], 'Content-Length': body.length });
    return res.end(body);
  }
  res.writeHead(status, { 'Content-Type': MIME['.txt'] });
  res.end(`${status} ${message}\n`);
}

/* ------------------------------------------------------------------ */

const server = http.createServer((req, res) => {
  let pathname;
  try {
    ({ pathname } = new URL(req.url, `http://${req.headers.host || 'localhost'}`));
  } catch {
    return sendError(res, 400, 'Bad request');
  }

  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (pathname === '/api/contact') {
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' });
      return res.end();
    }
    return handleContact(req, res);
  }

  if (pathname === '/healthz') return sendJson(res, 200, { ok: true, uptime: process.uptime() });

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Gounari & Nyberg site running at http://${HOST}:${PORT}\n`);
});
