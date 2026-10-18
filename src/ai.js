import { W, H, R, MAXV, POCKETS, TRANSFER, speedForDistance, stunDistance } from './physics.js';
import { aimThrough, powerToArrive } from './aim.js';
import { FOOT_SPOT, HOUSE_LINE, TEMP_HOUSE_LINE, swapBalls, shotFoul } from './pyramid.js';

/**
 * Computer opponents. `error` is aim noise in radians (the only reason a master
 * misses); `trials` is how many candidate shots are played out on a copy of the
 * table; `spin` lets the player choose follow / draw to improve position.
 */
export const LEVELS = {
  // tuned on self-play with the Russian pockets and ball friction: share of shots (break
  // excluded) that pot a ball in the free pyramid / сибирка — novice ≈22% / 13%,
  // amateur ≈34% / 25%, master ≈43% / 35%
  novice: { id: 'novice', name: 'Новичок', error: 0.025, trials: 6, spin: false },
  amateur: { id: 'amateur', name: 'Любитель', error: 0.011, trials: 16, spin: true },
  master: { id: 'master', name: 'Мастер', error: 0.004, trials: 30, spin: true },
};

/** Spin variants tried for each candidate: stop shot, follow, draw. */
const SPINS = [{ ox: 0, oy: -0.3 }, { ox: 0, oy: 0.55 }, { ox: 0, oy: -0.75 }];
const PLAIN = [{ ox: 0, oy: -0.1 }];

/** Aim points inside each pocket mouth: the centre, then nudged along the rails. */
/**
 * Aim points in each pocket: the middle of the mouth, and a little to either
 * side of it (Russian mouths are barely wider than a ball, so only a few mm).
 */
const AIM_OFFSETS = POCKETS.map((p) => {
  const n = [-p.u[1], p.u[0]];
  const d = Math.max(0, p.mouth / 2 - R) * 0.6 + R * 0.08;
  return [[0, 0], [n[0] * d, n[1] * d], [-n[0] * d, -n[1] * d]];
});
/** Steepest approach to a pocket's axis that still drops: corners about 45°, middles about 50° (table.js). */
const MAX_APPROACH = { corner: Math.cos((44 * Math.PI) / 180), side: Math.cos((50 * Math.PI) / 180) };

/**
 * Plans a shot for the player to move. A generator: each `yield` is one trial on
 * a copy of the table, so the caller can spread the thinking over frames.
 * Resolves to { striker, place, aim, power, ox, oy, elev, kind } where `striker`
 * is a table slot and `place` (only on the break) is where to put it in the house.
 */
