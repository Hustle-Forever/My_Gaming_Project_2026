// lib/http.js - request/response spine shared by every API function.
// Behaves identically under Vercel's Node runtime (req.body pre-parsed,
// res.status/json helpers) and the local dev server (which installs the same
// shims). Provides:
//   - endpoint(methods, fn): wrapper giving every route the same security
//     headers, request id, method check, error envelope, and crash handling
//   - HttpError / sendErr: the ONE error shape: { ok:false, error:{code,message} }
//   - readJson: body parsing with a hard size cap (413 PAYLOAD_TOO_LARGE)
// Error codes the frontend switches on:
//   BAD_INPUT, AUTH_REQUIRED, PLAN_INACTIVE, NOT_FOUND, METHOD_NOT_ALLOWED,
//   EMAIL_TAKEN, PAYLOAD_TOO_LARGE, RATE_LIMITED, INTERNAL, NOT_IMPLEMENTED
const crypto = require('crypto');

const MAX_BODY_BYTES = 64 * 1024; // no legitimate request comes close

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sendErr(res, status, code, message) {
  return res.status(status).json({ ok: false, error: { code, message } });
}

function safeParse(text) {
  // Handlers destructure the body as a plain object; JSON literals like
  // `null`, `"str"`, `5`, or `[...]` must normalize to {} instead of crashing
  // property reads into a 500.
  try {
    const parsed = JSON.parse(text || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

async function readJson(req) {
  // Fast size gate for both paths: trust content-length when present (Vercel
  // has already buffered pre-parsed bodies; re-serializing them to measure
  // would be O(body) waste on every request).
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > MAX_BODY_BYTES) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `request body exceeds ${MAX_BODY_BYTES} bytes`);
  }
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return safeParse(req.body);
    return typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  }
  // Streaming path (dev server): enforce the cap incrementally so an
  // oversized or lying client is cut off mid-read.
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `request body exceeds ${MAX_BODY_BYTES} bytes`);
    }
    chunks.push(chunk);
  }
  return safeParse(Buffer.concat(chunks).toString('utf8'));
}

// Security headers + request id on every API response. CORS is SAME-ORIGIN
// by default: no Access-Control-* headers are emitted unless ALLOWED_ORIGIN
// is set (to a single origin, or "*" for a deliberately public API). The
// FiveM bridge is server-side Lua - CORS never applies to it.
function applySecurity(req, res) {
  const requestId = crypto.randomUUID();
  res.setHeader('x-request-id', requestId);
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('cache-control', 'no-store');

  const allowed = process.env.ALLOWED_ORIGIN || '';
  if (allowed) {
    const origin = String(req.headers.origin || '');
    const value = allowed === '*' ? '*' : (origin === allowed ? allowed : '');
    if (value) {
      res.setHeader('access-control-allow-origin', value);
      res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
      res.setHeader('access-control-allow-headers', 'Content-Type, Authorization, x-bridge-token');
    }
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return { requestId, done: true };
  }
  return { requestId, done: false };
}

// Structured single-line JSON logs keyed by request id. NEVER pass tokens,
// keys, or raw Authorization material into `fields`.
function makeLogger(requestId, req) {
  const base = { rid: requestId, method: req.method, path: String(req.url || '').split('?')[0] };
  return (level, fields) => {
    const line = JSON.stringify({ level, ...base, ...fields });
    (level === 'error' ? console.error : console.log)(line);
  };
}

function endpoint(methods, fn) {
  return async (req, res) => {
    const sec = applySecurity(req, res);
    if (sec.done) return;
    const log = makeLogger(sec.requestId, req);
    if (!methods.includes(req.method)) {
      return sendErr(res, 405, 'METHOD_NOT_ALLOWED', `method not allowed - use ${methods.join(' or ')}`);
    }
    try {
      await fn(req, res, { requestId: sec.requestId, log });
    } catch (err) {
      if (err instanceof HttpError) return sendErr(res, err.status, err.code, err.message);
      log('error', { msg: 'unhandled', err: err.message });
      return sendErr(res, 500, 'INTERNAL', 'internal error');
    }
  };
}

module.exports = { MAX_BODY_BYTES, HttpError, sendErr, readJson, applySecurity, endpoint };
