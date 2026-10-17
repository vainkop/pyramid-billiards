import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match, VARIANT, HOUSE_LINE, TEMP_HOUSE_LINE } from '../src/pyramid.js';
import { planShotNow, potCandidates, allowForThrow, LEVELS, choosePenaltyBall, chooseSvoyakBall, chooseNextOption } from '../src/ai.js';
import { Physics } from '../src/physics.js';
import { seeded } from './helpers.js';

const players = [{ name: 'Ты', you: true }, { name: 'Компьютер' }];

function position(balls, extra = {}) {
  const m = new Match({ players, variant: VARIANT.combined, random: seeded(1), ...extra });
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

test('only the coloured ball is struck (КП п.2)', () => {
  const m = position([[0, 0.5, 1.5], [3, 0.5, 1]]);
  assert.equal(m.selectStriker(3), false);
  assert.equal(m.strikerLabel, 0);
});

test('a legal свояк: the player takes an object ball for the cue ball and plays from hand (КП п.5.2)', () => {
  const m = position([[0, 0.5, 1.2], [3, 0.5, 1], [7, 0.3, 0.4], [9, 0.7, 0.4]]);
  finish(m, { firstHit: 3, potted: [3, 0] });
  assert.deepEqual(m.scores, [1, 0], 'the object ball counts now');
  assert.equal(m.pending.kind, 'svoyak');
  assert.equal(m.takeForSvoyak(7), true);
  assert.deepEqual(m.scores, [2, 0], 'the ball taken stands for the cue ball');
  assert.equal(m.table.on[7], false);
  assert.equal(m.ballInHand, true);
  assert.ok(m.table.on[0] && m.table.y[0] > HOUSE_LINE, 'cue ball back in the house');
  assert.equal(m.cur, 0, 'the same player continues');
});

test('from hand, hitting a ball inside the house first is a foul (КП п.6.6)', () => {
  const m = position([[0, 0.5, 1.9], [3, 0.5, 1.7], [4, 0.5, 0.8]]);
  m.ballInHand = true;
  finish(m, { firstHit: 3 });
  assert.match(m.message, /вне дома/);
  assert.equal(m.pending.kind, 'penalty');
});

test('from hand, the cue ball may not touch a ball in the house nor stand on the line (КП п.6.1)', () => {
  const m = position([[0, 0.5, 1.9], [3, 0.5, 1.7], [4, 0.5, 0.8]]);
  m.ballInHand = true;
  assert.equal(m.canPlaceStriker(0.5, 1.7 + 0.03), false, 'touching the ball in the house');
  assert.equal(m.canPlaceStriker(0.5, HOUSE_LINE), false, 'on the house line');
  assert.equal(m.canPlaceStriker(0.2, 1.8), true);
});

test('with every object ball in the house, play from the temporary house (КП п.6.6)', () => {
  const m = position([[0, 0.5, 1.9], [3, 0.3, 1.7], [4, 0.7, 1.8]]);
  m.ballInHand = true;
  assert.equal(m.tempHouse, true);
  assert.equal(m.canPlaceStriker(0.5, 1.6), false);
  assert.equal(m.canPlaceStriker(0.5, TEMP_HOUSE_LINE - 0.1), true);
});

test('the penalty ball is never the cue ball', () => {
  const m = position([[0, 0.5, 1.2], [3, 0.5, 1]]);
  finish(m, { firstHit: -1 });
  assert.equal(m.takePenalty(0), false);
  assert.equal(m.takePenalty(3), true);
  assert.deepEqual(m.scores, [0, 1]);
});

test('cue ball pocketed on a foul: after the penalty the player coming in plays from hand (КП п.7.2)', () => {
  const m = position([[0, 0.5, 1.2], [3, 0.5, 1], [5, 0.2, 0.5]]);
  finish(m, { firstHit: -1, potted: [0] });
  assert.equal(m.table.on[0], false, 'the cue ball is not respotted');
  m.takePenalty(5);
  m.chooseNext('play');
  assert.equal(m.cur, 1);
  assert.equal(m.ballInHand, true);
  assert.ok(m.table.on[0] && m.table.y[0] > HOUSE_LINE);
});

test('the break is the same as in the free pyramid (п.13)', () => {
  const m = new Match({ players, variant: VARIANT.combined, random: seeded(4) });
  assert.equal(m.isBreak, true);
  assert.equal(m.strikerLabel, 0);
  m.shoot(-Math.PI / 2, 0.2);
  m.table.runToRest();
  m.endShot();
  assert.equal(m.pending?.kind, 'penalty', 'a soft break is a foul');
});

test('state survives a JSON round trip with the variant', () => {
  const m = position([[0, 0.5, 1.2], [3, 0.5, 1]]);
  const back = Match.fromJSON(JSON.parse(JSON.stringify(m)));
  assert.equal(back.combined, true);
});

function play(m, random) {
  const plan = planShotNow(m, LEVELS.master, { random });
  assert.equal(plan.striker, 0, 'the computer only strikes the coloured ball');
  if (plan.place) {
    assert.ok(m.canPlaceStriker(plan.place.x, plan.place.y), 'a legal spot in the house');
    m.table.place(0, plan.place.x, plan.place.y);
  }
  m.shoot(plan.aim, plan.power, plan.ox, plan.oy, plan.elev);
  m.table.runToRest(30);
  m.endShot();
  if (m.pending?.kind === 'svoyak') m.takeForSvoyak(chooseSvoyakBall(m));
  if (m.pending?.kind === 'penalty') m.takePenalty(choosePenaltyBall(m));
  if (m.pending?.kind === 'choice') m.chooseNext(chooseNextOption(m));
}

test('computer-vs-computer сибирка games finish, with few fouls', () => {
  let shots = 0;
  let fouls = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const random = seeded(seed * 5);
    const m = new Match({ players, variant: VARIANT.combined, random });
    let n = 0;
    while (!m.over && n < 300) {
      play(m, random);
      n++;
      shots++;
      if (m.lastShot.foul) fouls++;
    }
    assert.ok(m.over, `seed ${seed}: ${m.scores} after ${n} shots`);
  }
  assert.ok(fouls / shots < 0.1, `${fouls} fouls in ${shots} shots`);
});

test('the computer finds a cut свояк: off the object ball, the cue ball runs along the tangent into a pocket', () => {
  // a fixed position (self-play is chaotic, so the skill is checked directly)
  const t = new Physics(2);
  t.place(0, 0.571, 0.844);
  t.place(1, 0.501, 1.04);
  const c = potCandidates(t, 0).find((x) => x.kind === 'свояк');
  assert.ok(c, 'a свояк is among the candidates');
  const sim = t.copy();
  sim.shoot(allowForThrow(t, c, c.spins[0]), c.power, 0, c.spins[0].oy, 0);
  sim.runToRest();
  assert.equal(sim.firstHit, 1);
  assert.ok(sim.potted.includes(0), 'the cue ball drops');
});
