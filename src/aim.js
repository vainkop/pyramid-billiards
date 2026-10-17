import { Physics, R } from './physics.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * How far (radians) the departure of one ball from the first contact misses
 * the direction to (tx, ty), when `striker` is played at `aim` with `shot` and
 * meets `object`. `steer` is 'object' (a pot) or 'striker' (a свояк: the
 * striking ball's own way off the contact). Null if the balls do not meet.
 * Played on a table holding just the two balls, in fine steps.
 */
function departureError(phys, striker, object, steer, tx, ty, aim, { power, ox = 0, oy = 0, elev = 0 }) {
  const p = new Physics(2);
  p.place(0, phys.x[striker], phys.y[striker]);
  p.place(1, phys.x[object], phys.y[object]);
  p.shoot(aim, power, ox, oy, elev);
  let f = 0;
  for (; f < 2400 && p.moving() && p.firstHit < 0; f++) p.step(1 / 240);
  if (p.firstHit < 0) return null;
  if (steer !== 'striker') {
    return p.on[1] ? wrap(Math.atan2(p.vy[1], p.vx[1]) - Math.atan2(ty - p.y[1], tx - p.x[1])) : null;
  }
  // the striking ball curves off the contact (follow, draw): steer the point of its
  // path that is as far from the contact as the target
  const cx = p.x[0];
  const cy = p.y[0];
  const reach = Math.hypot(tx - cx, ty - cy);
  for (; f < 2400 && p.on[0] && (p.vx[0] || p.vy[0]) && Math.hypot(p.x[0] - cx, p.y[0] - cy) < reach * 0.9 && p.cueRails === 0; f++) p.step(1 / 240);
  if (Math.hypot(p.x[0] - cx, p.y[0] - cy) < R) return null;
  return wrap(Math.atan2(p.y[0] - cy, p.x[0] - cx) - Math.atan2(ty - cy, tx - cx));
}

/**
 * The ghost-ball aim corrected for throw. The rub between the balls sends the
 * object ball a few degrees off the line of centres — more on a slow cut and
 * with side spin — and the striking ball the other way, so a good player aims
 * a touch off the ghost ball. Starting from `aim`, a few secant steps make the
 * steered ball leave towards (tx, ty).
 */
export function aimThrough(phys, striker, object, steer, tx, ty, aim, shot) {
  const error = (a) => departureError(phys, striker, object, steer, tx, ty, a, shot);
  let a0 = aim;
  let e0 = error(a0);
  if (e0 === null) return aim;
  let a1 = aim + 1e-3;
  let e1 = error(a1);
  for (let k = 0; k < 5 && e1 !== null && Math.abs(e1) > 2e-5 && e1 !== e0; k++) {
    const a2 = a1 - (e1 * (a1 - a0)) / (e1 - e0);
    if (Math.abs(a2 - aim) > 0.06) break; // throw is a few degrees at most: do not wander off
    [a0, e0, a1] = [a1, e1, a2];
    e1 = error(a1);
  }
  if (e1 !== null && Math.abs(e1) < Math.abs(e0)) return a1;
  return a0;
}

/** Speed of a lone ball `dist` along an open line after being struck with `power` and `spin`. */
function speedAfter(dist, power, { ox = 0, oy = 0, elev = 0 }) {
  const p = new Physics(1);
  p.place(0, 0.5, R);
  p.shoot(Math.PI / 2, power, ox, oy, elev);
  for (let f = 0; f < 4800 && p.moving(); f++) {
    p.step(1 / 240);
    if (p.y[0] - R >= dist) return Math.hypot(p.vx[0], p.vy[0]);
  }
  return 0;
}

/**
 * Power that brings the striking ball to the contact `dist` away still going at
 * `speed`: draw costs pace on the way (the ball slides), and any off-centre hit
 * starts the ball slower than a centre hit.
 */
export function powerToArrive(dist, speed, spin) {
  dist = Math.min(dist, 1.9);
  if (speedAfter(dist, 1, spin) < speed) return 1;
  let lo = 0.01;
  let hi = 1;
  for (let k = 0; k < 14; k++) {
    const mid = (lo + hi) / 2;
    if (speedAfter(dist, mid, spin) < speed) lo = mid;
    else hi = mid;
  }
  return hi;
}
