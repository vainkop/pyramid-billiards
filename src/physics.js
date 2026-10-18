/**
 * Billiard physics with spin, in "table units": the playing surface is W × H
 * (1 × 2, i.e. ≈1.78 × 3.55 m for a 12-ft Russian table). Ball 0 is the cue ball.
 *
 * Every ball has its velocity v and a "roll velocity" r — the velocity at which
 * its current spin would make it roll without slipping. A centre hit gives r = 0
 * (the ball slides), a high hit gives r > v (follow), a low hit r < 0 (draw).
 * Cloth friction drives v and r together; once they match, the ball rolls
 * (the sliding/rolling model of e.g. Жарух, «Анализ движения бильярдного шара»,
 * МГТУ им. Баумана, 2019). Ball–ball impulses act mostly through the centre and
 * leave r nearly untouched, which is exactly what produces follow, draw and the
 * stop shot. The contact points also rub (see `ballFriction`), which throws the
 * object ball off the line of centres. Side spin `sp` (the speed of the ball's
 * surface about the vertical axis) grips cushions and pocket jaws; an elevated
 * cue gives r a sideways part, which curves the ball (massé).
 */

import { W, H, R, SEGMENTS, JAWS, POCKETS, E_JAW, jawRestitution } from './table.js';

export { W, H, R, POCKETS };
export const MAXV = 4.5;
/** Largest tip offset from the centre, as a fraction of R, before a miscue. */
export const MAX_TIP = 0.6;

const SLIDE = 1.2; // sliding friction deceleration
const ROLL = 0.1; // rolling resistance
const DAMP = 0.12;
/** Turning friction is the weakest of the three (sliding > rolling > turning), so side spin lasts. */
const SPIN_DECEL = 0.5;
const LATERAL = 0.45; // massé curve strength
const E_BALL = 0.94;
/** Metres per table unit (the 1.78 m width of the bed), for the speed-dependent friction. */
const METRES = 1.78;
/** Grip of the cloth-covered cushion nose on the ball. */
const MU_CUSHION = 0.14;
/** Pocket jaws and cheeks are softer and the ball meets them at a glance: less grip, so a ball brushing a jaw still drops. */
const MU_JAW = 0.05;
/** Cue to ball mass ratio (≈700 g cue, ≈285 g ball), for the energy of an off-centre hit. */
const CUE_MASS = 2.45;
/**
 * A ball meeting a cushion faster than this (≈7.7 m/s — only a near full-power
 * stroke straight into the cushion) climbs it and flies off the table.
 */
export const V_JUMP = 4.35;
/** Balls this far from every cushion cannot touch one: skip the geometry test. */
const NEAR_CUSHION = 0.1;
const FRAME = 1 / 60;
/**
 * The step a shot on screen is played in, whatever the display's frame rate, and
 * the step the aiming lines are predicted in: the same steps from the same table
 * give the same result to the last bit, so what the lines show is what happens.
 */
export const TICK = 1 / 240;

export class Physics {
  constructor(n) {
    this.n = n;
    for (const k of ['x', 'y', 'vx', 'vy', 'rx', 'ry', 'sp']) this[k] = new Float64Array(n);
    this.on = new Array(n).fill(false);
    this.touched = new Array(n).fill(false);
    this.pocketOf = new Int8Array(n).fill(-1);
    this.live = new Uint8Array(n);
    this.record = false;
    this.resetEvents();
  }

  resetEvents() {
    this.firstHit = -1;
    this.railsBeforeHit = 0;
    this.cueRails = 0;
    this.potted = [];
    this.jumped = [];
    /** Where and how fast each jumped ball left the table, for drawing it fly off. */
    this.flights = [];
    // what happened after the cue ball first met an object ball, in order:
    // { type: 'rail', ball, rail } | { type: 'cross', ball } | { type: 'hit', a, b, ya, yb, frozenA, frozenB }
    this.events = [];
    this.side = Array.from(this.y, (y) => Math.sign(y - H / 2));
    this.touched.fill(false);
    this.tracks = this.record ? Array.from({ length: this.n }, () => []) : null;
  }

  /** Copies positions only — the result is a table at rest. */
  copy() {
    const p = new Physics(this.n);
    p.x.set(this.x);
    p.y.set(this.y);
    p.on = this.on.slice();
    return p;
  }

