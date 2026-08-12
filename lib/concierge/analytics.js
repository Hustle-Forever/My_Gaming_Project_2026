// lib/concierge/analytics.js - pure aggregation over the concierge funnel
// events into the numbers the owner dashboard renders. No network, no clock:
// give it the raw event list and it returns a stable, zero-safe summary.
//
// Event types (recorded by lib/concierge/runtime.js):
//   arrived, greeted, answered, reached, checkin  (the onboarding funnel)
//   still_playing                                  (10-min retention marker)
//   returned                                       (long-absence return)
//   dismissed                                      (player waved us off)
//   question { theme }                             (coarse interest, no raw chat)

const FUNNEL = ['arrived', 'greeted', 'answered', 'reached', 'checkin'];

const EMPTY = {
  funnel: { arrived: 0, greeted: 0, answered: 0, reached: 0, checkin: 0, dismissed: 0 },
  rates: { greet: 0, answer: 0, reach: 0, checkin: 0, dismiss: 0 },
  retention: { stillPlaying: 0, returned: 0, rate: 0 },
  themes: [],
  arrivalsByDay: [],
  totals: { players: 0, events: 0 },
};

// unique-player counter keyed by event type
function uniqueByType(events) {
  const sets = new Map();
  for (const e of events) {
    if (!e || !e.type) continue;
    if (!sets.has(e.type)) sets.set(e.type, new Set());
    if (e.playerId != null) sets.get(e.type).add(String(e.playerId));
  }
  return (type) => (sets.get(type) ? sets.get(type).size : 0);
}

function dayKey(atMs) {
  if (!atMs) return null;
  return new Date(atMs).toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function ratio(n, d) { return d > 0 ? Math.round((n / d) * 1000) / 1000 : 0; }

function aggregate(events, _opts = {}) {
  const list = Array.isArray(events) ? events.filter(Boolean) : [];
  if (!list.length) return { ...EMPTY, funnel: { ...EMPTY.funnel }, rates: { ...EMPTY.rates }, retention: { ...EMPTY.retention }, themes: [], arrivalsByDay: [], totals: { players: 0, events: 0 } };

  const count = uniqueByType(list);
  const arrived = count('arrived');
  const funnel = {
    arrived,
    greeted: count('greeted'),
    answered: count('answered'),
    reached: count('reached'),
    checkin: count('checkin'),
    dismissed: count('dismissed'),
  };

  const rates = {
    greet: ratio(funnel.greeted, arrived),
    answer: ratio(funnel.answered, arrived),
    reach: ratio(funnel.reached, arrived),
    checkin: ratio(funnel.checkin, arrived),
    dismiss: ratio(funnel.dismissed, arrived),
  };

  const stillPlaying = count('still_playing');
  const retention = { stillPlaying, returned: count('returned'), rate: ratio(stillPlaying, arrived) };

  // themes: tally all question events, rank desc (ties: alphabetical for stability)
  const themeCounts = new Map();
  for (const e of list) {
    if (e.type === 'question' && e.theme) themeCounts.set(e.theme, (themeCounts.get(e.theme) || 0) + 1);
  }
  const themes = [...themeCounts.entries()]
    .map(([theme, c]) => ({ theme, count: c }))
    .sort((a, b) => (b.count - a.count) || a.theme.localeCompare(b.theme));

  // arrivals + retained, bucketed by UTC day, ascending
  const byDay = new Map(); // day -> { arrived:Set, still:Set }
  for (const e of list) {
    if (e.type !== 'arrived' && e.type !== 'still_playing') continue;
    const day = dayKey(e.atMs);
    if (!day) continue;
    if (!byDay.has(day)) byDay.set(day, { arrived: new Set(), still: new Set() });
    const bucket = byDay.get(day);
    if (e.type === 'arrived') bucket.arrived.add(String(e.playerId));
    else bucket.still.add(String(e.playerId));
  }
  const arrivalsByDay = [...byDay.entries()]
    .map(([day, b]) => ({ day, arrived: b.arrived.size, stillPlaying: b.still.size }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const players = new Set(list.map((e) => (e.playerId != null ? String(e.playerId) : null)).filter(Boolean));

  return {
    funnel,
    rates,
    retention,
    themes,
    arrivalsByDay,
    totals: { players: players.size, events: list.length },
  };
}

module.exports = { aggregate, EMPTY, FUNNEL };