export function* planShot(match, level = LEVELS.amateur, { random = Math.random, exact = false } = {}) {
  const t = match.table;
  const noise = exact ? 0 : level.error;
  if (match.isBreak) {
    // a firm break just off the apex: it spreads the pyramid to the cushions (п.13.1)
    const aim = Math.atan2(FOOT_SPOT.y - t.y[0], FOOT_SPOT.x - t.x[0]) + 0.004;
    return { striker: 0, place: null, aim: aim + gaussian(random) * noise, power: 0.92, ox: 0, oy: 0.2, elev: 0, kind: 'разбой' };
  }

  // сибирка: only the coloured ball, and from hand it may only hit balls outside the house
  const ctx = shotContextFor(match);
  // judge the leave by what the next player may really strike (сибирка: only the coloured ball)
  ctx.leave = (sim) => nextShotValue(match, sim, random);
  if (match.kolkhoz && level.spin) Object.assign(ctx, kolkhozTactics(match, random));
  let board = t;
  let place = null;
  if (ctx.fromHandZone) {
    place = bestHandSpot(match, t, ctx.fromHandZone, random);
    board = t.copy();
    board.place(0, place.x, place.y);
  }
  const strikers = [];
  for (let s = 0; s < t.n; s++) if (board.on[s] && (!match.combined || s === 0)) strikers.push(s);
  const candidates = [];
  for (const s of strikers) for (const c of potCandidates(board, s, ctx.skip)) candidates.push({ ...c, striker: s });
  candidates.sort((a, b) => b.score - a.score);

  let best = null;
  const spins = level.spin ? SPINS : PLAIN;
  let trial = 0;
  outer: for (const candidate of candidates) {
    for (const spin of candidate.spins ?? spins) {
      if (trial++ >= level.trials) break outer;
      yield trial;
      // pace for this spin, then the aim allowing for throw
      const power = candidate.vImpact ? powerToArrive(candidate.reach, candidate.vImpact, spin) : candidate.power;
      const paced = { ...candidate, power };
      const c = { ...paced, aim: allowForThrow(board, paced, spin) };
      const direct = playOut(board, c, spin, ctx); // the shot exactly as planned
      let value = direct;
      if (level.spin && direct > 0) {
        // a good player also plays safe for a miss: replay with the level's aim error both ways,
        // so shots that would end without a cushion (п.20) when missed lose value
        const miss = [-1, 1].map((d) => playOut(board, { ...c, aim: c.aim + d * Math.max(level.error, 0.006) }, spin, ctx));
        value = 0.6 * value + 0.2 * (miss[0] + miss[1]);
      }
      if (direct > 0 && (!best || value > best.value)) best = { ...c, ...spin, value };
      // a novice takes the first shot that works
      if (!level.spin && value > 0) break outer;
    }
  }
  if (ctx.missCost) {
    // колхоз: a risky pot is weighed against a safety that leaves the next player little
    const safe = yield* kolkhozSafety(board, strikers, ctx, level);
    if (safe && (!best || safe.value > best.value)) best = { ...safe, ...PLAIN[0] };
  }
  // only when no candidate pots a ball (played exactly) does the computer fall back to a safety
  if (!best) best = { ...safety(board, strikers, ctx), ...PLAIN[0] };
  const hapuga = match.kolkhoz?.hapuga && level.spin ? sureOfIt(board, best, ctx, level) : -1;

  return {
    striker: best.striker,
    place,
    aim: best.aim + gaussian(random) * noise,
    power: Math.min(1, Math.max(0.08, best.power * (1 + gaussian(random) * noise * 2))),
    ox: best.ox,
    oy: best.oy,
    elev: 0,
    kind: best.kind,
    hapuga: hapuga >= 0 ? match.labels[hapuga] : -1, // колхоз: table slot named as «хапуга» → its label
  };
}

/**
 * Колхоз, «хапуга»: a named ball pays one extra point but a miss costs the bet
 * (two by default), so it is only worth naming when the pot is close to sure —
 * the object ball drops when played as planned and with the level's aim error
 * one and a half times either way. Returns the object ball's slot, or -1.
 */
function sureOfIt(t, plan, ctx, level) {
  if (plan.kind !== 'чужой' || plan.obj == null) return -1;
  // withStriker swaps the striker into slot 0: follow the object ball if it sat there
  const obj = plan.obj === 0 ? plan.striker : plan.obj;
  const spread = Math.max(level.error, 0.004) * 1.5;
  for (const d of [0, -spread, spread]) {
    const sim = withStriker(t, plan.striker);
    const startY = Float64Array.from(sim.y);
    sim.shoot(plan.aim + d, plan.power, plan.ox, plan.oy, 0);
    sim.runToRest(20);
    if (shotFoul(sim, { fromHandZone: ctx.fromHandZone, startY }) || !sim.potted.includes(obj)) return -1;
  }
  return plan.obj;
}

/**
 * A candidate's aim corrected for throw, so the ball it steers (the object ball,
 * or the striker on a cut свояк) really leaves for the pocket with this spin.
 */
export function allowForThrow(t, c, spin) {
  const [tx, ty] = c.target;
  return aimThrough(t, c.striker ?? 0, c.obj, c.steer, tx, ty, c.aim, { power: c.power, ...spin });
}

