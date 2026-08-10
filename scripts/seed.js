// scripts/seed.js - creates one tenant doc (active:true) so the platform is
// testable immediately. Run against the emulator with:
//   npm run seed:emulator
// or against production Firestore (FIREBASE_SERVICE_ACCOUNT set) with:
//   npm run seed -- --uid <firebase-auth-uid> --name "Customer RP"
require('dotenv').config();
const { createTenant, getTenant } = require('../lib/firestore');

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const uid = getArg('uid', 'seed-demo-tenant');
const name = getArg('name', 'Seed RP Server');
const verify = args.includes('--verify');

(async () => {
  const created = await createTenant(uid, { name, active: true });
  console.log(`[seed] wrote tenants/${uid} - active:true, bridgeToken: ${created.bridgeToken}`);

  if (verify) {
    const back = await getTenant(uid);
    const ok =
      back &&
      back.active === true &&
      back.name === created.name &&
      back.bridgeToken === created.bridgeToken &&
      Array.isArray(back.allowedActions) &&
      back.allowedActions.length === 6 &&
      back.providerKeyEnc === null;
    console.log(ok ? '[seed] ✅ read-back verified' : `[seed] ❌ read-back mismatch: ${JSON.stringify(back)}`);
    process.exit(ok ? 0 : 1);
  }
  process.exit(0);
})().catch((err) => {
  console.error(`[seed] ${err.message}`);
  process.exit(1);
});
