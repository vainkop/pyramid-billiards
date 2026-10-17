import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match, TARGET, HOUSE_LINE, FOOT_SPOT, PENALTY, shotFoul, legalBreak, properlyCompleted, pyramidPositions } from '../src/pyramid.js';
import { Physics, W, H, R } from '../src/physics.js';
import { seeded } from './helpers.js';

const players = [{ name: 'Ты', you: true }, { name: 'Компьютер' }];

/** A match after the break with only the listed balls [slot, x, y] on the table. */
function position(balls, extra = {}) {
  const m = new Match({ players, random: seeded(1), ...extra });
  m.table.on.fill(false);
  for (const [i, x, y] of balls) m.table.place(i, x, y);
  Object.assign(m, { isBreak: false, ballInHand: false });
  return m;
}

/** Pretend a shot happened with the given outcome. A legal-looking rail run is added unless told otherwise. */
function finish(m, { firstHit, potted = [], jumped = [], events = null }) {
  m.shoot(0, 0);
  const t = m.table;
  t.vx[0] = t.vy[0] = 0;
  t.firstHit = firstHit;
  for (const i of [...potted, ...jumped]) t.on[i] = false;
  t.potted = potted;
  t.jumped = jumped;
  t.events = events ?? [{ type: 'rail', ball: firstHit, rail: 'top' }, { type: 'rail', ball: firstHit, rail: 'left' }];
  m.endShot();
}

/** A bare table to test single-shot rules on. */
function events(list, { potted = [] } = {}) {
  const t = new Physics(16);
  t.firstHit = 1;
  t.potted = potted;
  t.jumped = [];
  t.events = list;
  return t;
}

// ------------------------------------------------------------ set-up

test('rack: pyramid apex on the back spot, coloured ball in the house', () => {
  const m = new Match({ players });
  assert.equal(m.table.on.filter(Boolean).length, 16);
  assert.equal(m.strikerLabel, 0);
  assert.ok(m.table.y[0] > HOUSE_LINE);
  assert.ok(Math.abs(m.table.y[1] - FOOT_SPOT.y) < 1e-9 && Math.abs(m.table.x[1] - FOOT_SPOT.x) < 1e-9);
});

test('the house line itself is outside the house (п.11.2)', () => {
  const m = new Match({ players });
  assert.equal(m.canPlaceStriker(0.5, HOUSE_LINE), false);
  assert.equal(m.canPlaceStriker(0.5, HOUSE_LINE + 0.05), true);
});

test('an incomplete pyramid keeps a symmetric base (п.9.3)', () => {
  for (const n of [9, 11, 12, 13, 14]) {
    const xs = pyramidPositions(n).map(([x]) => Math.round((x - W / 2) * 1e6) + 0).sort((a, b) => a - b);
    assert.equal(xs.length, n);
    assert.deepEqual(xs, xs.map((x) => -x + 0).sort((a, b) => a - b), `n=${n} is not symmetric`);
  }
});

// ------------------------------------------------------------ scoring

test('every ball dropped on a legal shot counts, the struck ball too (свояк)', () => {
  const m = position([[0, 0.5, 1.5], [3, 0.5, 1], [7, 0.2, 0.4]]);
  finish(m, { firstHit: 3, potted: [3, 0] });
  assert.deepEqual(m.scores, [2, 0]);
  assert.equal(m.cur, 0);
  assert.match(m.message, /свояк/i);
  assert.equal(m.table.on[0], true, 'a new ball is set up to strike');
});

test('nothing potted on a legal shot: the turn passes', () => {
  const m = position([[0, 0.5, 1.5], [3, 0.5, 1]]);
  finish(m, { firstHit: 3 });
  assert.equal(m.cur, 1);
  assert.equal(m.pending, null);
  assert.match(m.message, /Ход: Компьютер/);
});

test('reaching eight wins', () => {
  const m = position([[0, 0.5, 1.5], [3, 0.5, 1]]);
  m.scores = [TARGET - 1, 3];
  finish(m, { firstHit: 3, potted: [3] });
  assert.equal(m.winner, 0);
});

// ------------------------------------------------------------ fouls

test('missing every ball is a foul', () => {
  const m = position([[0, 0.5, 1.2], [3, 0.5, 1]]);
  finish(m, { firstHit: -1 });
  assert.match(m.message, /не коснулся/);
  assert.equal(m.pending.kind, 'penalty');
  assert.equal(m.pending.taker, 1);
});

