import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Physics } from '../src/physics.js';
import { TableView, GAME } from '../src/table-view.js';

/** The table view's own pointer handlers on a stand-in canvas: 100 px per table unit, no offset. */
function view() {
  const handlers = {};
  const canvas = {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    setPointerCapture() {},
    hasPointerCapture: () => true,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
  const phys = new Physics(2);
  phys.place(0, 0.5, 1.5);
  phys.place(1, 0.5, 0.5);
  const v = Object.assign(Object.create(TableView.prototype), {
    phys, mode: GAME, s: 100, offX: 0, offY: 0, aim: -Math.PI / 2, params: { power: 0.4, ox: 0, oy: 0, elev: 0 },
    animating: false, locked: false, pickMode: false, canPlace: () => false,
  });
  v.bindInput(canvas);
  const at = (type, x, y, t) => handlers[type]({ pointerId: 1, clientX: x * 100, clientY: y * 100, timeStamp: t });
  return { v, at };
}

test('lifting the finger does not drag the aim along', () => {
  const { v, at } = view();
  at('pointerdown', 0.3, 0.6, 0);
  for (let k = 1; k <= 10; k++) at('pointermove', 0.3 + k * 0.02, 0.6, k * 40); // a deliberate turn
  const aimed = v.aim;
  // held still to check the line, then the finger rolls as it leaves the glass
  at('pointermove', 0.51, 0.62, 930);
  at('pointermove', 0.52, 0.63, 950);
  assert.notEqual(v.aim, aimed);
  at('pointerup', 0.52, 0.63, 960);
  assert.equal(v.aim, aimed, 'back to the aim held before the lift');
});

test('a held aim and a fast deliberate turn are left alone', () => {
  const { v, at } = view();
  at('pointerdown', 0.3, 0.6, 0);
  at('pointermove', 0.4, 0.6, 40);
  at('pointermove', 0.45, 0.6, 80);
  const held = v.aim;
  at('pointerup', 0.45, 0.6, 400);
  assert.equal(v.aim, held, 'no movement just before the lift');
  at('pointerdown', 0.45, 0.6, 1000);
  at('pointermove', 0.55, 0.6, 1040);
  at('pointermove', 0.9, 0.9, 1060); // a big swing right at the end is meant
  const swung = v.aim;
  at('pointerup', 0.9, 0.9, 1070);
  assert.equal(v.aim, swung);
});
