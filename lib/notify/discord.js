// lib/notify/discord.js - optional Discord webhook delivery, behind a clean
// interface so other channels can be added later. Webhooks only (no bot).
// Every function is safe to call unconfigured (no-op) and never throws into
// the caller's request path.
const https = require('https');

function postWebhook(url, payload) {
  return new Promise((resolve) => {
    if (!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(String(url || ''))) return resolve({ ok: false, error: 'invalid webhook' });
    let data;
    try { data = JSON.stringify(payload); } catch (_) { return resolve({ ok: false, error: 'bad payload' }); }
    let req;
    try {
      req = https.request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (r) => {
        r.resume();
        resolve({ ok: r.statusCode >= 200 && r.statusCode < 300, status: r.statusCode });
      });
    } catch (_) { return resolve({ ok: false, error: 'request failed' }); }
    req.on('error', () => resolve({ ok: false, error: 'network' }));
    req.setTimeout(4000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(data);
    req.end();
  });
}

const RECS = { approve: 3066993, reject: 15158332, review: 15844367, reinterview: 3447003 };

function identityLine(identity) {
  return Object.entries(identity || {}).map(([k, v]) => `**${k}:** ${v}`).join('  ·  ') || '—';
}

// New submission card.
async function notifyNewApplication(config, { appId, identity, overall, summary, status }) {
  const url = config && config.discordWebhook;
  if (!url) return { ok: false, skipped: true };
  const reviewUrl = `${process.env.PUBLIC_BASE_URL || ''}/dashboard#whitelist`;
  return postWebhook(url, {
    username: 'M2 Whitelist Officer',
    embeds: [{
      title: `New application · score ${overall}/100`,
      color: RECS.review,
      description: `${identityLine(identity)}\n\n${String(summary || '').slice(0, 300)}`,
      fields: [{ name: 'Status', value: status, inline: true }, { name: 'Review', value: reviewUrl || 'open the dashboard', inline: true }],
      footer: { text: `application ${appId}` },
    }],
  });
}

// Decision outcome post.
async function notifyDecision(config, { identity, decision, decidedBy }) {
  const url = (config && (config.decisionWebhook || config.discordWebhook)) || '';
  if (!url) return { ok: false, skipped: true };
  return postWebhook(url, {
    username: 'M2 Whitelist Officer',
    embeds: [{ title: `Application ${decision}`, color: RECS[decision] || RECS.review, description: `${identityLine(identity)}\n\nDecided by ${decidedBy || 'admin'}.` }],
  });
}

// Test-send from the dashboard "verify webhook" button.
async function testSend(url) {
  return postWebhook(url, { username: 'M2 Whitelist Officer', content: '✅ Webhook connected — M2 will post new applications here.' });
}

module.exports = { notifyNewApplication, notifyDecision, testSend, postWebhook };
