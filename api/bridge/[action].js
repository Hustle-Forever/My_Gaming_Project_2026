// Catch-all for /api/bridge/* (see api/apply/[action].js for why).
const { sendErr } = require('../../lib/http');
const H = {
  poll: require('./_poll'),
  ack: require('./_ack'),
};
module.exports = (req, res) => {
  const action = (req.query && req.query.action) || '';
  const h = H[action];
  if (typeof h !== 'function') return sendErr(res, 404, 'NOT_FOUND', 'not found');
  return h(req, res);
};
