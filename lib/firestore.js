// lib/firestore.js - all Firestore access for the platform.
// Data model:
//   tenants/{uid}                    one doc per customer (uid = Firebase Auth uid)
//   tenants/{uid}/commands/{cmdId}   the per-tenant command queue
// Queue statuses: "pending" -> "inflight" (on poll) -> deleted (on ack).
const crypto = require('crypto');
const { admin, db } = require('./firebase');

const FieldValue = admin.firestore.FieldValue;
const tenants = db.collection('tenants');

const DEFAULT_ACTIONS = ['spawn_vehicle', 'set_weather', 'set_time', 'heal_player', 'spawn_npc', 'repair_vehicle'];

function newBridgeToken() {
  return 'brg_' + crypto.randomBytes(24).toString('hex');
}

async function getTenant(uid) {
  const snap = await tenants.doc(uid).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

// Bridge auth: exact-match lookup on the random 51-char token.
async function getTenantByBridgeToken(token) {
  if (!token || typeof token !== 'string') return null;
  const snap = await tenants.where('bridgeToken', '==', token).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function createTenant(uid, { name, provider = 'gemini', active = false }) {
  const doc = {
    name: String(name || 'My server').slice(0, 80),
    active: Boolean(active),           // the pay-gate; Stripe flips this later
    subscriptionStatus: 'manual',      // Stripe seam: becomes the Stripe status later
    provider,
    providerKeyEnc: null,              // customer's AI key, AES-GCM encrypted
    bridgeToken: newBridgeToken(),
    allowedActions: DEFAULT_ACTIONS,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await tenants.doc(uid).set(doc);
  return { id: uid, ...doc };
}

async function updateTenant(uid, patch) {
  await tenants.doc(uid).update({ ...patch, updatedAt: FieldValue.serverTimestamp() });
}

async function enqueueCommand(uid, action, params) {
  const ref = await tenants.doc(uid).collection('commands').add({
    action,
    params: params || {},
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
  });
  return { id: ref.id, action, params: params || {} };
}

// Returns pending commands (oldest first) and marks them inflight.
// No orderBy in the query so no composite index is ever required.
async function drainCommands(uid) {
  const col = tenants.doc(uid).collection('commands');
  const snap = await col.where('status', '==', 'pending').limit(20).get();
  if (snap.empty) return [];

  const batch = db.batch();
  const out = [];
  snap.forEach((doc) => {
    out.push({
      id: doc.id,
      action: doc.get('action'),
      params: doc.get('params') || {},
      createdAt: doc.get('createdAt'),
    });
    batch.update(doc.ref, { status: 'inflight', polledAt: FieldValue.serverTimestamp() });
  });
  await batch.commit();

  out.sort((a, b) => {
    const ta = a.createdAt ? a.createdAt.toMillis() : 0;
    const tb = b.createdAt ? b.createdAt.toMillis() : 0;
    return ta - tb;
  });
  return out.map(({ id, action, params }) => ({ id, action, params }));
}

// Per-tenant fixed-window rate limit for /api/command, stored ON the tenant
// doc so it holds across serverless instances (in-memory counters die with
// each invocation). One transactional read-modify-write per command; the
// tenant doc is small and already read every request, so this is cheap.
async function allowCommand(uid, limitPerMinute) {
  const ref = tenants.doc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const now = Date.now();
    const windowStart = Number(snap.get('rlWindowStart') || 0);
    const count = Number(snap.get('rlCount') || 0);
    if (now - windowStart >= 60_000) {
      tx.update(ref, { rlWindowStart: now, rlCount: 1 });
      return true;
    }
    if (count >= limitPerMinute) return false;
    tx.update(ref, { rlCount: count + 1 });
    return true;
  });
}

async function ackCommands(uid, ids) {
  const clean = (Array.isArray(ids) ? ids : []).slice(0, 50).map(String);
  if (!clean.length) return 0;
  const col = tenants.doc(uid).collection('commands');
  const batch = db.batch();
  clean.forEach((id) => batch.delete(col.doc(id)));
  await batch.commit();
  return clean.length;
}

module.exports = {
  DEFAULT_ACTIONS,
  newBridgeToken,
  getTenant,
  getTenantByBridgeToken,
  createTenant,
  updateTenant,
  enqueueCommand,
  drainCommands,
  ackCommands,
  allowCommand,
};
