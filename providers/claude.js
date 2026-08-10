// providers/claude.js - STUB. The provider seam exists so Claude (or any
// other model) can drop in per tenant later: implement interpret/ask with
// @anthropic-ai/sdk using a forced tool whose enum comes from actions.js
// (the original demo backend, backend/claude.js, already shows exactly how).
// Until then, tenants with provider:"claude" fall back to the keyword matcher.
module.exports = {
  name: 'claude',
  async interpret() {
    throw new Error('claude provider is not implemented yet');
  },
  async ask() {
    throw new Error('claude provider is not implemented yet');
  },
};
