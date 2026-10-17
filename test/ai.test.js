import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/pyramid.js';
import { planShotNow, potCandidates, LEVELS, choosePenaltyBall, chooseSvoyakBall, chooseNextOption } from '../src/ai.js';
import { seeded } from './helpers.js';

const players = [{ name: 'А' }, { name: 'Б' }];

function play(m, plan) {
  if (plan.striker !== 0) m.selectStriker(plan.striker);
  if (plan.place) m.table.place(0, plan.place.x, plan.place.y);
  m.shoot(plan.aim, plan.power, plan.ox, plan.oy, plan.elev);
  m.table.runToRest(30);
  m.endShot();
  // the opponent of a foul decides like the computer would
  if (m.pending?.kind === 'svoyak') m.takeForSvoyak(chooseSvoyakBall(m));
  if (m.pending?.kind === 'penalty') m.takePenalty(choosePenaltyBall(m));
  if (m.pending?.kind === 'choice') m.chooseNext(chooseNextOption(m));
}

test('a master without aim error pots almost every clean two-ball position', () => {
  const random = seeded(5);
  let tries = 0;
  let pots = 0;
  for (let k = 0; k < 80; k++) {
    const m = new Match({ players, random });
    m.table.on.fill(false);
    m.table.place(0, 0.1 + random() * 0.8, 0.15 + random() * 1.7);
    m.table.place(4, 0.1 + random() * 0.8, 0.15 + random() * 1.7);
    if (!m.table.isFree(m.table.x[4], m.table.y[4], 4)) continue;
    Object.assign(m, { isBreak: false, ballInHand: false });
    if (!potCandidates(m.table, 0).length && !potCandidates(m.table, 4).length) continue;
    tries++;
    const before = m.scores[0];
    play(m, planShotNow(m, LEVELS.master, { random, exact: true }));
    if (m.scores[0] > before) pots++;
  }
  assert.ok(tries > 30 && pots / tries > 0.85, `${pots}/${tries}`);
});

test('the computer uses follow to pot two balls at once when it can', () => {
  const m = new Match({ players, random: seeded(2) });
  m.table.on.fill(false);
  m.table.place(0, 0.3, 0.6);
  m.table.place(7, 0.12, 0.12 + 0.18); // straight below the corner pocket line... any slight angle is fine
  Object.assign(m, { isBreak: false, ballInHand: false });
  const plan = planShotNow(m, LEVELS.master, { random: seeded(3), exact: true });
  play(m, plan);
  assert.ok(m.scores[0] >= 1, `plan ${JSON.stringify(plan)}`);
});

test('computer-vs-computer games finish', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const random = seeded(seed);
    const m = new Match({ players, random });
    let shots = 0;
    while (!m.over && shots < 250) {
      play(m, planShotNow(m, seed % 2 ? LEVELS.amateur : LEVELS.master, { random }));
      shots++;
    }
    assert.ok(m.over, `seed ${seed}: ${m.scores} after ${shots} shots`);
  }
});

test('the computer rarely fouls: its trial shots are judged by the same rules', () => {
  let shots = 0;
  let fouls = 0;
  for (let seed = 1; seed <= 4; seed++) {
    const random = seeded(seed * 11);
    const m = new Match({ players, random });
    while (!m.over && shots < 400) {
      play(m, planShotNow(m, LEVELS.master, { random }));
      shots++;
      if (m.lastShot.foul) fouls++;
    }
  }
  assert.ok(fouls / shots < 0.08, `${fouls} fouls in ${shots} shots`);
});
