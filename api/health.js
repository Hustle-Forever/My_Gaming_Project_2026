// GET /api/health - liveness + dependency detail, no secrets.
// firestore: a 1-doc read against the real database ("ok"/"error").
// config: which required env pieces are PRESENT (booleans only, never values).
// lib/firebase is required INSIDE the handler: a malformed
// FIREBASE_SERVICE_ACCOUNT must degrade this endpoint to firestore:"error",
// not crash the one route that exists to diagnose that misconfiguration.
const { endpoint } = require('../lib/http');

module.exports = endpoint(['GET', 'HEAD'], async (req, res) => {
  let firestore = 'ok';
  let timer = null;
  try {
    const { db } = require('../lib/firebase');
    await Promise.race([
      db.collection('tenants').limit(1).get(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 2500); }),
    ]);
  } catch (_) {
    firestore = 'error';
  } finally {
    clearTimeout(timer);
  }
  // 503 when the database is unreachable so status-code monitors (and the
  // test harness's readiness loop) get a real signal, not a healthy-looking 200.
  res.status(firestore === 'ok' ? 200 : 503).json({
    ok: firestore === 'ok',
    firestore,
    provider: process.env.PROVIDER || 'gemini',
    config: {
      serviceAccount: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT),
      encryptionKey: /^[0-9a-fA-F]{64}$/.test(process.env.ENCRYPTION_KEY || ''),
    },
  });
});
