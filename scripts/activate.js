// scripts/activate.js - owner tool: flips a tenant's `active` flag (the
// pay-gate). This is the manual stand-in for Stripe; the webhook will set
// the same single boolean later.
//   node scripts/activate.js <uid-or-email>          -> active: true
//   node scripts/activate.js <uid-or-email> --off    -> active: false
// Run with FIREBASE_SERVICE_ACCOUNT set (production) or under the emulators.
require('dotenv').config();
const { auth } = require('../lib/firebase');
const { getTenant, updateTenant } = require('../lib/firestore');

(async () => {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const off = process.argv.includes('--off');
  const idOrEmail = positional[0];
  if (!idOrEmail) {
    console.error('usage: node scripts/activate.js <uid-or-email> [--off]');
    process.exit(1);
  }

  const uid = idOrEmail.includes('@') ? (await auth.getUserByEmail(idOrEmail)).uid : idOrEmail;
  const tenant = await getTenant(uid);
  if (!tenant) {
    console.error(`no tenant doc at tenants/${uid}`);
    process.exit(1);
  }

  await updateTenant(uid, { active: !off });
  console.log(`[activate] tenants/${uid} (${tenant.name}) active -> ${!off}`);
  process.exit(0);
})().catch((err) => {
  console.error(`[activate] ${err.message}`);
  process.exit(1);
});
