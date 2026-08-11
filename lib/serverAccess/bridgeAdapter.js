// lib/serverAccess/bridgeAdapter.js - server-access over the FiveM bridge.
//
// The bridge's read-only scan_* commands (fivem-bridge/scan.lua) stream the
// server's resource list and text files outward to the backend. Once that
// payload has been collected it has the exact shape of a scan-pack, so the
// bridge adapter is the scan-pack adapter fed by bridge data. This keeps ONE
// scanner path: however the files arrived, the analysis is identical.
//
// Collection (bridge command round-trips) is orchestrated elsewhere; this
// module turns a collected { files:[{path,content,size}] } payload into the
// standard read-only adapter. It exposes no write path - by construction it
// only ever holds already-read text.
const { fromScanPack } = require('./index');

function fromBridgePayload(payload, opts = {}) {
  const adapter = fromScanPack(payload, opts);
  adapter.source = 'bridge';
  adapter.capabilities = { ...adapter.capabilities, live: true };
  return adapter;
}

module.exports = { fromBridgePayload };