  /** True if a ball could stand at (x, y) without overlapping any ball except `except`. */
  isFree(x, y, except = -1) {
    for (let j = 0; j < this.n; j++) {
      if (j !== except && this.on[j] && (this.x[j] - x) ** 2 + (this.y[j] - y) ** 2 < 4 * R * R * 1.02) return false;
    }
    return true;
  }

  /** True if a ball can roll from a to b without touching any ball except the excluded ones. */
  pathClear(ax, ay, bx, by, ...exclude) {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let j = 0; j < this.n; j++) {
      if (!this.on[j] || exclude.includes(j)) continue;
      const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((this.x[j] - ax) * dx + (this.y[j] - ay) * dy) / len2));
      if ((ax + dx * t - this.x[j]) ** 2 + (ay + dy * t - this.y[j]) ** 2 < 4 * R * R * 0.98) return false;
    }
    return true;
  }

  place(i, x, y) {
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = this.vy[i] = this.rx[i] = this.ry[i] = this.sp[i] = 0;
    this.on[i] = true;
  }

  /**
   * @param aim   shot direction in radians (screen coordinates, y down)
   * @param power 0..1
   * @param ox,oy tip position on the cue ball face in [-1, 1] (oy > 0 above centre)
   * @param elev  cue elevation, 0 = level, 1 = almost vertical
   */
  shoot(aim, power, ox = 0, oy = 0, elev = 0) {
    // an off-centre hit sends the ball off slower: part of the stroke goes into spin
    // (a hit 2/5 R above the centre gives about 10–15 % less speed than a centre hit)
    const b = Math.hypot(ox, oy) * MAX_TIP;
    const v0 = power * MAXV * (1 + CUE_MASS) / (1 + CUE_MASS + 2.5 * b * b);
    const dx = Math.cos(aim);
    const dy = Math.sin(aim);
    const k = 2.5 * MAX_TIP;
    const fwd = v0 * (1 - 0.55 * elev);
    const follow = k * oy * v0 * (1 - 0.3 * elev);
    const lateral = k * ox * v0 * elev * LATERAL;
    // "right" of the shot direction, as the player sees it
    const rgx = -dy;
    const rgy = dx;
    this.vx[0] = dx * fwd;
    this.vy[0] = dy * fwd;
    this.rx[0] = dx * follow + rgx * lateral;
    this.ry[0] = dy * follow + rgy * lateral;
    this.sp[0] = k * ox * v0 * (1 - elev);
    this.resetEvents();
    if (this.record) this.recordFrame();
  }

  moving() {
    for (let i = 0; i < this.n; i++) {
      if (this.on[i] && (this.vx[i] || this.vy[i] || this.rx[i] || this.ry[i])) return true;
    }
    return false;
  }

  /** Runs the current shot to completion (at most maxSeconds of table time) in steps of `dt`. */
  runToRest(maxSeconds = 30, dt = FRAME) {
    for (let t = 0; t < maxSeconds && this.moving(); t += dt) this.step(dt);
    return this;
  }

  step(dt) {
    let maxv = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.on[i]) maxv = Math.max(maxv, Math.abs(this.vx[i]) + Math.abs(this.vy[i]));
    }
    const steps = Math.max(1, Math.min(24, Math.ceil((maxv * dt) / (R * 0.25))));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) this.substep(h);
    if (this.record) this.recordFrame();
  }

  recordFrame() {
    for (let i = 0; i < this.n; i++) {
      if (!this.on[i] && !this.potted.includes(i)) continue;
      const t = this.tracks[i];
      const len = t.length;
      if (len >= 2 && t[len - 2] === this.x[i] && t[len - 1] === this.y[i]) continue;
      t.push(this.x[i], this.y[i]);
    }
  }

  substep(h) {
    const { n, x, y, vx, vy, rx, ry, sp, on } = this;
    for (let i = 0; i < n; i++) {
      if (!on[i]) continue;
      x[i] += vx[i] * h;
      y[i] += vy[i] * h;
      // centre-line crossings count only after the first contact (rule 20)
      const side = Math.sign(y[i] - H / 2);
      if (side !== this.side[i]) {
        if (this.firstHit >= 0 && side !== 0 && this.side[i] !== 0) this.events.push({ type: 'cross', ball: i });
        this.side[i] = side;
      }
      const slx = vx[i] - rx[i];
      const sly = vy[i] - ry[i];
      const slip = Math.hypot(slx, sly);
      if (slip > 1e-4) {
        // sliding: friction slows the ball and spins it towards natural roll
        const dv = SLIDE * h;
        if (3.5 * dv >= slip) {
          vx[i] = rx[i] = (5 * vx[i] + 2 * rx[i]) / 7;
          vy[i] = ry[i] = (5 * vy[i] + 2 * ry[i]) / 7;
        } else {
          const ux = slx / slip;
          const uy = sly / slip;
          vx[i] -= ux * dv;
          vy[i] -= uy * dv;
          rx[i] += ux * 2.5 * dv;
          ry[i] += uy * 2.5 * dv;
        }
      } else {
        const speed = Math.hypot(vx[i], vy[i]);
        if (speed > 0) {
          const ns = speed - (ROLL + DAMP * speed) * h;
          const f = ns <= 0 ? 0 : ns / speed;
          vx[i] *= f;
          vy[i] *= f;
        }
        rx[i] = vx[i];
        ry[i] = vy[i];
      }
      const spinLoss = SPIN_DECEL * h;
      sp[i] = Math.abs(sp[i]) <= spinLoss ? 0 : sp[i] - Math.sign(sp[i]) * spinLoss;
      if (Math.abs(vx[i]) + Math.abs(vy[i]) < 0.003 && Math.abs(rx[i]) + Math.abs(ry[i]) < 0.003) {
        vx[i] = vy[i] = rx[i] = ry[i] = sp[i] = 0;
      }
    }
    // broad phase: two resting balls cannot collide, and a resting ball cannot reach a cushion
    const live = this.live;
    for (let i = 0; i < n; i++) live[i] = on[i] && (vx[i] || vy[i] || rx[i] || ry[i]) ? 1 : 0;
    for (let i = 0; i < n; i++) {
      if (!on[i]) continue;
      for (let j = i + 1; j < n; j++) if (on[j] && (live[i] || live[j])) this.collide(i, j, h);
    }
    for (let i = 0; i < n; i++) if (live[i] && on[i]) this.rails(i);
  }

  collide(i, j, h) {
    const { x, y, vx, vy } = this;
    let dx = x[j] - x[i];
    let dy = y[j] - y[i];
    const d2 = dx * dx + dy * dy;
    if (d2 >= 4 * R * R) return;
    // rewind both balls to the exact moment of contact so the cut angle is accurate
    const rvx = vx[i] - vx[j];
    const rvy = vy[i] - vy[j];
    const rv2 = rvx * rvx + rvy * rvy;
    const drv = dx * rvx + dy * rvy;
    let back = 0;
    if (drv > 0 && rv2 > 0) {
      back = Math.min(h, (-drv + Math.sqrt(drv * drv - rv2 * (d2 - 4 * R * R))) / rv2);
    }
    this.advance(i, j, -back);
    dx = x[j] - x[i];
    dy = y[j] - y[i];
    const d = Math.hypot(dx, dy);
    if (d === 0) return;
    const nx = dx / d;
    const ny = dy / d;
    const push = Math.max(0, 2 * R - d) / 2;
    x[i] -= nx * push;
    y[i] -= ny * push;
    x[j] += nx * push;
    y[j] += ny * push;
    const vn = (vx[i] - vx[j]) * nx + (vy[i] - vy[j]) * ny;
    if (vn > 0) {
      const imp = (vn * (1 + E_BALL)) / 2;
      vx[i] -= imp * nx;
      vy[i] -= imp * ny;
      vx[j] += imp * nx;
      vy[j] += imp * ny;
      this.ballFriction(i, j, nx, ny, imp);
      this.touched[i] = this.touched[j] = true;
      if (this.firstHit < 0 && i === 0) {
        this.firstHit = j;
      } else if (this.firstHit >= 0) {
        this.events.push({ type: 'hit', a: i, b: j, ya: y[i], yb: y[j], frozenA: this.frozenTo(i), frozenB: this.frozenTo(j) });
      }
    }
    this.advance(i, j, back);
  }

  /**
   * Friction between the balls during the impact. The contact points slip past
   * each other sideways (a cut, side spin) and vertically (follow or draw); the
   * rub, against the slip, throws the object ball off the line of centres
   * («эффект отклонения прицельного шара», ЭОПШ) and the striking ball the other
   * way (ЭОБ), and hands a little spin over, gear-like. Ball–ball friction falls
   * with the slip speed, so the throw is largest on a slow shot: up to about
   * 6–7° on a cut, about 5° from side spin (Салентур, «Теория русского
   * бильярда»). Follow or draw adds vertical slip and so reduces the sideways
   * throw.
   */
  ballFriction(i, j, nx, ny, imp) {
    const { vx, vy, rx, ry, sp } = this;
    const tx = -ny;
    const ty = nx;
    const st = (vx[i] - vx[j]) * tx + (vy[i] - vy[j]) * ty - sp[i] - sp[j];
    const sz = -((rx[i] + rx[j]) * nx + (ry[i] + ry[j]) * ny);
    const slip = Math.hypot(st, sz);
    if (slip < 1e-6) return;
    const mu = 0.01 + 0.13 * Math.exp(-1.088 * slip * METRES);
    // never more than it takes to stop the slip
    const J = Math.min(mu * imp, slip / 7);
    const jt = (-st / slip) * J;
    const jz = (-sz / slip) * J;
    vx[i] += jt * tx;
    vy[i] += jt * ty;
    vx[j] -= jt * tx;
    vy[j] -= jt * ty;
    sp[i] -= 2.5 * jt;
    sp[j] -= 2.5 * jt;
    rx[i] -= 2.5 * jz * nx;
    ry[i] -= 2.5 * jz * ny;
    rx[j] -= 2.5 * jz * nx;
    ry[j] -= 2.5 * jz * ny;
  }

  advance(i, j, t) {
    this.x[i] += this.vx[i] * t;
    this.y[i] += this.vy[i] * t;
    this.x[j] += this.vx[j] * t;
    this.y[j] += this.vy[j] * t;
  }

  /**
   * Cushions, jaws and pockets (see table.js): the ball is pushed out of any
   * segment or jaw rounding it overlaps and bounces off it; once its centre is
   * past a pocket's drop line it is pocketed.
   */
  rails(i) {
    const { x, y } = this;
    if (x[i] > NEAR_CUSHION && x[i] < W - NEAR_CUSHION && y[i] > NEAR_CUSHION && y[i] < H - NEAR_CUSHION) return;
    for (const s of SEGMENTS) {
      const dx = s.bx - s.ax;
      const dy = s.by - s.ay;
      const t = Math.max(0, Math.min(1, ((x[i] - s.ax) * dx + (y[i] - s.ay) * dy) / (dx * dx + dy * dy)));
      this.contact(i, s.ax + dx * t, s.ay + dy * t, s);
      if (!this.on[i]) return;
    }
    for (const j of JAWS) {
      const d = Math.hypot(x[i] - j.x, y[i] - j.y);
      if (d < R + j.r && d > 0) this.contact(i, j.x + ((x[i] - j.x) / d) * j.r, j.y + ((y[i] - j.y) / d) * j.r, j);
      if (!this.on[i]) return;
    }
    for (let k = 0; k < POCKETS.length; k++) {
      if (POCKETS[k].drops(x[i], y[i])) return this.pocket(i, k);
    }
    // anything that somehow got past the cushions went down the nearest pocket
    if (x[i] < -0.15 || x[i] > W + 0.15 || y[i] < -0.15 || y[i] > H + 0.15) {
      let best = 0;
      POCKETS.forEach((p, k) => {
        if (Math.hypot(x[i] - p.x, y[i] - p.y) < Math.hypot(x[i] - POCKETS[best].x, y[i] - POCKETS[best].y)) best = k;
      });
      this.pocket(i, best);
    }
  }

  /** Ball i overlapping an obstacle at its closest point (qx, qy): push it out and bounce if it moves in. */
  contact(i, qx, qy, obstacle) {
    const dx = this.x[i] - qx;
    const dy = this.y[i] - qy;
    const d = Math.hypot(dx, dy);
    if (d >= R || d === 0) return;
    const nx = dx / d;
    const ny = dy / d;
    this.x[i] = qx + nx * R;
    this.y[i] = qy + ny * R;
    const vn = this.vx[i] * nx + this.vy[i] * ny;
    if (vn < 0) {
      const jaw = obstacle.e === E_JAW || obstacle.e === undefined;
      this.cushion(i, nx, ny, obstacle.rail, jaw ? jawRestitution(-vn) : obstacle.e, jaw ? MU_JAW : MU_CUSHION);
    }
  }

  pocket(i, k) {
    this.pocketOf[i] = k;
    this.on[i] = false;
    this.vx[i] = this.vy[i] = this.rx[i] = this.ry[i] = this.sp[i] = 0;
    this.potted.push(i);
  }

  /** Bounce off a cushion whose inward normal is (nx, ny) — or fly off the table if hit too hard. */
  cushion(i, nx, ny, rail, restitution, mu = MU_CUSHION) {
    const { vx, vy, rx, ry, sp } = this;
    if (this.firstHit >= 0) this.events.push({ type: 'rail', ball: i, rail });
    if (-(vx[i] * nx + vy[i] * ny) > V_JUMP) {
      this.flights.push({ ball: i, x: this.x[i], y: this.y[i], vx: vx[i], vy: vy[i] });
      this.on[i] = false;
      vx[i] = vy[i] = rx[i] = ry[i] = sp[i] = 0;
      this.jumped.push(i);
      return;
    }
    const tx = -ny;
    const ty = nx;
    const vn = vx[i] * nx + vy[i] * ny;
    vx[i] -= (1 + restitution) * vn * nx;
    vy[i] -= (1 + restitution) * vn * ny;
    // the cloth grips the ball where it touches: the slip of that point (sliding
    // along the cushion plus side spin) is rubbed down. Running side spin widens
    // the rebound, reverse side spin narrows it, and on a pocket jaw the right
    // spin «screws» the ball into the pocket («ввинчивание»).
    const slip = vx[i] * tx + vy[i] * ty + sp[i];
    const jt = -Math.sign(slip) * Math.min(mu * (1 + restitution) * -vn, Math.abs(slip) / 3.5);
    vx[i] += jt * tx;
    vy[i] += jt * ty;
    sp[i] += 2.5 * jt;
    // the cushion nose sits above the centre: it kills and slightly reverses topspin
    const rn = rx[i] * nx + ry[i] * ny;
    rx[i] += -1.3 * rn * nx + jt * tx;
    ry[i] += -1.3 * rn * ny + jt * ty;
    if (i === 0) {
      this.cueRails++;
      if (this.firstHit < 0) this.railsBeforeHit++;
    }
  }

  /** Cushion a ball is resting against (centre within a hair of R from it), or null. */
  frozenTo(i) {
    const e = R * 1.05;
    if (this.x[i] <= e) return 'left';
    if (this.x[i] >= W - e) return 'right';
    if (this.y[i] <= e) return 'top';
    if (this.y[i] >= H - e) return 'bottom';
    return null;
  }

  /** Aim angle from the cue ball to the ghost-ball position for potting ball t in pocket k. */
  aimFor(t, k) {
    const p = POCKETS[k];
    const ux = p.x - this.x[t];
    const uy = p.y - this.y[t];
    const l = Math.hypot(ux, uy);
    const gx = this.x[t] - (ux / l) * 2 * R;
    const gy = this.y[t] - (uy / l) * 2 * R;
    return Math.atan2(gy - this.y[0], gx - this.x[0]);
  }
}

