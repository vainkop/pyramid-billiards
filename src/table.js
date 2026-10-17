/**
 * Geometry of a Russian pyramid table in "table units": the playing surface is
 * W × H with the cushion noses on x = 0, x = W, y = 0, y = H.
 *
 * Pockets follow the МКП technical requirements adopted by ФБСР: corner mouth
 * 72–73 mm, middle mouth 82–83 mm for 67–68 mm balls; corner jaws rounded with
 * R 5 mm and a 5–6 mm corridor, cheeks at 135° to the cushion; middle jaws
 * rounded with R 11 mm, no corridor, cheeks at 90°. The balls are drawn larger
 * than life so they read on a phone, so every pocket size is scaled to the ball:
 * one "mm" below is 1/68 of a ball diameter.
 */

export const W = 1;
export const H = 2;
export const R = 0.024;

const MM = (2 * R) / 68;
export const CORNER = { mouth: 72.5 * MM, jaw: 5 * MM, corridor: 5.5 * MM };
export const SIDE = { mouth: 82.5 * MM, jaw: 11 * MM, corridor: 0 };

/** Restitution of the cushion nose. */
export const E_CUSHION = 0.72;
/**
 * Pocket jaws and cheeks swallow a soft impact ("приёмистость") but a hard ball
 * rattles and is spat back out: their restitution grows with the impact speed.
 */
export function jawRestitution(normalSpeed) {
  return 0.35 + 0.4 * Math.min(1, normalSpeed / 2.5);
}
export const E_JAW = 'jaw';

const S2 = Math.SQRT1_2;

/**
 * Builds the obstacles: straight segments (cushion noses and pocket cheeks)
 * and jaw roundings (circles), each tagged with the cushion it belongs to,
 * and the six pockets with their mouth and drop test.
 */
function build() {
  const segments = [];
  const jaws = [];
  const pockets = [];

  /** Rounds the corner at J between the cushion face (going along `a`) and the cheek (going along `b`). */
  function corner(J, a, b, r, rail) {
    const cos = a[0] * b[0] + a[1] * b[1];
    const half = Math.acos(Math.max(-1, Math.min(1, cos))) / 2;
    const t = r / Math.tan(half);
    const bx = a[0] + b[0];
    const by = a[1] + b[1];
    const bl = Math.hypot(bx, by);
    const d = r / Math.sin(half);
    jaws.push({ x: J[0] + (bx / bl) * d, y: J[1] + (by / bl) * d, r, rail });
    return { face: [J[0] + a[0] * t, J[1] + a[1] * t], cheek: [J[0] + b[0] * t, J[1] + b[1] * t] };
  }

  const seg = (p, q, rail, e) => segments.push({ ax: p[0], ay: p[1], bx: q[0], by: q[1], rail, e });

  // corner pockets: jaws on both cushions, cheeks parallel to the pocket axis (45°)
  const a = CORNER.mouth / Math.SQRT2;
  const cornerDefs = [
    { J1: [a, 0], J2: [0, a], u: [-S2, -S2], rails: ['top', 'left'], f1: [1, 0], f2: [0, 1] },
    { J1: [W - a, 0], J2: [W, a], u: [S2, -S2], rails: ['top', 'right'], f1: [-1, 0], f2: [0, 1] },
    { J1: [a, H], J2: [0, H - a], u: [-S2, S2], rails: ['bottom', 'left'], f1: [1, 0], f2: [0, -1] },
    { J1: [W - a, H], J2: [W, H - a], u: [S2, S2], rails: ['bottom', 'right'], f1: [-1, 0], f2: [0, -1] },
  ];
  const faceEnds = {}; // where each cushion nose ends at each pocket, for the face segments
  cornerDefs.forEach((c, k) => {
    const r1 = corner(c.J1, c.f1, c.u, CORNER.jaw, c.rails[0]);
    const r2 = corner(c.J2, c.f2, c.u, CORNER.jaw, c.rails[1]);
    const depth = CORNER.corridor + R * 0.6; // cheeks run a little past the corridor to the drop
    seg(r1.cheek, [c.J1[0] + c.u[0] * depth, c.J1[1] + c.u[1] * depth], c.rails[0], E_JAW);
    seg(r2.cheek, [c.J2[0] + c.u[0] * depth, c.J2[1] + c.u[1] * depth], c.rails[1], E_JAW);
    faceEnds[`${k}:${c.rails[0]}`] = r1.face;
    faceEnds[`${k}:${c.rails[1]}`] = r2.face;
    const M = [(c.J1[0] + c.J2[0]) / 2, (c.J1[1] + c.J2[1]) / 2];
    pockets.push(pocket(M, c.u, CORNER, [c.J1, c.J2], false));
  });

  // middle pockets on the long cushions: 90° jaws, no corridor
  const m = SIDE.mouth / 2;
  const sideDefs = [
    { x: 0, u: [-1, 0], rail: 'left' },
    { x: W, u: [1, 0], rail: 'right' },
  ];
  sideDefs.forEach((s) => {
    const J1 = [s.x, H / 2 - m];
    const J2 = [s.x, H / 2 + m];
    const r1 = corner(J1, [0, -1], s.u, SIDE.jaw, s.rail);
    const r2 = corner(J2, [0, 1], s.u, SIDE.jaw, s.rail);
    const depth = R * 0.9;
    seg(r1.cheek, [J1[0] + s.u[0] * depth, J1[1]], s.rail, E_JAW);
    seg(r2.cheek, [J2[0] + s.u[0] * depth, J2[1]], s.rail, E_JAW);
    faceEnds[`side:${s.rail}:up`] = r1.face;
    faceEnds[`side:${s.rail}:down`] = r2.face;
    pockets.push(pocket([s.x, H / 2], s.u, SIDE, [J1, J2], true));
  });

  // cushion noses between the pockets
  seg(faceEnds['0:top'], faceEnds['1:top'], 'top', E_CUSHION);
  seg(faceEnds['2:bottom'], faceEnds['3:bottom'], 'bottom', E_CUSHION);
  seg(faceEnds['0:left'], faceEnds['side:left:up'], 'left', E_CUSHION);
  seg(faceEnds['side:left:down'], faceEnds['2:left'], 'left', E_CUSHION);
  seg(faceEnds['1:right'], faceEnds['side:right:up'], 'right', E_CUSHION);
  seg(faceEnds['side:right:down'], faceEnds['3:right'], 'right', E_CUSHION);

  // pockets in the order used everywhere: TL, TR, middle left, middle right, BL, BR
  return { segments, jaws, pockets: [pockets[0], pockets[1], pockets[4], pockets[5], pockets[2], pockets[3]] };
}

