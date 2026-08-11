// lib/serverAccess/ftpAdapter.js - DOCUMENTED STUB.
//
// The FTP/SFTP path would let an owner grant read-only credentials so M2 can
// pull resources/ + server.cfg directly. It is deliberately NOT implemented:
// storing third-party server credentials is a security decision that waits on
// the human (see TASK_M2_SCANNER §3). When built it must:
//   * store credentials encrypted at rest (lib/crypto), scoped to the tenant
//   * connect read-only; never issue STOR/DELE/RNFR/MKD/RMD
//   * return the SAME adapter contract as the other sources
//   * enforce the same byte/entry caps and text-only rule
//
// Until then it fails clearly rather than guessing.
function ftpAdapter() {
  const e = new Error('NOT_IMPLEMENTED: ftpAdapter is a documented stub - credential storage is a pending human decision');
  e.code = 'NOT_IMPLEMENTED';
  throw e;
}

module.exports = { ftpAdapter };