test('a ball flying off the table is a foul and is respotted on the back spot (п.23.3, п.25.2)', () => {
  const m = position([[0, 0.5, 1.5], [3, 0.5, 1], [5, 0.2, 0.4]]);
  finish(m, { firstHit: 3, potted: [5], jumped: [3] });
  assert.match(m.message, /вылетел за борт/);
  assert.deepEqual(m.scores, [0, 0], 'the pot on a foul does not count');
  assert.equal(m.table.on[3], true);
  assert.equal(m.table.on[5], true);
  assert.ok(Math.abs(m.table.x[3] - W / 2) < 1e-9, 'respotted on the spot line');
});

test('both the cue ball and an object ball flying off is one foul', () => {
  const t = events([]);
  t.jumped = [0, 4];
  assert.match(shotFoul(t), /биток и прицельный/);
});

test('a dead shot with no cushion is a foul (п.20)', () => {
  const m = position([[0, 0.5, 1.5], [3, 0.5, 1]]);
  finish(m, { firstHit: 3, events: [] });
  assert.match(m.message, /без борта/);
});

test('п.20: what counts as a properly completed shot', () => {
  // one ball cushion → another cushion
  assert.ok(properlyCompleted(events([{ type: 'rail', ball: 1, rail: 'top' }, { type: 'rail', ball: 1, rail: 'left' }])));
  // the same cushion twice is not enough
  assert.ok(!properlyCompleted(events([{ type: 'rail', ball: 1, rail: 'top' }, { type: 'rail', ball: 1, rail: 'top' }])));
  // a single cushion is not enough
  assert.ok(!properlyCompleted(events([{ type: 'rail', ball: 1, rail: 'top' }])));
  // across the centre line, then a cushion
  assert.ok(properlyCompleted(events([{ type: 'cross', ball: 1 }, { type: 'rail', ball: 1, rail: 'top' }])));
  // a cushion, then across the centre line
  assert.ok(properlyCompleted(events([{ type: 'rail', ball: 1, rail: 'top' }, { type: 'cross', ball: 1 }])));
  // a ball that bounced off a cushion drives another ball to a different cushion
  assert.ok(properlyCompleted(events([
    { type: 'rail', ball: 1, rail: 'top' },
    { type: 'hit', a: 1, b: 2, ya: 0.5, yb: 0.6, frozenA: null, frozenB: null },
    { type: 'rail', ball: 2, rail: 'left' },
  ])));
  // … touches a ball resting against another cushion
  assert.ok(properlyCompleted(events([
    { type: 'rail', ball: 1, rail: 'top' },
    { type: 'hit', a: 1, b: 2, ya: 0.5, yb: 0.5, frozenA: null, frozenB: 'left' },
  ])));
  // a pot is always enough
  assert.ok(properlyCompleted(events([], { potted: [2] })));
});

test('п.13.1: a legal break needs a pot, three balls at cushions, or two plus one over the centre', () => {
  const rails = (...balls) => balls.map((b) => ({ type: 'rail', ball: b, rail: 'top' }));
  assert.ok(legalBreak(events(rails(3, 4, 5))));
  assert.ok(!legalBreak(events(rails(3, 4))));
  assert.ok(legalBreak(events([...rails(3, 4), { type: 'cross', ball: 6 }])));
  assert.ok(!legalBreak(events(rails(0, 0, 3))), 'the cue ball does not count');
  assert.ok(legalBreak(events([], { potted: [7] })));
});

test('a real full-power break is legal; a feather touch on the pyramid is not', () => {
  const firm = new Match({ players, random: seeded(4) });
  firm.shoot(Math.atan2(FOOT_SPOT.y - firm.table.y[0], FOOT_SPOT.x - firm.table.x[0]), 0.82, 0, 0.2);
  firm.table.runToRest();
  assert.equal(shotFoul(firm.table, { isBreak: true }), null);

  const soft = new Match({ players, random: seeded(4) });
  soft.shoot(Math.atan2(FOOT_SPOT.y - soft.table.y[0], FOOT_SPOT.x - soft.table.x[0]), 0.2);
  soft.table.runToRest();
  assert.match(shotFoul(soft.table, { isBreak: true }) ?? '', /разбой/);
});

test('only a near full-power stroke straight into a cushion makes the ball fly off', () => {
  const t = new Physics(1);
  t.place(0, 0.5, 0.15);
  t.shoot(-Math.PI / 2, 1);
  t.runToRest();
  assert.ok(t.jumped.length > 0);
  assert.equal(t.flights.length, 1, 'the flight is recorded so it can be drawn');
  assert.match(shotFoul(t), /вылетел|не коснулся/);
});

