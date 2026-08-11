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

// Liveness stamps (lastPolledAt/firstCommandAt) are written as Date.now()
// numbers; normalize defensively in ONE place in case a Firestore Timestamp
// ever lands in those fields. Returns epoch ms or null.
function stampMs(v) {
  if (v && typeof v.toMillis === 'function') return v.toMillis();
  return typeof v === 'number' ? v : null;
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
// each invocation). The transaction's read doubles as THE tenant read for
// the request - one billed read per command, not two. Inactive tenants are
// returned without consuming quota (the pay-gate rejects them anyway).
async function getTenantAndCountCommand(uid, limitPerMinute) {
  const ref = tenants.doc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { tenant: null, allowed: false };
    const tenant = { id: snap.id, ...snap.data() };
    if (!tenant.active) return { tenant, allowed: true };
    const now = Date.now();
    const windowStart = Number(snap.get('rlWindowStart') || 0);
    const count = Number(snap.get('rlCount') || 0);
    if (now - windowStart >= 60_000) {
      tx.update(ref, { rlWindowStart: now, rlCount: 1 });
      return { tenant, allowed: true };
    }
    if (count >= limitPerMinute) return { tenant, allowed: false };
    tx.update(ref, { rlCount: count + 1 });
    return { tenant, allowed: true };
  });
}

// Per-IP fixed-window signup throttle (mass account creation). Keyed by a
// SHA-256 hash of the client IP - raw IPs are never stored. Docs carry
// expireAt so an optional Firestore TTL policy on rl_ip self-cleans them.
async function allowSignup(ipHash, limitPerHour) {
  const ref = db.collection('rl_ip').doc(ipHash);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const windowStart = snap.exists ? Number(snap.get('windowStart') || 0) : 0;
    const count = snap.exists ? Number(snap.get('count') || 0) : 0;
    if (now - windowStart >= 3_600_000) {
      tx.set(ref, { windowStart: now, count: 1, expireAt: new Date(now + 7_200_000) });
      return true;
    }
    if (count >= limitPerHour) return false;
    tx.update(ref, { count: count + 1 });
    return true;
  });
}

// Per-tenant scan rate limit (fixed window, per hour) on its own doc fields
// so it's independent of the /api/command limiter.
async function allowScan(uid, limitPerHour) {
  const ref = tenants.doc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const now = Date.now();
    const windowStart = Number(snap.get('rlScanWindowStart') || 0);
    const count = Number(snap.get('rlScanCount') || 0);
    if (now - windowStart >= 3_600_000) {
      tx.update(ref, { rlScanWindowStart: now, rlScanCount: 1 });
      return true;
    }
    if (count >= limitPerHour) return false;
    tx.update(ref, { rlScanCount: count + 1 });
    return true;
  });
}

// Scans live under tenants/{uid}/scans/{scanId}. We store the derived report
// (identity + findings + structural model) - NEVER raw customer source.
async function createScan(uid, report, meta = {}) {
  const col = tenants.doc(uid).collection('scans');
  const ref = await col.add({
    status: 'complete',
    source: meta.source || 'upload',
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: Date.now(),
    identity: report.identity,
    health: report.health,
    findings: report.findings,
    model: report.model,
  });
  return ref.id;
}

async function getScan(uid, scanId) {
  const snap = await tenants.doc(uid).collection('scans').doc(scanId).get();
  return snap.exists ? { scanId: snap.id, ...snap.data() } : null;
}

// History: newest first, summaries only (no findings/model payload).
async function listScans(uid, limit = 20) {
  const snap = await tenants.doc(uid).collection('scans').limit(50).get();
  const rows = snap.docs.map((d) => ({
    scanId: d.id,
    createdAtMs: d.get('createdAtMs') || 0,
    source: d.get('source'),
    health: d.get('health'),
    framework: (d.get('identity') && d.get('identity').framework && d.get('identity').framework.framework) || 'unknown',
  }));
  rows.sort((a, b) => b.createdAtMs - a.createdAtMs);
  return rows.slice(0, limit);
}

// ---- Whitelist Officer ----
const wlDefaults = () => require('./whitelist/config');

// Config lives at tenants/{uid}/whitelist/config. A slug is assigned on first
// read and kept stable; the public lookup uses a top-level whitelistSlugs
// collection ({slug} -> uid) for O(1) resolution and uniqueness.
async function getWhitelistConfig(uid, tenantName) {
  const { DEFAULTS, slugify, randomSuffix, publicView } = wlDefaults();
  const ref = tenants.doc(uid).collection('whitelist').doc('config');
  const snap = await ref.get();
  let data = snap.exists ? snap.data() : {};
  if (!data.slug) {
    data.slug = await assignSlug(uid, slugify(tenantName), randomSuffix);
    await ref.set({ slug: data.slug, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  const merged = { ...DEFAULTS, ...data, slug: data.slug };
  merged.publicView = publicView(merged, tenantName);
  return merged;
}

async function assignSlug(uid, base, randomSuffix) {
  const slugs = db.collection('whitelistSlugs');
  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${randomSuffix()}`;
    const ref = slugs.doc(candidate);
    const ok = await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (s.exists && s.get('uid') !== uid) return false;
      tx.set(ref, { uid, updatedAt: FieldValue.serverTimestamp() });
      return true;
    });
    if (ok) return candidate;
  }
  return `${base}-${randomSuffix()}${randomSuffix()}`;
}

async function setWhitelistConfig(uid, validatedPatch) {
  const ref = tenants.doc(uid).collection('whitelist').doc('config');
  await ref.set({ ...validatedPatch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

async function getTenantBySlug(slug) {
  const snap = await db.collection('whitelistSlugs').doc(String(slug)).get();
  return snap.exists ? snap.get('uid') : null;
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
  stampMs,
  getTenant,
  getTenantByBridgeToken,
  createTenant,
  updateTenant,
  enqueueCommand,
  drainCommands,
  ackCommands,
  getTenantAndCountCommand,
  allowSignup,
  allowScan,
  createScan,
  getScan,
  listScans,
  getWhitelistConfig,
  setWhitelistConfig,
  getTenantBySlug,
};
