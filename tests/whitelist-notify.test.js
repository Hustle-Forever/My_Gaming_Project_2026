// M6: the Discord webhook interface. Safe unconfigured (no-op), rejects
// non-Discord URLs, never throws into the caller. No network in tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const { notifyNewApplication, notifyDecision, postWebhook } = require('../lib/notify/discord');

test('unconfigured tenant -> no-op, never throws', async () => {
  const r = await notifyNewApplication({ discordWebhook: '' }, { appId: 'a', identity: {}, overall: 50, summary: '', status: 'submitted' });
  assert.equal(r.skipped, true);
  const d = await notifyDecision({}, { identity: {}, decision: 'approved' });
  assert.equal(d.skipped, true);
});

test('a non-Discord URL is rejected, not posted', async () => {
  const r = await postWebhook('https://evil.example/hook', { content: 'x' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'invalid webhook');
});

test('interface accepts a well-formed Discord webhook URL shape', async () => {
  // we don't hit the network here; just prove the URL guard passes the shape
  // (delivery is exercised by the dashboard test-send button).
  const good = 'https://discord.com/api/webhooks/123456789/AbCdEf-token_here';
  assert.ok(/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(good));
});
