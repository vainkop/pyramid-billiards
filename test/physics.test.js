import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Physics, R } from '../src/physics.js';

/** Straight shot from x=0.75 to a ball at x=0.3 heading into the left side pocket. */
function straight(power, ox, oy) {
  const p = new Physics(2);
  p.place(1, 0.3, 1);
  p.place(0, 0.75, 1);
  p.shoot(Math.PI, power, ox, oy);
  return p.runToRest();
}
const CONTACT_X = 0.3 + 2 * R;

test('object ball is potted on a straight shot', () => {
  assert.ok(straight(0.4, 0, 0).potted.includes(1));
});

test('stop shot: slightly low hit leaves the cue ball near the contact point', () => {
  const p = straight(0.4, 0, -0.25);
  assert.ok(Math.abs(p.x[0] - CONTACT_X) < 0.06, `cue stopped at ${p.x[0]}`);
});

test('draw fades with distance: a soft draw comes back less than a firm one', () => {
  assert.ok(straight(0.3, 0, -0.8).x[0] < straight(0.4, 0, -0.8).x[0]);
});

test('follow: high hit carries the cue ball forward past the contact point', () => {
  const p = straight(0.3, 0, 0.8);
  assert.ok(!p.on[0] || p.x[0] < CONTACT_X - 0.1);
});

test('draw: low hit brings the cue ball back towards the shooter', () => {
  const p = straight(0.4, 0, -0.8);
  assert.ok(p.x[0] > CONTACT_X + 0.15, `cue ended at ${p.x[0]}`);
});

test('side spin bends a straight cushion rebound to the player\'s side', () => {
  const end = (ox) => {
    const p = new Physics(1);
    p.place(0, 0.5, 1.4);
    p.shoot(Math.PI / 2, 0.4, ox, 0); // shooting "down" the screen
    return p.runToRest().x[0];
  };
  // facing down the screen, the player's right hand is screen-left
  assert.ok(end(0.8) < 0.4);
  assert.ok(end(-0.8) > 0.6);
  assert.ok(Math.abs(end(0) - 0.5) < 1e-6);
});

test('massé: elevated cue with side spin curves the cue ball', () => {
  const p = new Physics(1);
  p.record = true;
  p.place(0, 0.5, 1.8);
  p.shoot(-Math.PI / 2, 0.35, 0.9, -0.3, 0.7);
  p.runToRest();
  const xs = p.tracks[0].filter((_, k) => k % 2 === 0);
  assert.ok(Math.max(...xs) - 0.5 > 0.2, 'expected a curve to the right');
});

test('copy() produces an independent table at rest', () => {
  const p = straight(0.4, 0, 0);
  const c = p.copy();
  c.x[0] = 99;
  assert.notEqual(p.x[0], 99);
  assert.equal(c.moving(), false);
});
