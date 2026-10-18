import { W, H, R, POCKETS, TICK } from './physics.js';
import { SEGMENTS, E_CUSHION, CORNER } from './table.js';
import { predictStrikerPath } from './predict.js';
import { SVOYAK, MASSE } from './drills.js';
import { MISCUE_LIMIT } from './content.js';
import { CanvasSurface } from './canvas.js';

const RAIL = 0.075;
const CUSHION = 0.026;
const FULL_VIEW = { x0: -RAIL, y0: -RAIL, x1: W + RAIL, y1: H + RAIL };
/** Shots are replayed faster than real time: heavy pyramid balls take a while to stop. */
const PLAYBACK = 1.5;

export const TRAINER = 'trainer';
export const DRILL = 'drill';
export const DEMO = 'demo';
export const GAME = 'game';
const LONG_PRESS_MS = 450;
/** How long a ball that flew off the table takes to disappear over the cushion. */
const FLIGHT_MS = 700;
const DRAG_SLOP = 8; // px of movement that turns a press into an aim drag
/** Closer to the cue ball than this (table units), dragging turns the aim proportionally slower. */
const FINE_AIM_RADIUS = 0.5;
/**
 * A finger leaving the glass rolls a little and drags the aim with it: on release
 * the aim goes back to where it was this long before, if it moved less than
 * LIFT_TURN since — a deliberate turn is larger.
 */
const LIFT_MS = 100;
const LIFT_TURN = 0.05;

/**
 * Canvas view of a Russian pyramid table. Animates shots and shows aiming aids:
 * the full predicted paths in the trainer, just the ghost ball elsewhere.
 */
