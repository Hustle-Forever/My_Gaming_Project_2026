// M6: concierge analytics. Pure aggregation over the append-only funnel events
// into the numbers the owner dashboard shows: onboarding funnel, retention,
// arrivals-by-day, and question themes. No network, no emulator.
const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregate, EMPTY } = require('../lib/concierge/analytics');

// A hand-built cohort with exact, checkable numbers.
// Two days; five arrivals; a range of drop-off points; one long-absence return.
const DAY_A = Date.UTC(2026, 7, 10, 12, 0, 0); // 2026-08-10
const DAY_B = Date.UTC(2026, 7, 11, 9, 30, 0); // 2026-08-11
const ev = (type, playerId, atMs, extra = {}) => ({ type, playerId, atMs, ...extra });

const EVENTS = [
  // p1 — full funnel, retained, asked about money
  ev('arrived', 'p1', DAY_A), ev('greeted', 'p1', DAY_A), ev('answered', 'p1', DAY_A),
  ev('reached', 'p1', DAY_A), ev('checkin', 'p1', DAY_A), ev('still_playing', 'p1', DAY_A),
  ev('question', 'p1', DAY_A, { theme: 'money' }),
  // p2 — reached + retained, no check-in yet
  ev('arrived', 'p2', DAY_A), ev('greeted', 'p2', DAY_A), ev('answered', 'p2', DAY_A),
  ev('reached', 'p2', DAY_A), ev('still_playing', 'p2', DAY_A),
  // p3 — answered then dropped, asked about money
  ev('arrived', 'p3', DAY_A), ev('greeted', 'p3', DAY_A), ev('answered', 'p3', DAY_A),
  ev('question', 'p3', DAY_A, { theme: 'money' }),
  // p4 — dismissed after greeting (day B)
  ev('arrived', 'p4', DAY_B), ev('greeted', 'p4', DAY_B), ev('dismissed', 'p4', DAY_B),
  // p5 — full funnel but NOT retained, asked how to start (day B)
  ev('arrived', 'p5', DAY_B), ev('greeted', 'p5', DAY_B), ev('answered', 'p5', DAY_B),
  ev('reached', 'p5', DAY_B), ev('checkin', 'p5', DAY_B),
  ev('question', 'p5', DAY_B, { theme: 'getting_started' }),
  // p6 — a long-absence returner (no fresh arrival)
  ev('returned', 'p6', DAY_B),
];

test('empty input yields a zeroed shape (safe for a fresh tenant)', () => {
  const a = aggregate([]);
  assert.deepEqual(a.funnel, EMPTY.funnel);
  assert.equal(a.totals.players, 0);
  assert.deepEqual(a.themes, []);
  assert.deepEqual(a.arrivalsByDay, []);
});

test('funnel counts unique players per stage', () => {
  const a = aggregate(EVENTS);
  assert.deepEqual(a.funnel, {
    arrived: 5, greeted: 5, answered: 4, reached: 3, checkin: 2, dismissed: 1,
  });
});

test('rates are fractions of arrivals', () => {
  const a = aggregate(EVENTS);
  assert.equal(a.rates.greet, 1);       // 5/5
  assert.equal(a.rates.answer, 0.8);    // 4/5
  assert.equal(a.rates.reach, 0.6);     // 3/5
  assert.equal(a.rates.checkin, 0.4);   // 2/5
  assert.equal(a.rates.dismiss, 0.2);   // 1/5
});

test('retention = still-playing over arrivals; returns counted separately', () => {
  const a = aggregate(EVENTS);
  assert.equal(a.retention.stillPlaying, 2);
  assert.equal(a.retention.returned, 1);
  assert.equal(a.retention.rate, 0.4); // 2/5
});

test('question themes are tallied and ranked', () => {
  const a = aggregate(EVENTS);
  assert.deepEqual(a.themes, [
    { theme: 'money', count: 2 },
    { theme: 'getting_started', count: 1 },
  ]);
});

test('arrivals bucket by UTC day, ascending, with retained count', () => {
  const a = aggregate(EVENTS);
  assert.deepEqual(a.arrivalsByDay, [
    { day: '2026-08-10', arrived: 3, stillPlaying: 2 },
    { day: '2026-08-11', arrived: 2, stillPlaying: 0 },
  ]);
});

test('totals reflect unique players and raw event volume', () => {
  const a = aggregate(EVENTS);
  assert.equal(a.totals.players, 6);
  assert.equal(a.totals.events, EVENTS.length);
});