test('a firm shot into a cushion that misses every ball is played out until the ball stops', () => {
  for (const power of [0.5, 0.8, 0.9]) {
    const t = new Physics(2);
    t.place(0, 0.5, 1.0);
    t.place(1, 0.9, 1.8);
    t.shoot(-Math.PI / 2, power);
    t.runToRest();
    assert.equal(t.jumped.length, 0, `power ${power}`);
    assert.equal(t.on[0], true, `power ${power}: the cue ball stays on the table`);
    assert.equal(t.moving(), false);
    assert.match(shotFoul(t), /не коснулся/);
  }
});

// ------------------------------------------------------------ penalty and what follows

test('official penalty: the opponent takes any ball from the table (+1), then chooses who plays', () => {
  const m = position([[0, 0.5, 1.2], [3, 0.5, 1], [9, 0.3, 0.4]]);
  finish(m, { firstHit: -1 });
  assert.equal(m.takePenalty(2), false, 'only balls on the table');
  assert.equal(m.takePenalty(9), true);
  assert.deepEqual(m.scores, [0, 1]);
  assert.equal(m.table.on[9], false);
  assert.deepEqual(m.options(), ['play', 'pass']);
  m.chooseNext('pass');
  assert.equal(m.cur, 0, 'passed back to the offender');
  assert.equal(m.ballInHand, false, 'no ball in hand after a foul in the free pyramid');
});

test('the penalty ball can decide the game', () => {
  const m = position([[0, 0.5, 1.2], [3, 0.5, 1]]);
  m.scores = [2, TARGET - 1];
  finish(m, { firstHit: -1 });
  m.takePenalty(3);
  assert.equal(m.winner, 1);
});

test('club penalty: the offender puts their last ball back on the back spot', () => {
  const m = position([[0, 0.5, 1.2], [3, 0.5, 1]], { penalty: PENALTY.club });
  m.scores = [2, 0];
  m.pocketed = [[5, 9], []];
  finish(m, { firstHit: -1 });
  assert.deepEqual(m.scores, [1, 0]);
  assert.deepEqual(m.pocketed[0], [5]);
  const slot = m.labels.indexOf(9);
  assert.equal(m.table.on[slot], true);
  assert.ok(Math.abs(m.table.x[slot] - FOOT_SPOT.x) < 1e-9 && Math.abs(m.table.y[slot] - FOOT_SPOT.y) < 1e-9);
  assert.equal(m.pending.kind, 'choice');
});

test('after a faulty break the opponent may also re-rack (п.13.2)', () => {
  const m = new Match({ players, random: seeded(2) });
  m.shoot(-Math.PI / 2, 0.2);
  m.table.runToRest();
  m.endShot();
  assert.equal(m.pending?.kind, 'penalty');
  m.takePenalty(m.labels.indexOf(15));
  assert.deepEqual(m.options(), ['play', 'pass', 'rerack-self', 'rerack-pass']);
  m.chooseNext('rerack-pass');
  assert.equal(m.cur, 0, 'the offender breaks again');
  assert.equal(m.isBreak, true);
  assert.equal(m.strikerLabel, 0, 'the coloured ball breaks');
  assert.equal(m.table.on.filter(Boolean).length, 15);
});

test('respotting several balls lines them up from the back spot towards the back cushion (п.25.2)', () => {
  const m = position([[0, 0.5, 1.5]]);
  m.respot([4, 5, 6]);
  const ys = [4, 5, 6].map((i) => m.table.y[i]).sort((a, b) => b - a);
  assert.ok(Math.abs(ys[0] - FOOT_SPOT.y) < 1e-9);
  assert.ok(ys[1] < ys[0] && ys[2] < ys[1], 'towards the back cushion');
  assert.ok(Math.abs(ys[0] - ys[1] - 2 * R) < 0.01, 'next to each other');
});

test('state survives a JSON round trip, including a pending decision', () => {
  const m = position([[0, 0.5, 1.5], [3, 0.2, 1]]);
  m.selectStriker(3);
  m.scores = [4, 2];
  finish(m, { firstHit: -1 });
  const back = Match.fromJSON(JSON.parse(JSON.stringify(m)));
  assert.deepEqual(back.scores, [4, 2]);
  assert.equal(back.strikerLabel, 3);
  assert.equal(back.pending.kind, 'penalty');
});
