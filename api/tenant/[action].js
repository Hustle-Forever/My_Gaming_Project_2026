// Catch-all for /api/tenant/* (see api/apply/[action].js for why).
const { sendErr } = require('../../lib/http');
const H = {
  me: require('./_me'),
  key: require('./_key'),
  'rotate-bridge-token': require('./_rotate-bridge-token'),
};
module.exports = (req, res) => {
  const action = (req.query && req.query.action) || '';
  const h = H[action];
  if (typeof h !== 'function') return sendErr(res, 404, 'NOT_FOUND', 'not found');
  return h(req, res);
};
