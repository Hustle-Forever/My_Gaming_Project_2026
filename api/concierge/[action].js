// Vercel catch-all: one Serverless Function for the whole /api/concierge/*
// group (Hobby 12-function cap). Real handlers are the _-prefixed files,
// which Vercel ignores; the dev server routes to them directly.
const { sendErr } = require('../../lib/http');
const H = {
  config: require('./_config'),
  event: require('./_event'),
  reply: require('./_reply'),
  stats: require('./_stats'),
};
module.exports = (req, res) => {
  const action = (req.query && req.query.action) || '';
  const h = H[action];
  if (typeof h !== 'function') return sendErr(res, 404, 'NOT_FOUND', 'not found');
  return h(req, res);
};
