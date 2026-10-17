import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Physics, R, POCKETS, cueFor } from '../src/physics.js';
import { aimThrough } from '../src/aim.js';
import { predictStrikerPath } from '../src/predict.js';

const deg = (a) => (a * 180) / Math.PI;

/**
 * Cue ball straight up the table at an object ball, `b` (in R) off the line of
 * centres: 0 is a full hit, 1 a half-ball hit. `gap` is the run before contact.
 */
function setup(b, gap) {
  const t = new Physics(2);
  t.place(0, 0.5 + b * R, 1.0 + 2 * R + gap);
  t.place(1, 0.5, 1.0);
  return t;
}

/** Object ball's departure off the line of centres at contact, degrees (positive = towards +x). */
function throwOf(b, power, ox, oy, gap) {
  const t = setup(b, gap);
  t.shoot(-Math.PI / 2, power, ox, oy, 0);
  for (let f = 0; f < 4000 && t.moving() && t.firstHit < 0; f++) t.step(1 / 480);
  return deg(Math.atan2(t.vy[1], t.vx[1]) - Math.atan2(t.y[1] - t.y[0], t.x[1] - t.x[0]));
}

test('cut-induced throw: a few degrees on a slow sliding cut, less when hard or rolling (ЭОПШ)', () => {
  const slow = Math.abs(throwOf(1, 0.12, 0, 0, 0.012));
  const hard = Math.abs(throwOf(1, 0.5, 0, 0, 0.012));
  const rolling = Math.abs(throwOf(1, 0.12, 0, 0.667, 0.3));
  assert.ok(slow > 3 && slow < 7.5, `slow ${slow.toFixed(2)}°`);
  assert.ok(hard < slow * 0.6, `hard ${hard.toFixed(2)}° vs slow ${slow.toFixed(2)}°`);
  assert.ok(rolling < slow * 0.7, `rolling ${rolling.toFixed(2)}° vs sliding ${slow.toFixed(2)}°`);
});

test('the throw sends the object ball along with the cue ball, i.e. the cut plays thinner', () => {
  // the cue ball is to the right of the line of centres, so it moves off to the right: the object ball goes left of it
  const t = setup(1, 0.012);
  t.shoot(-Math.PI / 2, 0.12, 0, 0, 0);
  for (let f = 0; f < 4000 && t.firstHit < 0; f++) t.step(1 / 480);
  const centres = Math.atan2(t.y[1] - t.y[0], t.x[1] - t.x[0]);
  const dir = Math.atan2(t.vy[1], t.vx[1]);
  // the line of centres points up and to the left; the cue ball slides past it up and to the
  // right, and the rub drags the object ball round that way (clockwise on screen)
  assert.ok(dir - centres > 0.03, `thrown by ${deg(dir - centres).toFixed(2)}°`);
});

test('side spin throws the object ball on a full hit, the opposite way to the spin (about 2–5°)', () => {
  const right = throwOf(0, 0.12, 0.54, 0, 0.012); // ~11 mm right of centre
  const left = throwOf(0, 0.12, -0.54, 0, 0.012);
  assert.ok(Math.abs(right) > 2 && Math.abs(right) < 6, `right ${right.toFixed(2)}°`);
  assert.ok(Math.sign(right) === -Math.sign(left) && Math.abs(right + left) < 0.2, 'mirror image');
  assert.ok(Math.abs(throwOf(0, 0.12, 0, 0, 0.012)) < 0.01, 'no throw without spin');
});

