const { applyCors } = require('../lib/http');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  res.status(200).json({ ok: true });
};
