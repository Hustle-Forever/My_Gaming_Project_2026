// scripts/dev-server.js - local stand-in for Vercel. Mounts the /api functions
// with the same req/res helpers Vercel's Node runtime provides (res.status,
// res.json, parsed req.query) and serves app/ statically with the same
// rewrites as vercel.json. Production uses Vercel itself - never this file.
require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP_DIR = path.join(ROOT, 'app');
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

function serveStatic(res, pathname) {
  const rewrites = { '/': '/index.html', '/dashboard': '/dashboard.html' };
  const rel = rewrites[pathname] || pathname;
  const file = path.join(APP_DIR, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!file.startsWith(APP_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
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
    if (!res.headersSent) res.status(500).json({ error: 'internal error' });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`[dev-server] http://localhost:${PORT}  (app UI at /, dashboard at /dashboard)`);
  console.log(`[dev-server] emulators: firestore=${process.env.FIRESTORE_EMULATOR_HOST || 'NOT SET'} auth=${process.env.FIREBASE_AUTH_EMULATOR_HOST || 'NOT SET'}`);
});