test('roll-out angle of a rolling cue ball: ≈14° at 7 mm off full, at most ≈33° near half-ball (Салентур)', () => {
  const rollOut = (bmm) => {
    const t = setup(bmm / 34, 0.3);
    t.shoot(-Math.PI / 2, 0.3, 0, 0.667, 0);
    let hit = false;
    for (let f = 0; f < 8000 && t.moving(); f++) {
      t.step(1 / 480);
      if (t.firstHit >= 0) hit = true;
      if (hit && Math.hypot(t.vx[0] - t.rx[0], t.vy[0] - t.ry[0]) < 1e-3) return Math.abs(deg(Math.atan2(t.vx[0], -t.vy[0])));
    }
    return NaN;
  };
  const a7 = rollOut(7);
  assert.ok(a7 > 11.5 && a7 < 16, `7 mm: ${a7.toFixed(1)}°`);
  let max = 0;
  for (let mm = 20; mm <= 45; mm += 2) max = Math.max(max, rollOut(mm));
  assert.ok(max > 31 && max < 35, `max ${max.toFixed(1)}°`);
});

test('an off-centre hit starts the ball slower: about 11 % at 14 mm above the centre', () => {
  const speed = (oy) => {
    const t = new Physics(1);
    t.place(0, 0.5, 1.5);
    t.shoot(-Math.PI / 2, 0.5, 0, oy, 0);
    return -t.vy[0];
  };
  const loss = 1 - speed(14 / 34 / 0.6) / speed(0);
  assert.ok(loss > 0.08 && loss < 0.16, `${(loss * 100).toFixed(1)} %`);
});

test('side spin «screws» a ball brushing a jaw into the pocket: the right spin widens the window', () => {
  const p = POCKETS[0];
  const MM = (2 * R) / 68;
  const window = (ox) => {
    let n = 0;
    const th = (30 * Math.PI) / 180;
    const dx = p.u[0] * Math.cos(th) - p.u[1] * Math.sin(th);
    const dy = p.u[0] * Math.sin(th) + p.u[1] * Math.cos(th);
    for (let o = -20; o <= 25; o += 0.5) {
      const t = new Physics(1);
      t.place(0, p.M[0] - p.u[1] * o * MM - dx * 0.25, p.M[1] + p.u[0] * o * MM - dy * 0.25);
      t.shoot(Math.atan2(dy, dx), 0.15, ox, 0.5, 0);
      t.runToRest(10);
      if (!t.on[0]) n++;
    }
    return n;
  };
  const helping = window(-0.9);
  const plain = window(0);
  const against = window(0.9);
  assert.ok(helping > plain && plain >= against, `windows ${helping} / ${plain} / ${against} half-mm steps`);
});

test('aiming through the throw: the corrected aim sends a slow cut exactly at the pocket', () => {
  // the cue ball close by, so it still slides at the contact: the throw is largest
  const t = new Physics(2);
  t.place(0, ...cueFor(0.35, 0.3, 0, 35, 0.06));
  t.place(1, 0.35, 0.3);
  const { x, y } = POCKETS[0];
  const ghost = t.aimFor(1, 0);
  const shot = { power: 0.2, ox: 0, oy: 0, elev: 0 };
  const off = (aim) => {
    const s = t.copy();
    s.shoot(aim, shot.power, 0, 0, 0);
    for (let f = 0; f < 4000 && s.firstHit < 0; f++) s.step(1 / 240);
    return Math.abs(deg(Math.atan2(s.vy[1], s.vx[1]) - Math.atan2(y - s.y[1], x - s.x[1])));
  };
  assert.ok(off(ghost) > 1, `the plain ghost ball is off by ${off(ghost).toFixed(2)}°`);
  assert.ok(off(aimThrough(t, 0, 1, 'object', x, y, ghost, shot)) < 0.05, 'corrected');
});

test('the aiming guide shows the object ball where the throw really sends it', () => {
  const t = new Physics(2);
  t.place(0, 0.62, 0.55);
  t.place(1, 0.35, 0.3);
  const aim = t.aimFor(1, 0);
  const path = predictStrikerPath(t, aim, { power: 0.2 });
  const s = t.copy();
  s.shoot(aim, 0.2, 0, 0, 0);
  for (let f = 0; f < 4000 && s.firstHit < 0; f++) s.step(1 / 240);
  assert.equal(path.object, 1);
  assert.ok(Math.abs(path.objectDir - Math.atan2(s.vy[1], s.vx[1])) < 0.003);
});
