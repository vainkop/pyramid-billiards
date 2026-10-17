import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Physics } from '../src/physics.js';
import { R, POCKETS, CORNER, SIDE, pocketAhead } from '../src/table.js';

const MM = (2 * R) / 68; // pocket sizes are scaled to the ball, like the drawing

/** Rolls a ball at pocket k from 0.5 away, `angle`° off its axis, its path shifted `off` mm. */
function drops(k, angle, off, speed) {
  const p = POCKETS[k];
  const a = (angle * Math.PI) / 180;
  const dx = p.u[0] * Math.cos(a) - p.u[1] * Math.sin(a);
  const dy = p.u[0] * Math.sin(a) + p.u[1] * Math.cos(a);
  const t = new Physics(1);
  t.place(0, p.M[0] - dy * off * MM - dx * 0.5, p.M[1] + dx * off * MM - dy * 0.5);
  t.vx[0] = t.rx[0] = dx * speed;
  t.vy[0] = t.ry[0] = dy * speed;
  t.resetEvents();
  return t.runToRest().potted.includes(0);
}

test('pocket mouths follow the МКП requirements relative to a 68 mm ball', () => {
  assert.ok(Math.abs(CORNER.mouth / (2 * R) - 72.5 / 68) < 1e-9);
  assert.ok(Math.abs(SIDE.mouth / (2 * R) - 82.5 / 68) < 1e-9);
});

test('a ball straight into the middle of a corner mouth drops; one aimed at the jaw does not', () => {
  assert.equal(drops(0, 0, 0, 0.8), true);
  assert.equal(drops(0, 0, 18, 0.8), false);
  assert.equal(drops(0, 0, -18, 0.8), false);
});

test('the middle pocket is wider than the corner but does not take a ball along the cushion', () => {
  assert.equal(drops(2, 0, 14, 0.8), true, '14 mm off still drops in the middle pocket');
  assert.equal(drops(0, 0, 14, 0.8), false, '…but not in the corner');
  assert.equal(drops(2, 58, 0, 0.8), false, 'along the cushion');
});

test('hard balls are taken less readily than soft ones', () => {
  const width = (speed) => {
    let n = 0;
    for (let off = -20; off <= 20; off += 1) if (drops(0, 0, off, speed)) n++;
    return n;
  };
  assert.ok(width(3) < width(0.6), `hard ${width(3)} vs soft ${width(0.6)}`);
});

test('the aiming hint turns green only for a ball heading into the mouth', () => {
  const p = POCKETS[0];
  const from = [p.M[0] - p.u[0] * 0.5, p.M[1] - p.u[1] * 0.5];
  assert.equal(pocketAhead(from[0], from[1], p.u[0], p.u[1]), 0);
  const a = 0.05; // a few degrees off: the path meets the jaw
  assert.equal(pocketAhead(from[0], from[1], p.u[0] * Math.cos(a) - p.u[1] * Math.sin(a), p.u[0] * Math.sin(a) + p.u[1] * Math.cos(a)), -1);
});
