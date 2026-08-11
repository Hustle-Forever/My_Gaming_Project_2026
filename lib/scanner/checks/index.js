// lib/scanner/checks/index.js - the pluggable check registry.
// Each check is { id, title, severity, run(model, ctx) -> [finding] }.
// Adding a check = drop a file here and list it. The orchestrator never
// changes. A finding is:
//   { checkId, severity, title:{en,ar}, why:{en,ar}, fix:{en,ar},
//     evidence:[{ resource?, file?, line?, detail }] }
module.exports = [
  require('./duplicates'),
  require('./missingDeps'),
  require('./loadOrder'),
  require('./structure'),
  require('./luaSyntax'),
  require('./riskSignals'),
  require('./performance'),
  require('./deadWeight'),
];