/** Runs a plan to completion synchronously (tests, hints). */
export function planShotNow(match, level, options) {
  const it = planShot(match, level, options);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

/**
 * Clean pots for the ball in slot `s`: «чужой» (object ball into a pocket) and,
 * for nearly straight shots close to a pocket, «свояк» (follow the object ball in).
 */
export function potCandidates(t, s, skip = null) {
  const out = [];
  const sx = t.x[s];
  const sy = t.y[s];
  for (let o = 0; o < t.n; o++) {
    if (o === s || !t.on[o] || skip?.(o)) continue;
    POCKETS.forEach((p, k) => {
      for (const [dx, dy] of AIM_OFFSETS[k]) {
        const px = p.x + dx;
        const py = p.y + dy;
        const dtp = Math.hypot(px - t.x[o], py - t.y[o]);
        const ux = (px - t.x[o]) / dtp;
        const uy = (py - t.y[o]) / dtp;
        // too steep to the pocket's axis: the ball would only hit a jaw
        if (ux * p.u[0] + uy * p.u[1] < (p.side ? MAX_APPROACH.side : MAX_APPROACH.corner)) continue;
        const gx = t.x[o] - ux * 2 * R;
        const gy = t.y[o] - uy * 2 * R;
        if (gx < R || gx > W - R || gy < R || gy > H - R) continue;
        const dcg = Math.hypot(gx - sx, gy - sy);
        if (dcg < 1e-4) continue;
        const cos = ((gx - sx) * ux + (gy - sy) * uy) / dcg;
        if (cos < 0.35) continue;
        if (!t.pathClear(sx, sy, gx, gy, s, o) || !t.pathClear(t.x[o], t.y[o], px, py, o, s)) continue;
        // a little extra: the rub at the contact hands the object ball some back spin
        const vImpact = speedForDistance(dtp * 1.08 + 0.2) / (cos * TRANSFER);
        const power = Math.min(1, speedForDistance(stunDistance(vImpact) + dcg) / MAXV);
        const score = (cos * cos) / (0.4 + dcg + dtp * 1.5);
        const plan = { aim: Math.atan2(gy - sy, gx - sx), obj: o, steer: 'object', target: [px, py], reach: dcg };
        out.push({ ...plan, power, vImpact, score, kind: 'чужой' });
        if (cos > 0.996 && dtp < 0.45) {
          // straight in and close to the pocket: follow through for two balls at once
          out.push({ ...plan, power: Math.min(1, power * 1.4), vImpact: vImpact * 1.4, score: score * 1.25, kind: 'свояк', spins: [{ ox: 0, oy: 0.75 }] });
        }
      }
    });
    out.push(...cutSvoyaks(t, s, o));
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * «Свояк с подрезкой»: a stun shot leaves the object ball along the tangent line,
 * so to send the striking ball s into pocket P off ball o it must meet o where
 * the angle o–contact–P is a right angle — on the circle with diameter oP
 * (Thales) at distance 2R from o.
 */
function cutSvoyaks(t, s, o) {
  const out = [];
  const sx = t.x[s];
  const sy = t.y[s];
  const ox = t.x[o];
  const oy = t.y[o];
  for (const p of POCKETS) {
    const dop = Math.hypot(p.x - ox, p.y - oy);
    if (dop < 3 * R || dop > 0.9) continue;
    // circle |G − o| = 2R meets the Thales circle: angle between oG and oP is acos(2R / |oP|)
    const base = Math.atan2(p.y - oy, p.x - ox);
    const spread = Math.acos(Math.min(1, (2 * R) / dop));
    for (const side of [-1, 1]) {
      const a = base + side * spread;
      const gx = ox + Math.cos(a) * 2 * R;
      const gy = oy + Math.sin(a) * 2 * R;
      if (gx < R || gx > W - R || gy < R || gy > H - R) continue;
      const dcg = Math.hypot(gx - sx, gy - sy);
      if (dcg < 1e-4) continue;
      const dx = (gx - sx) / dcg;
      const dy = (gy - sy) / dcg;
      const nx = (ox - gx) / (2 * R);
      const ny = (oy - gy) / (2 * R);
      const along = dx * nx + dy * ny; // share of the speed given to the object ball
      if (along < 0.25 || along > 0.92) continue;
      const tx = dx - along * nx;
      const ty = dy - along * ny;
      const dgp = Math.hypot(p.x - gx, p.y - gy);
      if (tx * (p.x - gx) + ty * (p.y - gy) < 0.98 * Math.hypot(tx, ty) * dgp) continue; // tangent must point at the pocket
      const ux = (p.x - gx) / dgp;
      const uy = (p.y - gy) / dgp;
      if (ux * p.u[0] + uy * p.u[1] < (p.side ? MAX_APPROACH.side : MAX_APPROACH.corner)) continue;
      if (!t.pathClear(sx, sy, gx, gy, s, o) || !t.pathClear(gx, gy, p.x, p.y, s, o)) continue;
      // the striking ball keeps its tangential speed, less what the rub between the balls takes
      const keep = Math.sqrt(1 - along * along);
      const vImpact = speedForDistance(dgp + 0.2) / (keep * 0.85);
      const power = speedForDistance(stunDistance(vImpact) + dcg) / MAXV;
      if (power > 1) continue;
      out.push({
        aim: Math.atan2(gy - sy, gx - sx), power, vImpact, reach: dcg, kind: 'свояк', obj: o, steer: 'striker', target: [p.x, p.y],
        score: (keep * keep * 0.9) / (0.4 + dcg + dgp * 1.5), spins: [{ ox: 0, oy: -0.25 }, { ox: 0, oy: 0 }],
      });
    }
  }
  return out;
}

/**
 * What the rules need to judge a shot from the current position: in the combined
 * game from hand, which balls may not be hit first (those in the house).
 */
function shotContextFor(match) {
  if (!match.combined || !match.ballInHand || match.isBreak) return { fromHandZone: null, skip: null };
  const temp = match.tempHouse;
  const fromHandZone = (y) => (temp ? y < TEMP_HOUSE_LINE : y > HOUSE_LINE);
  return { fromHandZone, skip: (o) => fromHandZone(match.table.y[o]) };
}

/** Value of a candidate: balls potted, minus fouls, plus how good the next shot looks. */
function playOut(t, c, spin, ctx = {}) {
  const sim = withStriker(t, c.striker);
  const startY = Float64Array.from(sim.y);
  sim.shoot(c.aim, c.power, spin.ox, spin.oy, 0);
  sim.runToRest(20);
  if (shotFoul(sim, { fromHandZone: ctx.fromHandZone, startY })) return -100;
  return shotValue(sim, ctx);
}

/** A legal shot's value: balls potted and the next shot; in колхоз a miss also costs what it hands over. */
function shotValue(sim, ctx) {
  if (!sim.potted.length) return ctx.missCost ? -1 - ctx.missCost(sim) : -1;
  const bonus = ctx.lastBall ? 10 : 0; // the last ball counts double
  return sim.potted.length * 10 + bonus + (ctx.leave ? ctx.leave(sim) : bestLeave(sim)) * 20;
}

/**
 * Колхоз («кольцо»): every ball the next player pots is paid by this one, and
 * what the players before score does not matter. So a miss costs what it leaves
 * the next player, and the last ball — worth double — is worth a risk.
 */
function kolkhozTactics(match, random) {
  return {
    missCost: (sim) => 20 * nextShotValue(match, sim, random),
    lastBall: match.ballsLeft === 1 && match.kolkhoz.lastDouble,
  };
}

/**
 * Колхоз safety: roll a ball gently into a near neighbour so the shot ends
 * legally, and keep the one that leaves the next player the worst table.
 * Tries about half as many shots as the level plans pots.
 */
function* kolkhozSafety(t, strikers, ctx, level) {
  const pairs = [];
  for (const s of strikers) {
    for (let o = 0; o < t.n; o++) {
      if (o === s || !t.on[o] || ctx.skip?.(o) || !t.pathClear(t.x[s], t.y[s], t.x[o], t.y[o], s, o)) continue;
      pairs.push({ s, o, d: Math.hypot(t.x[o] - t.x[s], t.y[o] - t.y[s]) });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  let best = null;
  let tries = Math.ceil(level.trials / 2);
  outer: for (const { s, o } of pairs) {
    const aim = Math.atan2(t.y[o] - t.y[s], t.x[o] - t.x[s]);
    for (const power of [0.3, 0.45]) {
      if (tries-- <= 0) break outer;
      yield tries;
      const sim = withStriker(t, s);
      const startY = Float64Array.from(sim.y);
      sim.shoot(aim, power, 0, -0.1, 0);
      sim.runToRest(20);
      if (shotFoul(sim, { fromHandZone: ctx.fromHandZone, startY })) continue;
      const value = shotValue(sim, ctx);
      if (!best || value > best.value) best = { striker: s, aim, power, kind: 'отыгрыш', value };
    }
  }
  return best;
}

/** Best clean pot available to the next shot (from any ball, or only `strikers`). */
export function bestLeave(t, strikers = null) {
  let best = 0;
  for (let s = 0; s < t.n; s++) {
    if (!t.on[s] || (strikers && !strikers.includes(s))) continue;
    const c = potCandidates(t, s)[0];
    if (c && c.score > best) best = c.score;
  }
  return best;
}

/**
 * Nothing to pot: a gentle shot that still ends legally (п.20) — try rolling
 * each ball into its nearest neighbours and keep the first that is no foul.
 */
function safety(t, strikers, ctx = {}) {
  let fallback = null;
  for (const s of strikers) {
    for (let o = 0; o < t.n; o++) {
      if (o === s || !t.on[o] || ctx.skip?.(o) || !t.pathClear(t.x[s], t.y[s], t.x[o], t.y[o], s, o)) continue;
      const aim = Math.atan2(t.y[o] - t.y[s], t.x[o] - t.x[s]);
      for (const power of [0.35, 0.5, 0.7]) {
        const shot = { striker: s, aim, power, kind: 'отыгрыш' };
        fallback ??= shot;
        const sim = withStriker(t, s);
        const startY = Float64Array.from(sim.y);
        sim.shoot(aim, power, 0, -0.1, 0);
        sim.runToRest(20);
        if (!shotFoul(sim, { fromHandZone: ctx.fromHandZone, startY })) return shot;
      }
    }
  }
  return fallback ?? { striker: 0, aim: -Math.PI / 2, power: 0.4, kind: 'отыгрыш' };
}

/** How good the next shot looks for whoever plays it (from hand, if the cue ball is off the table). */
function nextShotValue(match, t, random = Math.random) {
  if (!match.combined) return bestLeave(t);
  if (t.on[0]) return bestLeave(t, [0]);
  const zone = (y) => y > HOUSE_LINE;
  return bestHandSpot(match, t, zone, random, 8).score;
}

/** Takes the ball whose removal leaves the best next shot (penalty ball, or the ball for a свояк in сибирка). */
function bestBallToTake(match) {
  const t = match.table;
  let best = { slot: -1, value: -1 };
  for (let i = 0; i < t.n; i++) {
    if (!match.canTake(i)) continue;
    const c = t.copy();
    c.on[i] = false;
    const value = nextShotValue(match, c);
    if (value > best.value) best = { slot: i, value };
  }
  return best.slot;
}

/** After the opponent's foul: the ball to take as the penalty ball. */
export const choosePenaltyBall = bestBallToTake;
/** Сибирка, after its own свояк: the object ball to take for the cue ball. */
export const chooseSvoyakBall = bestBallToTake;

/** After the opponent's foul: play on if there is a decent shot, otherwise hand the table back (п.7.4). */
export function chooseNextOption(match) {
  return nextShotValue(match, match.table) > 0.12 ? 'play' : 'pass';
}

/** Сибирка from hand: the spot in the (temporary) house with the best clean pot on a ball outside it. */
function bestHandSpot(match, t, forbidden, random, tries = 24) {
  let best = { x: 0.5, y: H * 0.82, score: -1 };
  const lo = forbidden(R) ? R : HOUSE_LINE + R; // the zone the cue ball stands in is the forbidden one
  const hi = forbidden(R) ? TEMP_HOUSE_LINE - R : H - R;
  const board = t.copy();
  for (let k = 0; k < tries; k++) {
    const x = R + random() * (W - 2 * R);
    const y = lo + random() * (hi - lo);
    if (!board.isFree(x, y, 0)) continue;
    board.place(0, x, y);
    const score = potCandidates(board, 0, (o) => forbidden(board.y[o]))[0]?.score ?? 0;
    if (score > best.score) best = { x, y, score };
  }
  if (best.score < 0) {
    const spot = match.freeHouseSpot();
    best = { ...spot, score: 0 };
  }
  return best;
}

/** Copy of the table with slot s swapped into slot 0 (the ball physics strikes). */
export function withStriker(t, s) {
  const c = t.copy();
  if (s !== 0) swapBalls(c, 0, s);
  return c;
}

function gaussian(random) {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}
