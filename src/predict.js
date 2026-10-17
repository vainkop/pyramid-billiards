import { POCKETS } from './physics.js';

/** How much of an ordinary path after the contact is shown (table units). */
const SHOWN = 0.45;
/** Fine steps, so the line follows the finger smoothly instead of in frame-sized jumps. */
const DT = 1 / 240;
const MAX_STEPS = 6 * 240;
/** A ball heading into a pocket usually brushes a jaw first: look this far past the first touch. */
const LOOK_PAST = 0.5 * 240;

/**
 * Plays a shot on a copy of the table and reports what happens at and after the
 * first contact of the struck ball (slot 0):
 *
 *   points   [x0, y0, x1, y1, …] — its path off the contact: up to its next
 *            cushion or ball, at most SHOWN long, or all the way into the
 *            pocket when it drops (a свояк, then `pocket` ≥ 0)
 *   object   the ball it meets first (or -1), and `objectDir`, the direction
 *            that ball leaves in — off the line of centres by the throw
 *
 * Everything comes from the same physics as the real shot, spin, power and
 * throw included.
 */
export function predictStrikerPath(phys, aim, { power, ox = 0, oy = 0, elev = 0 }) {
  const p = phys.copy();
  p.shoot(aim, Math.max(0.03, power), ox, oy, elev);
  const result = { points: [], pocket: -1, object: -1, objectDir: 0 };
  let step = 0;
  for (; step < MAX_STEPS && p.moving() && p.firstHit < 0 && p.on[0]; step++) p.step(DT);
  if (p.firstHit < 0) return result;
  result.object = p.firstHit;
  result.objectDir = Math.atan2(p.vy[p.firstHit], p.vx[p.firstHit]);

  const pts = [p.x[0], p.y[0]];
  let length = 0;
  let cut = -1; // where the shown stretch ends: [x, y]
  let touchedAt = -1;
  const touches = () => p.events.some((e) => (e.type === 'rail' && e.ball === 0) || (e.type === 'hit' && (e.a === 0 || e.b === 0)));
  for (; step < MAX_STEPS && p.moving(); step++) {
    p.step(DT);
    if (!p.on[0]) {
      if (p.pocketOf[0] >= 0) {
        // a свояк is shown all the way into the pocket
        const M = POCKETS[p.pocketOf[0]].M;
        return { ...result, points: [...pts, M[0], M[1]], pocket: p.pocketOf[0] };
      }
      break; // flew off the table
    }
    const x = p.x[0];
    const y = p.y[0];
    const n = pts.length;
    const d = Math.hypot(x - pts[n - 2], y - pts[n - 1]);
    if (d === 0) {
      if (!p.vx[0] && !p.vy[0] && touchedAt < 0) break; // came to rest
      continue;
    }
    if (cut === -1 && length + d >= SHOWN) {
      // end exactly at SHOWN, not at whichever step crossed it
      const k = (SHOWN - length) / d;
      cut = [pts[n - 2] + (x - pts[n - 2]) * k, pts[n - 1] + (y - pts[n - 1]) * k];
    }
    length += d;
    pts.push(x, y);
    if (touchedAt < 0 && touches()) {
      touchedAt = step;
      if (cut === -1) cut = [x, y];
    }
    if (touchedAt >= 0 && step - touchedAt > LOOK_PAST) break;
    if (cut !== -1 && touchedAt < 0 && length > SHOWN * 4) break; // long gone: no pocket near enough to matter
  }
  // not a свояк: only the first stretch
  if (cut === -1) return { ...result, points: pts };
  const shown = [];
  let run = 0;
  for (let k = 0; k < pts.length; k += 2) {
    if (k > 0) run += Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]);
    if (run >= SHOWN || (pts[k] === cut[0] && pts[k + 1] === cut[1])) break;
    shown.push(pts[k], pts[k + 1]);
  }
  shown.push(cut[0], cut[1]);
  return { ...result, points: shown };
}
