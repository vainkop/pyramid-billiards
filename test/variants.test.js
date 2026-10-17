// The same situations played under both games: the rules must differ exactly where
// the official rules differ, and agree everywhere else. Guards against one game's
// rules leaking into the other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match, VARIANT, HOUSE_LINE, FOOT_SPOT } from '../src/pyramid.js';
import { planShotNow, LEVELS } from '../src/ai.js';
import { seeded } from './helpers.js';

const players = [{ name: 'Ты', you: true }, { name: 'Компьютер' }];
const BOTH = [VARIANT.free, VARIANT.combined];

function position(variant, balls) {
  const m = new Match({ players, variant, random: seeded(1) });
  m.table.on.fill(false);
  for (const [i, x, y] of balls) m.table.place(i, x, y);
  Object.assign(m, { isBreak: false, ballInHand: false });
  return m;
}

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

const TABLE = [[0, 0.5, 1.2], [3, 0.5, 1], [7, 0.3, 0.4], [9, 0.7, 0.4]];

test('choosing the ball to strike: free — any ball; сибирка — only the coloured one', () => {
  assert.equal(position(VARIANT.free, TABLE).selectStriker(7), true);
  assert.equal(position(VARIANT.combined, TABLE).selectStriker(7), false);
});

test('a свояк: free — +1 and play on with another ball; сибирка — take a ball for the cue ball, then from hand', () => {
  const free = position(VARIANT.free, TABLE);
  finish(free, { firstHit: 3, potted: [3, 0] });
  assert.deepEqual(free.scores, [2, 0]);
  assert.equal(free.pending, null);
  assert.equal(free.ballInHand, false);
  assert.notEqual(free.strikerLabel, 0, 'a new striker is set up from the balls left');

  const sib = position(VARIANT.combined, TABLE);
  finish(sib, { firstHit: 3, potted: [3, 0] });
  assert.deepEqual(sib.scores, [1, 0]);
  assert.equal(sib.pending.kind, 'svoyak');
  sib.takeForSvoyak(7);
  assert.deepEqual(sib.scores, [2, 0], 'same points in the end');
  assert.equal(sib.ballInHand, true);
  assert.equal(sib.strikerLabel, 0, 'the coloured ball comes back');
});

test('a pot without свояк is the same in both games', () => {
  for (const v of BOTH) {
    const m = position(v, TABLE);
    finish(m, { firstHit: 3, potted: [3] });
    assert.deepEqual(m.scores, [1, 0], v);
    assert.equal(m.cur, 0, v);
    assert.equal(m.pending, null, v);
  }
});

test('a miss passes the turn in both games', () => {
  for (const v of BOTH) {
    const m = position(v, TABLE);
    finish(m, { firstHit: 3 });
    assert.equal(m.cur, 1, v);
    assert.equal(m.ballInHand, false, v);
  }
});

test('the same fouls in both games: no contact, a ball off the table, no cushion', () => {
  for (const v of BOTH) {
    for (const [shot, reason] of [
      [{ firstHit: -1 }, /не коснулся/],
      [{ firstHit: 3, jumped: [3] }, /вылетел/],
      [{ firstHit: 3, events: [] }, /без борта/],
    ]) {
      const m = position(v, TABLE);
      finish(m, shot);
      assert.match(m.message, reason, `${v}: ${reason}`);
      assert.equal(m.pending.kind, 'penalty', v);
    }
  }
});

test('the penalty ball: free — any ball, even the coloured one; сибирка — never the cue ball', () => {
  const free = position(VARIANT.free, TABLE);
  finish(free, { firstHit: -1 });
  assert.equal(free.takePenalty(0), true);

  const sib = position(VARIANT.combined, TABLE);
  finish(sib, { firstHit: -1 });
  assert.equal(sib.takePenalty(0), false);
  assert.equal(sib.takePenalty(7), true);
});

test('after a foul: in both the opponent chooses; only in сибирка a lost cue ball comes back from hand', () => {
  for (const v of BOTH) {
    const m = position(v, TABLE);
    finish(m, { firstHit: -1, potted: [0] });
    m.takePenalty(m.labels.indexOf(9));
    assert.deepEqual(m.options(), ['play', 'pass'], v);
    m.chooseNext('play');
    assert.equal(m.cur, 1, v);
    if (v === VARIANT.combined) {
      assert.equal(m.ballInHand, true);
      assert.ok(m.table.y[0] > HOUSE_LINE, 'from hand in the house');
    } else {
      assert.equal(m.ballInHand, false, 'free pyramid: no ball in hand after a foul');
      const coloured = m.labels.indexOf(0);
      assert.ok(Math.abs(m.table.x[coloured] - FOOT_SPOT.x) < 1e-9 && Math.abs(m.table.y[coloured] - FOOT_SPOT.y) < 1e-9,
        'the coloured ball dropped on a foul is respotted like any other');
    }
  }
});

test('hitting a ball in the house first is a foul only when playing from hand in сибирка', () => {
  const balls = [[0, 0.5, 1.9], [3, 0.5, 1.7], [4, 0.5, 0.8]];
  const sib = position(VARIANT.combined, balls);
  sib.ballInHand = true;
  finish(sib, { firstHit: 3 });
  assert.match(sib.message, /вне дома/);

  const free = position(VARIANT.free, balls);
  finish(free, { firstHit: 3 });
  assert.doesNotMatch(free.message, /Фол/);
});

test('the break is the same in both games', () => {
  for (const v of BOTH) {
    const m = new Match({ players, variant: v, random: seeded(4) });
    assert.equal(m.strikerLabel, 0, v);
    assert.equal(m.selectStriker(5), false, `${v}: no choice of ball on the break`);
    m.shoot(-Math.PI / 2, 0.2);
    m.table.runToRest();
    m.endShot();
    assert.equal(m.pending?.kind, 'penalty', `${v}: a soft break is a foul`);
  }
});

test('the variant survives saving and restoring', () => {
  for (const v of BOTH) {
    const back = Match.fromJSON(JSON.parse(JSON.stringify(position(v, TABLE))));
    assert.equal(back.variant, v);
  }
});

test('the computer follows the game it is playing', () => {
  // balls 3 and 5 lie on a straight line into the top-left corner: the obvious shot is 3 onto 5
  const d = Math.SQRT1_2;
  const balls = [[0, 0.5, 1.6], [5, 0.131, 0.131], [3, 0.131 + 0.15 * d * 2 ** 0.5 * d, 0.131 + 0.15 * d * 2 ** 0.5 * d], [7, 0.85, 1.2]];
  const free = position(VARIANT.free, balls);
  // here the coloured ball has the worst shot: in the free pyramid the computer takes a numbered ball
  assert.notEqual(planShotNow(free, LEVELS.master, { random: seeded(9), exact: true }).striker, 0, 'free: a numbered ball');
  const sib = position(VARIANT.combined, balls);
  assert.equal(planShotNow(sib, LEVELS.master, { random: seeded(9), exact: true }).striker, 0, 'сибирка: only the coloured ball');
});
