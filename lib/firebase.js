// lib/firebase.js - single Firebase Admin initialization for every function.
// Production (Vercel): FIREBASE_SERVICE_ACCOUNT holds the service-account JSON.
// Local: the Firebase emulators are detected via FIRESTORE_EMULATOR_HOST /
// FIREBASE_AUTH_EMULATOR_HOST (set automatically by `firebase emulators:exec`),
// and no credentials are needed.
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const projectId =
    process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'demo-m2';
  const usingEmulators =
    Boolean(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST);
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (serviceAccount && !usingEmulators) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(serviceAccount)),
      projectId,
    });
  } else {
    admin.initializeApp({ projectId });
  }
}

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

module.exports = { admin, db, auth: admin.auth() };
