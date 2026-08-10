// POST /api/stripe/webhook - STRIPE SEAM, deliberately not implemented yet.
// The `active` boolean on tenants/{uid} is the single pay-gate everywhere.
// When payments land, this endpoint will: verify the Stripe signature,
// map the customer to a tenant, and set { active, subscriptionStatus }
// from subscription events. Nothing else in the codebase changes.
// Until then activation is manual: node scripts/activate.js <uid-or-email>
module.exports = async (req, res) => {
  res.status(501).json({ error: 'payments not wired yet - activation is manual for now' });
};