export class TableView {
  /**
   * @param options.labels      GAME: number painted on the ball in each table slot (0 = plain ball)
   * @param options.onSelectBall GAME: long press on a ball
   * @param options.canPlace     GAME: (x, y) → may the struck ball be dragged there (ball in hand)
   */
  /**
   * @param options.canPick   GAME: which balls may be picked in pick mode
   * @param options.handZone  GAME: () => [y0, y1] band where the struck ball may be placed from hand, or null
   */
  constructor(canvas, { mode, onShotDone, onSelectBall, onPick, canPick, canPlace, handZone, marked, labels = null }) {
    this.mode = mode;
    this.onShotDone = onShotDone;
    this.onSelectBall = onSelectBall;
    /** GAME: while `pickMode` is on, a tap on any ball calls onPick (taking the penalty ball). */
    this.onPick = onPick;
    this.canPick = canPick ?? (() => true);
    /** GAME: the table slot to ring in red — the ball named as «хапуга» in колхоз — or -1. */
    this.marked = marked ?? (() => -1);
    this.handZone = handZone;
    this.pickMode = false;
    this.canPlace = canPlace;
    this.labels = labels;
    this.hint = false;
    this.aim = -Math.PI / 2;
    this.params = { power: 0.4, ox: 0, oy: 0, elev: 0 };
    this.showPath = true;
    this.animating = false;
    this.preview = null;
    this.view = { ...FULL_VIEW };
    this.surface = new CanvasSurface(canvas, (ctx, w, h) => this.paint(ctx, w, h));
    this.surface.onResize = () => this.layout();
    if (mode !== DEMO) this.bindInput(canvas);
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.pending);
    this.surface.destroy();
  }

  get busy() {
    return this.animating;
  }

  setPhysics(phys, drill = null) {
    this.phys = phys;
    this.drill = drill;
    this.animating = false;
    clearTimeout(this.pending);
    if (phys.n > 1 && phys.on[1]) this.aim = Math.atan2(phys.y[1] - phys.y[0], phys.x[1] - phys.x[0]);
    if (this.mode === DEMO && drill) this.fitDemoView();
    this.layout();
    this.invalidate();
  }

  setParams(params) {
    Object.assign(this.params, params);
    this.invalidate();
  }

  nudgeAim(d) {
    this.aim += d;
    this.invalidate();
  }

  invalidate() {
    this.preview = null;
    this.cuePath = null;
    this.dirty = true;
  }

  /**
   * @param fire replaces `phys.shoot` (the game records each shot in its rules)
   * @returns {boolean} false if a shot is already running
   */
  shoot({ allowMiscue = true, fire } = {}) {
    if (this.animating || !this.phys?.on[0]) return false;
    let { power, ox, oy, elev } = this.params;
    let aim = this.aim;
    this.miscue = false;
    if (allowMiscue && Math.hypot(ox, oy) > MISCUE_LIMIT && Math.random() < 0.6) {
      this.miscue = true;
      aim += (Math.random() - 0.5) * 0.3;
      power *= 0.25;
      ox = oy = 0;
    }
    (fire ?? this.phys.shoot.bind(this.phys))(aim, Math.max(0.03, power), ox, oy, elev);
    this.hint = false;
    this.fx = []; // balls flying off the table during this shot
    this.animating = true;
    this.last = null; // the first animation frame sets the clock
    this.lag = 0; // table time owed to the shot, played in whole TICKs
    return true;
  }

  /** Resets the drill and plays its reference shot after a short pause. */
  playDemo(delay = 700) {
    const d = this.drill;
    if (!d) return;
    this.setPhysics(d.setup(), d);
    this.aim = d.solutionAim(this.phys);
    this.setParams(d.solution);
    this.pending = setTimeout(() => this.shoot({ allowMiscue: false }), delay);
  }

  // ------------------------------------------------------------ geometry

  fitDemoView() {
    const t = this.drill.setup();
    t.record = true;
    const { power, ox, oy, elev } = this.drill.solution;
    t.shoot(this.drill.solutionAim(t), power, ox, oy, elev);
    t.runToRest();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const track of t.tracks) {
      for (let k = 0; k < track.length; k += 2) {
        x0 = Math.min(x0, track[k]);
        x1 = Math.max(x1, track[k]);
        y0 = Math.min(y0, track[k + 1]);
        y1 = Math.max(y1, track[k + 1]);
      }
    }
    const pad = 0.14;
    this.baseView = {
      x0: Math.max(FULL_VIEW.x0, x0 - pad),
      y0: Math.max(FULL_VIEW.y0, y0 - pad),
      x1: Math.min(FULL_VIEW.x1, x1 + pad),
      y1: Math.min(FULL_VIEW.y1, y1 + pad),
    };
  }

  layout() {
    const { width, height } = this.surface;
    if (!width || !height) return;
    const v = { ...(this.mode === DEMO && this.baseView ? this.baseView : FULL_VIEW) };
    if (this.mode === DEMO) {
      // grow the cropped view to the canvas aspect so nothing is stretched
      const aspect = width / height;
      const vw = v.x1 - v.x0;
      const vh = v.y1 - v.y0;
      if (vw / vh < aspect) {
        const cx = (v.x0 + v.x1) / 2;
        v.x0 = cx - (vh * aspect) / 2;
        v.x1 = cx + (vh * aspect) / 2;
      } else {
        const cy = (v.y0 + v.y1) / 2;
        v.y0 = cy - vw / aspect / 2;
        v.y1 = cy + vw / aspect / 2;
      }
    }
    this.view = v;
    const vw = v.x1 - v.x0;
    const vh = v.y1 - v.y0;
    this.s = Math.min(width / vw, height / vh);
    this.offX = (width - vw * this.s) / 2 - v.x0 * this.s;
    this.offY = (height - vh * this.s) / 2 - v.y0 * this.s;
    this.sprites = makeBallSprites(Math.max(8, R * this.s * 2), this.surface.ctx);
    this.dirty = true;
  }

  sx(x) { return this.offX + x * this.s; }
  sy(y) { return this.offY + y * this.s; }

  // ------------------------------------------------------------ loop

  loop(now) {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.phys || !this.s) return;
    if (this.animating) {
      // rAF timestamps are frame start times and may predate the shot itself
      const dt = this.last === null ? 0 : Math.min(0.033, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      // fixed steps, as the aiming lines were predicted, whatever the frame rate
      if (this.skip) this.phys.runToRest(30, TICK);
      else {
        this.lag += dt * PLAYBACK;
        for (; this.lag >= TICK && this.phys.moving(); this.lag -= TICK) this.phys.step(TICK);
      }
      this.skip = false;
      // a ball that flew off is shown leaving the table before the shot counts as over
      while (this.fx.length < this.phys.flights.length) this.fx.push({ ...this.phys.flights[this.fx.length], t0: now });
      const flying = this.fx.some((f) => now - f.t0 < FLIGHT_MS);
      if (!this.phys.moving() && !flying) {
        this.animating = false;
        this.invalidate();
        this.onShotDone?.(this.phys, this.miscue);
      }
      this.dirty = true;
    }
    // zones and target pockets pulse, so drills repaint continuously
    if (this.dirty || (this.drill && this.mode !== DEMO) || this.animating || this.pickMode) {
      this.dirty = false;
      this.surface.draw();
    }
  }

  // ------------------------------------------------------------ painting

  paint(ctx, w, hgt) {
    if (!this.phys || !this.s) return;
    if (this.mode === DEMO) {
      ctx.fillStyle = '#2b140a';
      ctx.fillRect(0, 0, w, hgt);
    }
    this.paintTable(ctx);
    this.paintHandZone(ctx);
    this.paintTargets(ctx);
    if (!this.animating && !this.pickMode) {
      if ((this.mode === TRAINER && this.showPath) || this.hint) this.paintPreview(ctx);
      else this.paintGuide(ctx);
    }
    for (let i = this.phys.n - 1; i >= 0; i--) if (this.phys.on[i]) this.paintBall(ctx, i);
    if (this.animating && this.fx?.length) this.paintFlights(ctx);
    if (!this.animating && !this.pickMode && this.phys.on[0] && this.mode !== DEMO) this.paintCue(ctx);
  }

  paintTable(ctx) {
    const { s } = this;
    const l = this.sx(-RAIL), t = this.sy(-RAIL), r = this.sx(W + RAIL), b = this.sy(H + RAIL);
    const wood = ctx.createLinearGradient(l, 0, r, 0);
    ['#3b1a0c', '#6b3218', '#4a2210', '#6b3218', '#3b1a0c'].forEach((c, k) => wood.addColorStop(k / 4, c));
    ctx.fillStyle = wood;
    roundRect(ctx, l, t, r - l, b - t, s * 0.05);
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,192,128,.33)';
    ctx.lineWidth = Math.max(1, s * 0.004);
    roundRect(ctx, l + s * 0.012, t + s * 0.012, r - l - s * 0.024, b - t - s * 0.024, s * 0.04);
    ctx.stroke();

    // brass corner plates and middle plates around the pockets
    for (const p of POCKETS) this.paintPocketPlate(ctx, p);

    const cloth = ctx.createRadialGradient(this.sx(W / 2), this.sy(H / 2), 0, this.sx(W / 2), this.sy(H / 2), H * 0.75 * s);
    cloth.addColorStop(0, '#2a9a62');
    cloth.addColorStop(0.6, '#1c7449');
    cloth.addColorStop(1, '#125536');
    ctx.fillStyle = cloth;
    ctx.fillRect(this.sx(0), this.sy(0), W * s, H * s);

    for (const p of POCKETS) this.paintPocket(ctx, p);
    for (const seg of SEGMENTS) if (seg.e === E_CUSHION) this.paintCushion(ctx, seg);

    // aiming marks on the rails, the "дом" line and the spots
    ctx.fillStyle = '#e2c48a';
    const dr = Math.max(1.5, s * 0.006);
    const off = (RAIL + CUSHION) / 2;
    for (let i = 1; i < 4; i++) {
      dot(ctx, this.sx((W * i) / 4), this.sy(-off), dr);
      dot(ctx, this.sx((W * i) / 4), this.sy(H + off), dr);
    }
    for (let i = 1; i < 8; i++) {
      if (i === 4) continue;
      dot(ctx, this.sx(-off), this.sy((H * i) / 8), dr);
      dot(ctx, this.sx(W + off), this.sy((H * i) / 8), dr);
    }
    ctx.fillStyle = 'rgba(255,255,255,.15)';
    ctx.fillRect(this.sx(0), this.sy(H * 0.75) - 0.75, W * s, 1.5);
    dot(ctx, this.sx(W / 2), this.sy(H * 0.25), dr);
    dot(ctx, this.sx(W / 2), this.sy(H * 0.75), dr);
  }

  /** Where the hole of pocket p sits: past the mouth and corridor, along the pocket's axis. */
  holeOf(p) {
    // the hole opens at the drop line and never reaches back over the cloth
    const r = p.mouth * 0.56;
    const depth = p.drop + r * 0.8;
    return { x: p.M[0] + p.u[0] * depth, y: p.M[1] + p.u[1] * depth, r };
  }

  paintPocketPlate(ctx, p) {
    const h = this.holeOf(p);
    const x = this.sx(h.x);
    const y = this.sy(h.y);
    const rr = (p.side ? RAIL * 0.62 : RAIL * 0.85) * this.s;
    const g = ctx.createRadialGradient(x - rr * 0.3, y - rr * 0.3, rr * 0.1, x, y, rr);
    g.addColorStop(0, '#f2d79a');
    g.addColorStop(0.55, '#b8893e');
    g.addColorStop(1, '#6e4d1c');
    ctx.fillStyle = g;
    dot(ctx, x, y, rr);
  }

  /** The mouth between the jaws, the corridor of a corner pocket and the hole with its leather rim. */
  paintPocket(ctx, p) {
    const { s } = this;
    const h = this.holeOf(p);
    const [J1, J2] = p.jaws;
    const deep = p.drop + p.mouth * 0.3;
    ctx.fillStyle = '#123f29'; // cloth in the throat, in shadow
    ctx.beginPath();
    ctx.moveTo(this.sx(J1[0]), this.sy(J1[1]));
    ctx.lineTo(this.sx(J2[0]), this.sy(J2[1]));
    ctx.lineTo(this.sx(J2[0] + p.u[0] * deep), this.sy(J2[1] + p.u[1] * deep));
    ctx.lineTo(this.sx(J1[0] + p.u[0] * deep), this.sy(J1[1] + p.u[1] * deep));
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2a160a'; // leather rim
    dot(ctx, this.sx(h.x), this.sy(h.y), h.r * s * 1.18);
    const g = ctx.createRadialGradient(this.sx(h.x), this.sy(h.y), 0, this.sx(h.x), this.sy(h.y), h.r * s);
    g.addColorStop(0, '#000');
    g.addColorStop(1, '#0c0705');
    ctx.fillStyle = g;
    dot(ctx, this.sx(h.x), this.sy(h.y), h.r * s);
  }

  /**
   * The rubber of one cushion between two pockets. Its ends follow the pocket
   * cheeks: cut at 45° at the corners (135° jaws), square at the middle pockets.
   */
  paintCushion(ctx, seg) {
    const { s } = this;
    const A = [seg.ax, seg.ay];
    const B = [seg.bx, seg.by];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const d = [(B[0] - A[0]) / len, (B[1] - A[1]) / len];
    const out = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] }[seg.rail];
    const nearCorner = (P) => (P[0] < 0.2 || P[0] > W - 0.2) && (P[1] < 0.2 || P[1] > H - 0.2);
    const c = CUSHION;
    const outerA = nearCorner(A) ? [A[0] + out[0] * c - d[0] * c, A[1] + out[1] * c - d[1] * c] : [A[0] + out[0] * c, A[1] + out[1] * c];
    const outerB = nearCorner(B) ? [B[0] + out[0] * c + d[0] * c, B[1] + out[1] * c + d[1] * c] : [B[0] + out[0] * c, B[1] + out[1] * c];
    ctx.fillStyle = '#0f5a35';
    ctx.beginPath();
    ctx.moveTo(this.sx(A[0]), this.sy(A[1]));
    ctx.lineTo(this.sx(B[0]), this.sy(B[1]));
    ctx.lineTo(this.sx(outerB[0]), this.sy(outerB[1]));
    ctx.lineTo(this.sx(outerA[0]), this.sy(outerA[1]));
    ctx.closePath();
    ctx.fill();
    // the nose of the cushion catches the light
    ctx.strokeStyle = 'rgba(160,230,190,.22)';
    ctx.lineWidth = Math.max(1, s * 0.003);
    ctx.beginPath();
    ctx.moveTo(this.sx(A[0]), this.sy(A[1]));
    ctx.lineTo(this.sx(B[0]), this.sy(B[1]));
    ctx.stroke();
  }

  /** Gold wash over the house (or temporary house) while the struck ball may be placed by hand. */
  paintHandZone(ctx) {
    const zone = !this.animating && this.handZone?.();
    if (!zone) return;
    const [y0, y1] = zone;
    ctx.fillStyle = 'rgba(217,179,108,.10)';
    ctx.fillRect(this.sx(0), this.sy(y0), W * this.s, (y1 - y0) * this.s);
    ctx.strokeStyle = 'rgba(217,179,108,.55)';
    ctx.lineWidth = Math.max(1.5, this.s * 0.003);
    ctx.setLineDash([this.s * 0.014, this.s * 0.01]);
    const edge = y0 <= 0 ? y1 : y0;
    ctx.beginPath();
    ctx.moveTo(this.sx(0), this.sy(edge));
    ctx.lineTo(this.sx(W), this.sy(edge));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  paintTargets(ctx) {
    const d = this.drill;
    if (!d) return;
    const { s } = this;
    const t = performance.now();
    if (d.hasZone) {
      d.prepare();
      const zx = this.sx(d.zone.x), zy = this.sy(d.zone.y), zr = d.zoneR * s;
      ctx.fillStyle = 'rgba(217,179,108,.15)';
      dot(ctx, zx, zy, zr);
      ctx.strokeStyle = '#d9b36c';
      ctx.lineWidth = Math.max(2, s * 0.004);
      ctx.setLineDash([s * 0.014, s * 0.01]);
      ctx.lineDashOffset = -t / 40;
      ctx.beginPath();
      ctx.arc(zx, zy, zr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#d9b36c';
      ctx.font = `700 ${Math.max(9, zr * 0.42)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('ЗОНА', zx, zy - zr - 4);
    }
    if (d.type === SVOYAK) {
      const p = POCKETS[d.cuePocket >= 0 ? d.cuePocket : d.pocket];
      const pulse = 0.5 + 0.5 * Math.sin(t / 260);
      ctx.strokeStyle = `rgba(217,179,108,${0.45 + 0.55 * pulse})`;
      ctx.lineWidth = Math.max(2, s * 0.005);
      ctx.beginPath();
      ctx.arc(this.sx(p.x), this.sy(p.y), p.r * s * 1.9, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  paintBall(ctx, i) {
    const x = this.sx(this.phys.x[i]);
    const y = this.sy(this.phys.y[i]);
    const r = R * this.s;
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    dot(ctx, x + r * 0.18, y + r * 0.26, r * 1.02);
    const label = this.labels ? this.labels[i] : i;
    ctx.drawImage(label === 0 ? this.sprites.cue : this.sprites.ball, x - r, y - r, 2 * r, 2 * r);
    if (label > 0) {
      ctx.fillStyle = '#1b1410';
      ctx.font = `700 ${r * (label > 9 ? 0.82 : 0.95)}px Georgia, 'Times New Roman', serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(label), x, y + r * 0.04);
    }
    ctx.drawImage(this.sprites.gloss, x - r, y - r, 2 * r, 2 * r);
    if (this.pickMode && this.canPick(i)) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 220);
      ctx.strokeStyle = `rgba(232,201,133,${0.35 + 0.5 * pulse})`;
      ctx.lineWidth = Math.max(2, r * 0.14);
      ctx.beginPath();
      ctx.arc(x, y, r * (1.35 + 0.15 * pulse), 0, Math.PI * 2);
      ctx.stroke();
    } else if (this.mode === GAME && i === 0 && !this.animating) {
      // the ball about to be struck
      ctx.strokeStyle = 'rgba(232,201,133,.9)';
      ctx.lineWidth = Math.max(2, r * 0.14);
      ctx.beginPath();
      ctx.arc(x, y, r * 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (this.mode === GAME && i === this.marked()) {
      // колхоз: the ball named as «хапуга»
      ctx.strokeStyle = 'rgba(224,104,84,.95)';
      ctx.lineWidth = Math.max(2, r * 0.16);
      ctx.setLineDash([r * 0.45, r * 0.3]);
      ctx.beginPath();
      ctx.arc(x, y, r * 1.75, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const d = this.drill;
    if (d && !this.animating && this.mode !== DEMO && (i === 1 || (d.type === MASSE && i === 2))) {
      ctx.strokeStyle = i === 1 ? 'rgba(217,179,108,.7)' : 'rgba(208,97,79,.7)';
      ctx.lineWidth = Math.max(2, r * 0.12);
      ctx.beginPath();
      ctx.arc(x, y, r * 1.45, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** Balls that flew off: they rise (grow), carry on over the cushion and fade. */
  paintFlights(ctx) {
    const now = performance.now();
    const r = R * this.s;
    for (const f of this.fx) {
      const k = (now - f.t0) / FLIGHT_MS;
      if (k >= 1) continue;
      const x = this.sx(f.x + f.vx * k * 0.12);
      const y = this.sy(f.y + f.vy * k * 0.12);
      const grow = 1 + 0.7 * Math.sin(k * Math.PI);
      ctx.globalAlpha = 1 - k * k;
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      dot(ctx, x + r * 0.6 * grow, y + r * 0.9 * grow, r);
      const label = this.labels ? this.labels[f.ball] : f.ball;
      ctx.drawImage(label === 0 ? this.sprites.cue : this.sprites.ball, x - r * grow, y - r * grow, 2 * r * grow, 2 * r * grow);
      ctx.drawImage(this.sprites.gloss, x - r * grow, y - r * grow, 2 * r * grow, 2 * r * grow);
      ctx.globalAlpha = 1;
    }
  }

  paintPreview(ctx) {
    if (!this.preview) {
      const p = this.phys.copy();
      p.record = true;
      const { power, ox, oy, elev } = this.params;
      p.shoot(this.aim, Math.max(0.03, power), ox, oy, elev);
      this.preview = p.runToRest(20);
    }
    const { s } = this;
    const p = this.preview;
    ctx.setLineDash([s * 0.016, s * 0.012]);
    for (let i = p.n - 1; i >= 0; i--) {
      const t = p.tracks[i];
      if (t.length < 4) continue;
      ctx.strokeStyle = i === 0 ? 'rgba(232,201,133,.9)' : 'rgba(243,236,220,.7)';
      ctx.lineWidth = Math.max(2, s * (i === 0 ? 0.005 : 0.004));
      ctx.beginPath();
      ctx.moveTo(this.sx(t[0]), this.sy(t[1]));
      for (let k = 2; k < t.length; k += 2) ctx.lineTo(this.sx(t[k]), this.sy(t[k + 1]));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (let i = 0; i < p.n; i++) {
      const t = p.tracks[i];
      if (t.length < 4 || !p.on[i]) continue;
      ctx.strokeStyle = i === 0 ? '#e8c985' : 'rgba(243,236,220,.8)';
      ctx.lineWidth = Math.max(1.5, s * 0.003);
      ctx.beginPath();
      ctx.arc(this.sx(t[t.length - 2]), this.sy(t[t.length - 1]), R * s, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** Ray-cast aim line, ghost ball and the object ball's direction. */
  paintGuide(ctx) {
    const p = this.phys;
    if (!p.on[0]) return;
    const { s } = this;
    const dx = Math.cos(this.aim);
    const dy = Math.sin(this.aim);
    const x0 = p.x[0];
    const y0 = p.y[0];
    let best = Infinity;
    let hit = -1;
    for (let i = 1; i < p.n; i++) {
      if (!p.on[i]) continue;
      const fx = p.x[i] - x0;
      const fy = p.y[i] - y0;
      const proj = fx * dx + fy * dy;
      const perp2 = fx * fx + fy * fy - proj * proj;
      if (proj <= 0 || perp2 >= 4 * R * R) continue;
      const t = proj - Math.sqrt(4 * R * R - perp2);
      if (t < best) [best, hit] = [t, i];
    }
    let tw = Infinity;
    if (dx > 1e-5) tw = Math.min(tw, (W - R - x0) / dx);
    if (dx < -1e-5) tw = Math.min(tw, (R - x0) / dx);
    if (dy > 1e-5) tw = Math.min(tw, (H - R - y0) / dy);
    if (dy < -1e-5) tw = Math.min(tw, (R - y0) / dy);
    if (tw < best) [best, hit] = [tw, -1];
    // a raised cue with side spin curves the ball: only hint the start of the path
    const curving = this.params.elev > 0.25 && Math.abs(this.params.ox) > 0.25;
    if (curving) best = Math.min(best, 0.25);
    best = Math.max(0, best);
    const gx = x0 + dx * best;
    const gy = y0 + dy * best;

    ctx.strokeStyle = 'rgba(243,236,220,.8)';
    ctx.lineWidth = Math.max(2, s * 0.004);
    ctx.setLineDash([s * 0.016, s * 0.012]);
    ctx.beginPath();
    ctx.moveTo(this.sx(x0), this.sy(y0));
    ctx.lineTo(this.sx(gx), this.sy(gy));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = Math.max(1.5, s * 0.003);
    ctx.beginPath();
    ctx.arc(this.sx(gx), this.sy(gy), R * s, 0, Math.PI * 2);
    ctx.stroke();
    if (hit > 0 && !curving) {
      // the object ball leaves a little off the line of centres (throw): show where it really goes
      const path = (this.cuePath ??= this.predictCuePath());
      const nl = Math.hypot(p.x[hit] - gx, p.y[hit] - gy);
      let nx = (p.x[hit] - gx) / nl;
      let ny = (p.y[hit] - gy) / nl;
      if (path.object === hit) [nx, ny] = [Math.cos(path.objectDir), Math.sin(path.objectDir)];
      const len = 0.08 + 0.35 * Math.max(0, dx * nx + dy * ny);
      // green when the object ball really drops: the shot played out to the end, jaws and
      // other balls included — not when the cue may slip off the ball (a miscue is chance)
      const sure = Math.hypot(this.params.ox, this.params.oy) <= MISCUE_LIMIT;
      const k = sure && path.object === hit ? path.objectPocket : -1;
      ctx.strokeStyle = k >= 0 ? '#5fd38a' : '#d9b36c';
      if (k >= 0) {
        const [J1, J2] = POCKETS[k].jaws;
        ctx.save();
        ctx.lineWidth = Math.max(3, s * 0.006);
        ctx.beginPath();
        ctx.moveTo(this.sx(J1[0]), this.sy(J1[1]));
        ctx.lineTo(this.sx(J2[0]), this.sy(J2[1]));
        ctx.stroke();
        ctx.restore();
      }
      ctx.lineWidth = Math.max(2.5, s * 0.005);
      ctx.beginPath();
      ctx.moveTo(this.sx(p.x[hit]), this.sy(p.y[hit]));
      ctx.lineTo(this.sx(p.x[hit] + nx * len), this.sy(p.y[hit] + ny * len));
      ctx.stroke();
      this.paintCueDeflection(ctx, gx, gy);
    }
  }

  /**
   * Where the struck ball goes after the contact, played out by the physics with
   * the chosen spin and power — the tangent line of a stop shot, bent forward by
   * follow or back by draw. Only the first stretch is shown (up to the next
   * cushion or ball), so position play still takes judgement. Green with a
   * «свояк» tag when it runs into a pocket.
   */
  paintCueDeflection(ctx, gx, gy) {
    const path = (this.cuePath ??= this.predictCuePath());
    if (path.points.length < 4) return;
    const { s } = this;
    const pts = path.points;
    const into = path.pocket >= 0;
    ctx.save();
    ctx.strokeStyle = into ? 'rgba(95,211,138,.95)' : 'rgba(243,236,220,.75)';
    ctx.lineWidth = Math.max(2, s * 0.004);
    ctx.lineCap = 'round';
    ctx.setLineDash([s * 0.008, s * 0.012]);
    ctx.beginPath();
    ctx.moveTo(this.sx(gx), this.sy(gy)); // from the ghost ball, where the contact happens
    for (let k = 0; k < pts.length; k += 2) ctx.lineTo(this.sx(pts[k]), this.sy(pts[k + 1]));
    ctx.stroke();
    ctx.setLineDash([]);
    // a small arrowhead shows which way the cue ball leaves
    const n = pts.length;
    const ex = pts[n - 2];
    const ey = pts[n - 1];
    // direction over the last ball width or so, steady while the finger moves
    let back = n - 4;
    while (back > 0 && Math.hypot(ex - pts[back], ey - pts[back + 1]) < R * 1.5) back -= 2;
    const ax = ex - pts[back];
    const ay = ey - pts[back + 1];
    const al = Math.hypot(ax, ay);
    if (al > 1e-4 && !into) {
      const ux = ax / al;
      const uy = ay / al;
      const h = R * 0.7;
      ctx.beginPath();
      ctx.moveTo(this.sx(ex - ux * h - uy * h * 0.6), this.sy(ey - uy * h + ux * h * 0.6));
      ctx.lineTo(this.sx(ex), this.sy(ey));
      ctx.lineTo(this.sx(ex - ux * h + uy * h * 0.6), this.sy(ey - uy * h - ux * h * 0.6));
      ctx.stroke();
    }
    if (into) {
      const pocket = POCKETS[path.pocket];
      const [J1, J2] = pocket.jaws;
      ctx.lineWidth = Math.max(3, s * 0.006);
      ctx.beginPath();
      ctx.moveTo(this.sx(J1[0]), this.sy(J1[1]));
      ctx.lineTo(this.sx(J2[0]), this.sy(J2[1]));
      ctx.stroke();
      // «свояк» tag on the cloth, just in front of the pocket
      // beside the path, not on it
      const side = [-pocket.u[1], pocket.u[0]];
      const tx = this.sx(pocket.M[0] - pocket.u[0] * R * 3.2 + side[0] * R * 1.6);
      const ty = this.sy(pocket.M[1] - pocket.u[1] * R * 3.2 + side[1] * R * 1.6);
      const fs = Math.max(10, R * s * 0.75);
      ctx.font = `700 ${fs}px system-ui, sans-serif`;
      const tw = ctx.measureText('свояк').width;
      ctx.fillStyle = 'rgba(12,32,22,.85)';
      ctx.beginPath();
      ctx.roundRect(tx - tw / 2 - fs * 0.45, ty - fs * 0.75, tw + fs * 0.9, fs * 1.5, fs * 0.75);
      ctx.fill();
      ctx.fillStyle = '#5fd38a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('свояк', tx, ty + fs * 0.05);
    }
    ctx.restore();
  }

  predictCuePath() {
    return predictStrikerPath(this.phys, this.aim, this.params);
  }

  paintCue(ctx) {
    const { s } = this;
    const dx = Math.cos(this.aim);
    const dy = Math.sin(this.aim);
    const x0 = this.phys.x[0];
    const y0 = this.phys.y[0];
    const start = R * 1.5 + this.params.power * 0.3; // the cue draws back as the strip is pulled
    const seg = (a, b, color, width, ox = 0, oy = 0) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(this.sx(x0 - dx * a) + ox, this.sy(y0 - dy * a) + oy);
      ctx.lineTo(this.sx(x0 - dx * b) + ox, this.sy(y0 - dy * b) + oy);
      ctx.stroke();
    };
    ctx.lineCap = 'round';
    seg(start, start + 1.1, 'rgba(0,0,0,.33)', s * 0.014, s * 0.008, s * 0.012);
    seg(start + 0.75, start + 1.1, '#2a160b', s * 0.018);
    seg(start + 0.6, start + 0.75, '#c9a86e', s * 0.012);
    seg(start, start + 0.6, '#e9d3a8', s * 0.01);
    seg(start, start + 0.012, '#3f7fc0', s * 0.01);
    ctx.lineCap = 'butt';
  }

  // ------------------------------------------------------------ input

  bindInput(canvas) {
    const toTable = (e) => {
      const r = canvas.getBoundingClientRect();
      return [(e.clientX - r.left - this.offX) / this.s, (e.clientY - r.top - this.offY) / this.s];
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (this.animating) {
        this.skip = true; // tap during a shot: jump to where the balls stop
        return;
      }
      if (!this.phys || this.locked) return;
      canvas.setPointerCapture(e.pointerId);
      this.dragAngle = null;
      const [tx, ty] = toTable(e);
      this.press = { x: e.clientX, y: e.clientY, moved: false, aims: [] };
      if (this.mode === GAME) return this.gamePress(tx, ty);
      this.drag = this.mode === TRAINER ? this.ballAt(tx, ty) : -1;
      if (this.drag < 0) this.aimAt(tx, ty);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!canvas.hasPointerCapture(e.pointerId) || this.animating || this.locked) return;
      const [tx, ty] = toTable(e);
      if (this.press && Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > DRAG_SLOP) {
        this.press.moved = true;
        clearTimeout(this.longPress);
      }
      if (this.drag >= 0) this.moveBall(this.drag, tx, ty);
      else if (this.mode !== GAME || this.press?.moved) {
        this.aimDrag(tx, ty);
        this.press?.aims.push(e.timeStamp, this.aim);
      }
    });
    const end = (e) => {
      clearTimeout(this.longPress);
      const aims = this.press?.aims ?? [];
      // undo the roll of the lifting finger: the aim as it was LIFT_MS before release
      let k = aims.length - 2;
      while (k >= 0 && aims[k] > e.timeStamp - LIFT_MS) k -= 2;
      if (k >= 0 && k < aims.length - 2 && this.drag < 0) {
        const held = aims[k + 1];
        if (Math.abs(Math.atan2(Math.sin(this.aim - held), Math.cos(this.aim - held))) < LIFT_TURN) {
          this.aim = held;
          this.invalidate();
        }
      }
      this.drag = -1;
      this.press = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  /** GAME: long press on a ball picks it to strike; with ball in hand the struck ball can be dragged. */
  gamePress(tx, ty) {
    const i = this.ballAt(tx, ty);
    if (this.pickMode) {
      if (i >= 0 && this.canPick(i)) this.onPick?.(i);
      return;
    }
    const p = this.phys;
    this.drag = i === 0 && this.canPlace?.(p.x[0], p.y[0]) ? 0 : -1;
    if (i < 0) return this.aimAt(tx, ty);
    if (i > 0) {
      this.longPress = setTimeout(() => {
        if (this.press && !this.press.moved) this.onSelectBall?.(i);
      }, LONG_PRESS_MS);
    }
    // a plain tap on a ball aims at it
    if (i > 0) this.aimAt(tx, ty);
  }

  ballAt(tx, ty) {
    let best = R * 2.6;
    let found = -1;
    for (let i = 0; i < this.phys.n; i++) {
      if (!this.phys.on[i]) continue;
      const d = Math.hypot(tx - this.phys.x[i], ty - this.phys.y[i]);
      if (d < best) [best, found] = [d, i];
    }
    return found;
  }

  aimAt(tx, ty) {
    const p = this.phys;
    this.dragAngle = null;
    if (Math.hypot(tx - p.x[0], ty - p.y[0]) < R * 0.6) return;
    this.aim = Math.atan2(ty - p.y[0], tx - p.x[0]);
    this.dragAngle = this.aim;
    this.invalidate();
  }

  /**
   * Turning the aim by dragging. Far from the cue ball the line follows the
   * finger; close to it a pixel is a large angle, so there the aim turns slower,
   * as if the finger were on a longer lever — fine aiming without jumps.
   */
  aimDrag(tx, ty) {
    const p = this.phys;
    const d = Math.hypot(tx - p.x[0], ty - p.y[0]);
    if (d < R * 0.6) return;
    const a = Math.atan2(ty - p.y[0], tx - p.x[0]);
    if (this.dragAngle == null) return this.aimAt(tx, ty);
    const turn = Math.atan2(Math.sin(a - this.dragAngle), Math.cos(a - this.dragAngle));
    this.dragAngle = a;
    this.aim += turn * Math.min(1, Math.max(0.25, d / FINE_AIM_RADIUS));
    this.invalidate();
  }

  moveBall(i, tx, ty) {
    const p = this.phys;
    const x = Math.min(W - R, Math.max(R, tx));
    const y = Math.min(H - R, Math.max(R, ty));
    if (this.mode === GAME) {
      if (this.canPlace?.(x, y)) p.place(i, x, y);
      return this.invalidate();
    }
    for (let j = 0; j < p.n; j++) {
      if (j !== i && p.on[j] && Math.hypot(x - p.x[j], y - p.y[j]) < 2 * R * 1.01) return;
    }
    p.x[i] = x;
    p.y[i] = y;
    this.invalidate();
  }
}

// ------------------------------------------------------------ helpers

function dot(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Pre-rendered ivory ball, cue ball (red spot) and gloss overlay at device resolution. */
function makeBallSprites(cssSize, ctx) {
  const dpr = ctx.getTransform().a || 1;
  const px = Math.ceil(cssSize * dpr);
  const make = (paint) => {
    const c = document.createElement('canvas');
    c.width = c.height = px;
    paint(c.getContext('2d'), px / 2);
    return c;
  };
  const base = (g, r) => {
    const grad = g.createRadialGradient(r * 0.7, r * 0.6, 0, r * 0.7, r * 0.6, r * 1.6);
    grad.addColorStop(0, '#fffaee');
    grad.addColorStop(0.5, '#ede1c5');
    grad.addColorStop(1, '#c2b08a');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(r, r, r, 0, Math.PI * 2);
    g.fill();
  };
  return {
    ball: make(base),
    cue: make((g, r) => {
      base(g, r);
      g.fillStyle = '#b8322a';
      g.beginPath();
      g.arc(r, r, r * 0.34, 0, Math.PI * 2);
      g.fill();
    }),
    gloss: make((g, r) => {
      const grad = g.createRadialGradient(r * 0.62, r * 0.5, 0, r * 0.62, r * 0.5, r * 1.25);
      grad.addColorStop(0, 'rgba(255,255,255,.8)');
      grad.addColorStop(0.28, 'rgba(255,255,255,0)');
      grad.addColorStop(0.7, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,.33)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(r, r, r, 0, Math.PI * 2);
      g.fill();
    }),
  };
}