/** Cue position for a shot on a ball at (bx, by) into pocket k with the given cut angle. */
export function cueFor(bx, by, k, cutDeg, dist) {
  const p = POCKETS[k];
  const l = Math.hypot(p.x - bx, p.y - by);
  const ux = (p.x - bx) / l;
  const uy = (p.y - by) / l;
  const a = (cutDeg * Math.PI) / 180;
  const dx = ux * Math.cos(a) - uy * Math.sin(a);
  const dy = ux * Math.sin(a) + uy * Math.cos(a);
  return [bx - ux * 2 * R - dx * dist, by - uy * 2 * R - dy * dist];
}

/**
 * Distance a ball travels when struck in the centre at speed v: it slides until
 * friction brings it to natural roll (at 5/7 of the speed), then rolls to a stop.
 */
export function stunDistance(v) {
  const ts = v / (3.5 * SLIDE);
  const slide = v * ts - 0.5 * SLIDE * ts * ts;
  const v1 = (5 / 7) * v;
  return slide + v1 / DAMP - (ROLL / (DAMP * DAMP)) * Math.log(1 + (DAMP * v1) / ROLL);
}

/** Inverse of {@link stunDistance}. */
export function speedForDistance(d) {
  let lo = 0;
  let hi = MAXV * 2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (stunDistance(mid) < d) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Fraction of the striking ball's normal speed handed to the object ball. */
export const TRANSFER = (1 + E_BALL) / 2;
