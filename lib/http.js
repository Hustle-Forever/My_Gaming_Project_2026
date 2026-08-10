// lib/http.js - request/response helpers that behave identically under
// Vercel's Node runtime (req.body pre-parsed, res.status/json helpers) and
// the local dev server (scripts/dev-server.js installs the same shims).

function safeParse(text) {
  try {
    return JSON.parse(text || '{}');
  } catch (_) {
    return {};
  }
}

async function readJson(req) {
  if (req.body !== undefined && req.body !== null) {
    return typeof req.body === 'string' ? safeParse(req.body) : req.body;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return safeParse(Buffer.concat(chunks).toString('utf8'));
}

// Permissive CORS so the app can be hosted separately from the API if needed.
// Returns true when the request was a preflight and has been fully handled.
function applyCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-bridge-token');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

module.exports = { readJson, applyCors };
