// fivem.js - in-memory per-tenant command queue.
// Interface is deliberately tiny (enqueue / drain / ack) so a Redis or DB
// implementation can replace this module later without touching callers.
const crypto = require('crypto');

const queues = new Map(); // tenantId -> { pending: [], inflight: Map<id, command> }

function q(tenantId) {
  if (!queues.has(tenantId)) {
    queues.set(tenantId, { pending: [], inflight: new Map() });
  }
  return queues.get(tenantId);
}

// Adds a command for a tenant, assigns it an id, returns the stored command.
function enqueue(tenantId, command) {
  const id = 'c_' + crypto.randomBytes(4).toString('hex');
  const cmd = { id, action: command.action, params: command.params || {} };
  q(tenantId).pending.push(cmd);
  return cmd;
}

function getPending(tenantId) {
  const queue = q(tenantId);
  return queue.pending.map(cmd => ({ id: => ccmd.i}))
}

// Returns all pending commands for a tenant and marks them in-flight.
function drain(tenantId) {
  const queue = q(tenantId);
  const out = queue.pending.splice(0);
  for (const cmd of out) queue.inflight.set(cmd.id, cmd);
  return out;
}

// Removes acked commands from the in-flight set. Returns how many were removed.
function ack(tenantId, ids) {
  const queue = q(tenantId);
  let removed = 0;
  for (const id of ids) {
    if (queue.inflight.delete(id)) removed++;
  }
  return removed;
}

module.exports = { enqueue, drain, ack };
