import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DRILLS, stars } from '../src/drills.js';

function attempt(d, aim, power, ox, oy, elev) {
  const p = d.setup();
  p.shoot(aim, power, ox, oy, elev);
  return d.check(p.runToRest());
}

for (const d of DRILLS) {
  test(`drill ${d.id}: reference solution succeeds and is not a fluke`, () => {
    d.prepare();
    const { power, ox, oy, elev } = d.solution;
    const aim = d.solutionAim(d.setup());
    assert.equal(attempt(d, aim, power, ox, oy, elev), null);
    let ok = 0;
    for (let a = -1; a <= 1; a++) {
      for (let pw = -1; pw <= 1; pw++) {
        if (attempt(d, aim + a * 0.0015, power * (1 + pw * 0.03), ox, oy, elev) === null) ok++;
      }
    }
    assert.ok(ok >= 3, `only ${ok}/9 neighbouring shots succeed`);
  });
}

test('drill positions stay on the table', () => {
  for (const d of DRILLS) {
    for (let k = 0; k < d.pos.length; k += 2) {
      assert.ok(d.pos[k] > 0.02 && d.pos[k] < 0.98 && d.pos[k + 1] > 0.02 && d.pos[k + 1] < 1.98, d.id);
    }
  }
});

test('a missed shot explains what went wrong', () => {
  const d = DRILLS[0];
  assert.match(attempt(d, d.solutionAim(d.setup()) + Math.PI, 0.3, 0, 0, 0), /не задел/);
});

test('star rating', () => {
  assert.equal(stars(0, 0), 0);
  assert.equal(stars(1, 1), 1);
  assert.equal(stars(3, 1), 2);
  assert.equal(stars(3, 3), 3);
});
