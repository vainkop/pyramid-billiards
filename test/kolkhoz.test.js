import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nets, transfers, KolkhozSession, SETTLE, rub, MIN_PLAYERS } from '../src/kolkhoz.js';
import { Match, VARIANT } from '../src/pyramid.js';
import { planShotNow, LEVELS, chooseSvoyakBall } from '../src/ai.js';
import { W, H } from '../src/physics.js';
import { seeded } from './helpers.js';

const sum = (a) => a.reduce((x, y) => x + y, 0);

test('ring: your points minus the next player\'s, adding up to zero', () => {
  assert.deepEqual(nets([3, 2, 4]), [1, -2, 1]);
  assert.deepEqual(nets([5, 6, 5], SETTLE.ring), [-1, 1, 0]);
  const random = seeded(3);
  for (let k = 0; k < 50; k++) {
    const pts = Array.from({ length: 3 + (k % 6) }, () => Math.round(random() * 12) - 2);
    assert.equal(sum(nets(pts, SETTLE.ring)), 0);
    assert.equal(sum(nets(pts, SETTLE.all)), 0);
  }
});

test('everyone with everyone: N·p − Σp, the «малая пирамида» formula (p − 10)·N − 120', () => {
  assert.deepEqual(nets([4, 6, 5], SETTLE.all), [-3, 3, 0]);
  // three players share 150 points: (очки − 10) × 3 − 120
  const pts = [60, 50, 40];
  assert.deepEqual(nets(pts, SETTLE.all), pts.map((p) => (p - 10) * 3 - 120));
});

test('transfers settle every balance in at most n − 1 payments', () => {
  assert.deepEqual(transfers([-300, 100, 200]), [{ from: 0, to: 2, amount: 200 }, { from: 0, to: 1, amount: 100 }]);
  assert.deepEqual(transfers([0, 0, 0]), []);
  const random = seeded(7);
  for (let k = 0; k < 100; k++) {
    const n = 3 + (k % 6);
    const bal = Array.from({ length: n - 1 }, () => Math.round(random() * 20 - 10) * 50);
    bal.push(-sum(bal));
    const pay = transfers(bal);
    assert.ok(pay.length <= n - 1, `${pay.length} payments for ${n}`);
    const got = bal.map(() => 0);
    for (const t of pay) {
      assert.ok(t.amount > 0);
      got[t.from] -= t.amount;
      got[t.to] += t.amount;
    }
    assert.deepEqual(got, bal.map((b) => b + 0));
  }
});

test('a round: 15 balls, the last one counts double, fouls cost the offender', () => {
  const s = new KolkhozSession({ players: ['Аня', 'Боря', 'Вова'], price: 100 });
  assert.equal(s.breaker, 0);
  for (let k = 0; k < 14; k++) s.pot(k % 3);
  assert.equal(s.remaining, 1);
  assert.ok(s.lastBallNext);
  assert.equal(s.valueOf(), 2);
  s.foul(1);
  assert.equal(s.remaining, 1, 'a foul is no ball');
  s.pot(2);
  assert.ok(s.roundComplete);
  assert.equal(s.pot(0), false, 'no balls left');
  // Аня 5, Боря 5 − 1, Вова 4 + 2
  assert.deepEqual(s.roundPoints(), [5, 4, 6]);
  assert.deepEqual(s.totals(), [1, -2, 1]);
  assert.deepEqual(s.money(s.totals()), [100, -200, 100]);
  assert.deepEqual(s.settlement(), [{ from: 1, to: 0, amount: 100 }, { from: 1, to: 2, amount: 100 }]);

  s.undo();
  assert.ok(!s.roundComplete);
  s.pot(2);
  s.endRound();
  assert.equal(s.breaker, 1, 'the next player breaks the next round');
  assert.deepEqual(s.roundPoints(), [0, 0, 0]);
  assert.deepEqual(s.totals(), [1, -2, 1]);
  assert.ok(s.reopenRound());
  assert.ok(s.roundComplete);
});

test('special balls and session settings', () => {
  const s = new KolkhozSession({
    players: ['А', 'Б', 'В', 'Г'], balls: 3, lastDouble: false, foul: 2, price: 50, settle: SETTLE.all,
    extras: [{ name: 'Красный', value: 3 }],
  });
  s.pot(0, 1); // красный
  s.pot(1);
  s.pot(2);
  s.foul(3);
  assert.deepEqual(s.roundPoints(), [3, 1, 1, -2]);
  assert.deepEqual(s.totals(), [9, 1, 1, -11]);
  assert.equal(sum(s.money(s.totals())), 0);
  assert.throws(() => new KolkhozSession({ players: ['А', 'Б'] }), new RegExp(String(MIN_PLAYERS)));
});

