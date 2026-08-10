// POST /api/stripe/webhook - STRIPE SEAM, deliberately not implemented yet.
// The `active` boolean on tenants/{uid} is the single pay-gate everywhere.
// When payments land, this endpoint will: verify the Stripe signature,
// map the customer to a tenant, and set { active, subscriptionStatus }
// from subscription events. Nothing else in the codebase changes.
// (Open access today: signup creates active:true; flipping that default
// back is the only change needed to start charging.)
const { endpoint, sendErr } = require('../../lib/http');

module.exports = endpoint(['POST', 'GET'], async (req, res) => {
  return sendErr(res, 501, 'NOT_IMPLEMENTED', 'payments not wired yet - accounts are active on signup');
});
