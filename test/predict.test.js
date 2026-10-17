import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Physics } from '../src/physics.js';
import { predictStrikerPath } from '../src/predict.js';
import { potCandidates, allowForThrow } from '../src/ai.js';

function position() {
  const t = new Physics(3);
  t.place(0, 0.571, 0.844);
  t.place(1, 0.501, 1.04);
  t.place(7, 0.8, 0.3);
  return t;
}

test('the deflection line recognises a cut свояк and runs into the pocket', () => {
  const t = position();
  const c = potCandidates(t, 0).find((x) => x.kind === 'свояк');
  const aim = allowForThrow(t, c, c.spins[0]);
  const path = predictStrikerPath(t, aim, { power: c.power, oy: c.spins[0].oy });
  assert.ok(path.pocket >= 0, 'the struck ball drops');
  const sim = t.copy();
  sim.shoot(aim, c.power, 0, c.spins[0].oy, 0);
  sim.runToRest();
  assert.equal(path.pocket, sim.pocketOf[0], 'the same pocket as the real shot');
});

test('an ordinary deflection is only shown for its first stretch', () => {
  const t = position();
  const aim = Math.atan2(t.y[1] - t.y[0], t.x[1] - t.x[0]) + 0.12; // a thin cut: the cue ball runs on
  const path = predictStrikerPath(t, aim, { power: 0.8 });
  assert.equal(path.pocket, -1);
  let length = 0;
  for (let k = 2; k < path.points.length; k += 2) length += Math.hypot(path.points[k] - path.points[k - 2], path.points[k + 1] - path.points[k - 1]);
  assert.ok(length > 0.1 && length < 0.5, `shown ${length.toFixed(2)}`);
});

test('follow and draw bend the deflection the expected way on a full hit', () => {
  const t = new Physics(2);
  t.place(0, 0.5, 1.4);
  t.place(1, 0.5, 1.0);
  const aim = -Math.PI / 2;
  const end = (oy) => {
    const pts = predictStrikerPath(t, aim, { power: 0.4, oy }).points;
    return pts[pts.length - 1];
  };
  assert.ok(end(0.8) < 1.0, 'follow: the cue ball goes on past the object ball');
  assert.ok(end(-0.8) > 1.05, 'draw: the cue ball comes back');
});