/**
 * A pocket: `M` the middle of the mouth, `u` the direction into the pocket.
 * A ball drops once its centre is past the corridor (п. drop) — before that it
 * can still rattle on the cheeks and come back out.
 */
function pocket(M, u, spec, jaws, side) {
  const drop = spec.corridor + R * (side ? 0.45 : 0.4);
  return {
    side,
    drop,
    mouth: spec.mouth,
    M,
    u,
    jaws,
    /**
     * Where to send a ball: just inside the middle of the mouth («в створ»). Aiming
     * deeper, at the back of the pocket, makes an angled ball clip the near jaw.
     */
    x: M[0] + u[0] * R * 0.2,
    y: M[1] + u[1] * R * 0.2,
    /** Visual radius of the hole. */
    r: spec.mouth * 0.62,
    depthOf(x, y) {
      return (x - M[0]) * u[0] + (y - M[1]) * u[1];
    },
    drops(x, y) {
      const along = this.depthOf(x, y);
      const across = Math.abs((x - M[0]) * -u[1] + (y - M[1]) * u[0]);
      return along > drop && across < spec.mouth / 2 + R;
    },
  };
}

const GEOMETRY = build();
export const SEGMENTS = GEOMETRY.segments;
export const JAWS = GEOMETRY.jaws;
export const POCKETS = GEOMETRY.pockets;

/**
 * Pocket a ball rolling from (x, y) along the unit direction (dx, dy) would go
 * cleanly into, or -1 — a hint for the aiming line. "Cleanly" means the path
 * meets the mouth close to its middle and not too steeply (see the acceptance
 * measured for these pockets: about ±10 mm for a corner, ±18 mm for a middle).
 */
export function pocketAhead(x, y, dx, dy) {
  for (let k = 0; k < POCKETS.length; k++) {
    const p = POCKETS[k];
    const mx = p.M[0] - x;
    const my = p.M[1] - y;
    if (mx * dx + my * dy <= 0) continue;
    const cos = dx * p.u[0] + dy * p.u[1];
    if (cos < (p.side ? 0.67 : 0.77)) continue;
    const lateral = Math.abs(mx * dy - my * dx);
    if (lateral < (p.side ? 14 : 8) * MM * cos) return k;
  }
  return -1;
}
