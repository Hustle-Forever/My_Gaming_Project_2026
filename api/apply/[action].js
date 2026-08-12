// Vercel catch-all: one Serverless Function for the whole /api/apply/* group
// (the Hobby plan caps deployments at 12 functions). The real handlers are the
// `_`-prefixed files in this folder — Vercel ignores underscore-prefixed files,
// so they don't each become a function. The dev server routes to them directly.
const { sendErr } = require('../../lib/http');
const H = {
  config: require('./_config'),
  start: require('./_start'),
  answer: require('./_answer'),
  submit: require('./_submit'),
  resume: require('./_resume'),
};
module.exports = (req, res) => {
  const action = (req.query && req.query.action) || '';
  const h = H[action];
  if (typeof h !== 'function') return sendErr(res, 404, 'NOT_FOUND', 'not found');
  return h(req, res);
};