test('the session survives saving, and the report reads well', () => {
  const s = new KolkhozSession({ players: ['Аня', 'Боря', 'Вова'], price: 1500 });
  s.pot(0);
  s.pot(0);
  s.pot(1);
  s.endRound();
  s.pot(2);
  const copy = KolkhozSession.fromJSON(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(copy.totals(), s.totals());
  assert.equal(copy.breaker, 1);
  const text = copy.report();
  assert.match(text, /2 партии/);
  assert.match(text, /Аня: \+1 очко = \+1 500 ₽/);
  assert.match(text, /→/);
  assert.equal(rub(-12.5), '−12,50 ₽');
  assert.equal(rub(1234567), '1 234 567 ₽');
});

// ---------------------------------------------------------------- колхоз on the virtual table

const three = [{ name: 'Ты', you: true }, { name: 'Петрович', ai: 'amateur' }, { name: 'Михалыч', ai: 'amateur' }];

function position(balls, extra = {}) {
  const m = new Match({ players: three, random: seeded(1), kolkhoz: {}, ...extra });
  m.table.on.fill(false);
  for (const [i, x, y] of balls) m.table.place(i, x, y);
  Object.assign(m, { isBreak: false, ballInHand: false });
  return m;
}

function finish(m, { firstHit, potted = [], jumped = [] }) {
  m.shoot(0, 0);
  const t = m.table;
  t.vx[0] = t.vy[0] = 0;
  t.firstHit = firstHit;
  for (const i of [...potted, ...jumped]) t.on[i] = false;
  t.potted = potted;
  t.jumped = jumped;
  t.events = [{ type: 'rail', ball: firstHit, rail: 'top' }, { type: 'rail', ball: firstHit, rail: 'left' }];
  m.endShot();
}

const spread = (n) => Array.from({ length: n }, (_, i) => [i, 0.15 + (i % 5) * 0.2, 0.3 + Math.floor(i / 5) * 0.4]);

test('колхоз: the turn goes round the table', () => {
  const m = position(spread(6));
  assert.equal(m.scores.length, 3);
  finish(m, { firstHit: 1 });
  assert.equal(m.cur, 1);
  finish(m, { firstHit: 1 });
  assert.equal(m.cur, 2);
  finish(m, { firstHit: 1 });
  assert.equal(m.cur, 0);
});

test('колхоз: a foul costs the offender a point and passes the turn — no penalty ball', () => {
  const m = position(spread(6));
  m.cur = 1;
  finish(m, { firstHit: -1 });
  assert.equal(m.pending, null);
  assert.deepEqual(m.scores, [0, -1, 0]);
  assert.equal(m.cur, 2);
  assert.match(m.message, /Петрович теряет 1 очко/);
  assert.deepEqual(m.nets, [1, -1, 0]);
});

test('колхоз in сибирка: the round ends with the last object ball, which counts double', () => {
  const m = position([[0, W / 2, H * 0.8], [1, W / 2, H * 0.3], [2, 0.2, 0.4]], { variant: VARIANT.combined });
  m.cur = 2;
  finish(m, { firstHit: 1, potted: [1] });
  assert.ok(!m.over);
  assert.equal(m.ballsLeft, 1);
  finish(m, { firstHit: 2, potted: [2] });
  assert.ok(m.over);
  assert.equal(m.lastBall, 2);
  assert.deepEqual(m.scores, [0, 0, 3]);
  assert.equal(m.winner, 2);
  assert.match(m.message, /за два/);
});

test('колхоз in the free pyramid: a lone ball left ends the round', () => {
  const m = position([[0, W / 2, H * 0.8], [1, W / 2, H * 0.3], [2, 0.2, 0.4]], { kolkhoz: { lastDouble: false } });
  finish(m, { firstHit: 1, potted: [2] });
  assert.ok(!m.over, 'two balls left: one can still be potted with the other');
  m.cur = 0;
  finish(m, { firstHit: 1, potted: [1] });
  assert.ok(m.over);
  assert.equal(m.ballsLeft, 0);
  assert.deepEqual(m.scores, [2, 0, 0]);
  assert.deepEqual(m.nets, [2, 0, -2]);
});

test('колхоз survives saving, and the computer can plan in it', () => {
  const m = new Match({ players: three, kolkhoz: { foul: 2 }, random: seeded(2) });
  const copy = Match.fromJSON(JSON.parse(JSON.stringify(m)));
  assert.equal(copy.kolkhoz.foul, 2);
  assert.equal(copy.players.length, 3);
  assert.equal(copy.name, 'Колхоз · американка');
  const plan = planShotNow(copy, LEVELS.novice, { random: seeded(4) });
  assert.equal(plan.kind, 'разбой');
});

test('колхоз: computers with колхоз tactics play a whole round to the end', () => {
  const random = seeded(11);
  const players = [0, 1, 2].map((i) => ({ name: `P${i}`, ai: 'amateur' }));
  const m = new Match({ players, kolkhoz: {}, random });
  const kinds = new Set();
  let shots = 0;
  while (!m.over && shots < 300) {
    if (m.pending) {
      m.takeForSvoyak(chooseSvoyakBall(m));
      continue;
    }
    const plan = planShotNow(m, LEVELS.amateur, { random });
    kinds.add(plan.kind);
    if (plan.striker !== 0) m.selectStriker(plan.striker);
    if (plan.place) m.table.place(0, plan.place.x, plan.place.y);
    m.shoot(plan.aim, plan.power, plan.ox, plan.oy, plan.elev);
    m.table.runToRest(30);
    m.endShot();
    shots++;
  }
  assert.ok(m.over, `round over after ${shots} shots`);
  assert.equal(sum(m.nets), 0);
  assert.ok(kinds.has('отыгрыш'), 'a risky pot is sometimes passed up for a safety against the next player');
});
