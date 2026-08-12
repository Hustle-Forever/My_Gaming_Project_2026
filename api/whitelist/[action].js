// Catch-all for /api/whitelist/* (see api/apply/[action].js for why).
const { sendErr } = require('../../lib/http');
const H = {
  config: require('./_config'),
  applications: require('./_applications'),
  decide: require('./_decide'),
  stats: require('./_stats'),
  'test-webhook': require('./_test-webhook'),
};
module.exports = (req, res) => {
  const action = (req.query && req.query.action) || '';
  const h = H[action];
  if (typeof h !== 'function') return sendErr(res, 404, 'NOT_FOUND', 'not found');
  return h(req, res);
};
