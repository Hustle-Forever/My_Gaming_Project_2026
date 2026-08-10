// GET /api/health - liveness + dependency detail, no secrets.
// firestore: a 1-doc read against the real database ("ok"/"error").
// config: which required env pieces are PRESENT (booleans only, never values).
const { db } = require('../lib/firebase');
const { endpoint } = require('../lib/http');

module.exports = endpoint(['GET'], async (req, res) => {
  let firestore = 'ok';
  try {
    await Promise.race([
      db.collection('tenants').limit(1).get(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500)),
    ]);
  } catch (_) {
    firestore = 'error';
  }
  res.status(200).json({
    ok: firestore === 'ok',
    firestore,
    provider: process.env.PROVIDER || 'gemini',
    config: {
      serviceAccount: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT),
      encryptionKey: /^[0-9a-fA-F]{64}$/.test(process.env.ENCRYPTION_KEY || ''),
    },
  });
});
