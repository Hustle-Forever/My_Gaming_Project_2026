// scripts/dev-server.js - local stand-in for Vercel. Mounts the /api functions
// with the same req/res helpers Vercel's Node runtime provides (res.status,
// res.json, parsed req.query) and serves app/ + docs/ statically with the same
// rewrites and security headers as vercel.json. Production uses Vercel itself -
// never this file.
require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP_DIR = path.join(ROOT, 'app');
const DOCS_DIR = path.join(ROOT, 'docs');
const PORT = Number(process.env.PORT || 3000);

// pathname -> module path (lazy require so partially-built milestones still run)
const API_ROUTES = {
  '/api/health': './api/health',
  '/api/signup': './api/signup',
  '/api/command': './api/command',
  '/api/bridge/poll': './api/bridge/poll',
  '/api/bridge/ack': './api/bridge/ack',
  '/api/tenant/me': './api/tenant/me',
  '/api/tenant/key': './api/tenant/key',
  '/api/tenant/rotate-bridge-token': './api/tenant/rotate-bridge-token',
  '/api/stripe/webhook': './api/stripe/webhook',
  '/api/scan': './api/scan',
  '/api/scan-status': './api/scan-status',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Mirrors the `headers` section of vercel.json. The CSP allows exactly what
// the pages use: inline styles/scripts, the Firebase Auth SDK from gstatic,
// Google Fonts, and (dev only, harmless in prod) the local Auth emulator.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com http://127.0.0.1:9099 http://localhost:9099",
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join('; ');

function staticHeaders(res, isHtml) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  if (isHtml) {
    res.setHeader('content-security-policy', CSP);
    res.setHeader('permissions-policy', 'microphone=(self), camera=(), geolocation=()');
  }
}

function enhance(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  req.query = Object.fromEntries(url.searchParams);
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
  };
  return url.pathname;
}

function sendFile(res, file) {
  const isHtml = path.extname(file) === '.html';
  staticHeaders(res, isHtml);
  res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}

function serveStatic(res, pathname) {
  // /docs and /docs/* come from the repo's docs/ directory (like Vercel's
  // root static serving); everything else from app/.
  // Containment: resolve, then require the result to sit INSIDE the base dir
  // (base + separator — a bare prefix check would let /docs/../docs-evil pass).
  const contained = (base, rel) => {
    const file = path.resolve(base, rel.replace(/^([/\\])+/, ''));
    return file === base || file.startsWith(base + path.sep) ? file : null;
  };
  if (pathname === '/docs' || pathname === '/docs/') pathname = '/docs/index.html';
  if (pathname.startsWith('/docs/')) {
    const file = contained(DOCS_DIR, pathname.slice('/docs/'.length));
    if (file && fs.existsSync(file) && fs.statSync(file).isFile()) return sendFile(res, file);
    staticHeaders(res, false);
    return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'not found' } });
  }
  const rewrites = { '/': '/index.html', '/dashboard': '/dashboard.html' };
  const file = contained(APP_DIR, rewrites[pathname] || pathname);
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    staticHeaders(res, false);
    res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'not found' } });
    return;
  }
  sendFile(res, file);
}

const server = http.createServer(async (req, res) => {
  const pathname = enhance(req, res);
  try {
    if (API_ROUTES[pathname]) {
      const handler = require(path.join(ROOT, API_ROUTES[pathname]));
      await handler(req, res);
      return;
    }
    serveStatic(res, pathname);
  } catch (err) {
    console.error(`[dev-server] ${req.method} ${pathname}: ${err.stack || err.message}`);
    if (!res.headersSent) res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: 'internal error' } });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`[dev-server] http://localhost:${PORT}  (site+console at /, dashboard at /dashboard, showcase at /docs/)`);
  console.log(`[dev-server] emulators: firestore=${process.env.FIRESTORE_EMULATOR_HOST || 'NOT SET'} auth=${process.env.FIREBASE_AUTH_EMULATOR_HOST || 'NOT SET'}`);
});
