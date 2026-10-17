import { Physics, W, H, R } from './physics.js';
import { technique } from './content.js';

/**
 * Two games of the pyramid after the official rules («Пирамида. Официальные
 * международные правила», ФБСР/МКП, 2025):
 *  - «Свободная пирамида» («американка»): any ball may be struck («СП п.N»);
 *  - «Комбинированная пирамида» («сибирка», «московская»): only the coloured
 *    ball is struck; after a свояк it comes back from hand from the house («КП п.N»).
 * Plain «п.N» refers to the general rules of the pyramid.
 *
 * Physics always strikes table slot 0, so choosing another ball swaps it into
 * slot 0; `labels[i]` keeps the number painted on the ball in slot i (0 = the
 * plain coloured ball).
 */

/** Points needed to win (СП п.1). */
export const TARGET = 8;
/** The house: between the house line and the front cushion; the line itself is outside (п.11). */
export const HOUSE_LINE = H * 0.75;
/** Back spot: the apex of the pyramid (п.9.1) and where balls are respotted (п.25.2). */
export const FOOT_SPOT = { x: W / 2, y: H * 0.25 };
const HOUSE_SPOT = { x: W / 2, y: H * 0.82 };
const BALLS = 16;

/** "Temporary house" line (п.2.1(7)): through the back spot, parallel to the back cushion (КП п.6.6). */
export const TEMP_HOUSE_LINE = FOOT_SPOT.y;

export const VARIANT = { free: 'free', combined: 'combined' };
export const VARIANT_NAMES = { free: 'Американка', combined: 'Сибирка' };

/** Penalty variants: the official rule, or the club custom many players know. */
export const PENALTY = {
  official: 'official', // the opponent takes any ball off the table (СП п.6)
  club: 'club', // the offender puts one of their balls back on the table
};

export class Match {
  constructor({ players, variant = VARIANT.free, penalty = PENALTY.official, breaker = 0, random = Math.random } = {}) {
    this.players = players ?? [{ name: 'Игрок 1' }, { name: 'Игрок 2' }];
    this.variant = variant;
    this.penalty = penalty;
    this.random = random;
    this.table = new Physics(BALLS);
    this.labels = Int8Array.from({ length: BALLS }, (_, i) => i);
    this.scores = [0, 0];
    this.pocketed = [[], []]; // labels on each player's shelf, in order
    this.cur = breaker;
    this.isBreak = true;
    this.ballInHand = true;
    this.winner = -1;
    this.message = '';
    this.lastShot = null;
    /**
     * Waiting for a decision: after a foul { kind: 'penalty' | 'choice', taker, offender, breakFoul };
     * after a свояк in the combined game { kind: 'svoyak', taker } (КП п.5.2).
     */
    this.pending = null;
    this.rack();
  }

  get over() {
    return this.winner >= 0;
  }

  get current() {
    return this.players[this.cur];
  }

  /** Сибирка: only the coloured ball is ever struck. */
  get combined() {
    return this.variant === VARIANT.combined;
  }

  get name() {
    return VARIANT_NAMES[this.variant];
  }

  /** Сибирка, from hand, with every object ball in the house: play from the temporary house (КП п.6.6). */
  get tempHouse() {
    if (!this.combined || this.isBreak) return false;
    const t = this.table;
    let any = false;
    for (let i = 1; i < BALLS; i++) {
      if (!t.on[i]) continue;
      any = true;
      if (!this.inHouse(t.y[i])) return false;
    }
    return any;
  }

  /** Where the cue ball may stand when played from hand (the line itself is excluded). */
  inHandZone(y) {
    return this.tempHouse ? y < TEMP_HOUSE_LINE : this.inHouse(y);
  }

  /** Label of the ball currently set up to be struck. */
  get strikerLabel() {
    return this.labels[0];
  }

  // ------------------------------------------------------------ the table

  /** Pyramid with its apex on the back spot; slot 0 (the coloured ball) in the house (п.9). */
  rack(whites = Array.from({ length: 15 }, (_, k) => k + 1)) {
    const t = this.table;
    for (const i of whites) t.on[i] = false;
    pyramidPositions(whites.length).forEach(([x, y], k) => t.place(whites[k], x, y));
    const spot = this.freeHouseSpot();
    t.place(0, spot.x, spot.y);
  }

  /** Makes table slot i the struck ball: any ball may be struck in the free pyramid (СП п.2, п.5.1). */
  selectStriker(i) {
    const t = this.table;
    if (this.combined || i < 0 || i >= BALLS || !t.on[i] || this.isBreak || this.pending) return false;
    this.swap(0, i);
    return true;
  }

  swap(a, b) {
    if (a === b) return;
    swapBalls(this.table, a, b);
    [this.labels[a], this.labels[b]] = [this.labels[b], this.labels[a]];
  }

  /** When the struck ball dropped, set up the ball nearest the house as the default (free pyramid). */
  ensureStriker() {
    const t = this.table;
    if (t.on[0] || this.combined) return;
    let best = -1;
    let bestD = Infinity;
    for (let i = 1; i < BALLS; i++) {
      if (!t.on[i]) continue;
      const d = Math.hypot(t.x[i] - HOUSE_SPOT.x, t.y[i] - HOUSE_SPOT.y);
      if (d < bestD) [best, bestD] = [i, d];
    }
    if (best > 0) this.swap(0, best);
  }

  inHouse(y) {
    return y > HOUSE_LINE;
  }

  /**
   * From hand the cue ball goes anywhere in the house (or temporary house), not
   * on the line and not touching a ball there (п.12.3, КП п.6.1).
   */
  canPlaceStriker(x, y) {
    return x >= R && x <= W - R && y >= R && y <= H - R && this.inHandZone(y) && this.table.isFree(x, y, 0);
  }

  freeHouseSpot(preferX = HOUSE_SPOT.x) {
    const temp = this.tempHouse;
    const [lo, hi] = temp ? [R, TEMP_HOUSE_LINE - R] : [HOUSE_LINE + R, H - R];
    for (let k = 0; k < 400; k++) {
      const x = Math.min(W - R, Math.max(R, k === 0 ? preferX : R + this.random() * (W - 2 * R)));
      const y = k === 0 ? (temp ? (lo + hi) / 2 : HOUSE_SPOT.y) : lo + this.random() * (hi - lo);
      if (this.canPlaceStriker(x, y)) return { x, y };
    }
    return temp ? { x: W / 2, y: R * 3 } : { ...HOUSE_SPOT };
  }

  /** Сибирка: puts the cue ball back on the table for a shot from hand. */
  cueFromHand() {
    this.ballInHand = true;
    const spot = this.freeHouseSpot();
    this.table.place(0, spot.x, spot.y);
  }

  /**
   * Respots balls (п.25.2): one ball on the back spot; several in a row from the
   * back spot towards the back cushion; if that line is blocked, as close to the
   * spot as possible, then along the line towards the centre.
   */
  respot(slots) {
    const t = this.table;
    for (const i of slots) t.on[i] = false;
    for (const i of slots) {
      const y = scanLine(t, i, FOOT_SPOT.y, R, -1) ?? scanLine(t, i, FOOT_SPOT.y, H / 2, 1) ?? R * 2;
      t.place(i, W / 2, y);
    }
  }

  // ------------------------------------------------------------ a shot

  shoot(aim, power, ox = 0, oy = 0, elev = 0) {
    const fromHand = this.combined && this.ballInHand && !this.isBreak;
    const temp = this.tempHouse;
    this.shotContext = {
      spin: { ox, oy, elev },
      isBreak: this.isBreak,
      // from hand the first ball hit must lie outside the (temporary) house (КП п.6.5–6.6)
      fromHandZone: fromHand ? (y) => (temp ? y < TEMP_HOUSE_LINE : y > HOUSE_LINE) : null,
      startY: Float64Array.from(this.table.y),
    };
    this.ballInHand = false;
    this.message = '';
    this.table.shoot(aim, power, ox, oy, elev);
  }

  /** Applies the rules once the balls have stopped. */
  endShot() {
    const t = this.table;
    const { isBreak, spin, fromHandZone, startY } = this.shotContext;
    const me = this.cur;
    const opp = 1 - me;
    const foul = shotFoul(t, { isBreak, fromHandZone, startY });
    const pottedSlots = [...t.potted];
    const labels = pottedSlots.map((i) => this.labels[i]);
    const svoyak = pottedSlots.includes(0);
    const tech = technique(spin.ox, spin.oy, spin.elev).name;
    this.isBreak = false;
    this.lastShot = {
      player: me, foul, pocketed: foul ? [] : labels, svoyak: svoyak && !foul, technique: tech, jumped: t.jumped.length,
    };

    if (foul) {
      // balls pocketed on a foul don't count; they and any that flew off go back (п.21.4, п.23.4);
      // in the combined game the cue ball is not respotted but comes back from hand (п.25, КП п.7.2)
      const out = [...pottedSlots, ...t.jumped];
      this.respot(this.combined ? out.filter((i) => i !== 0) : out);
      this.ensureStriker();
      this.foulPenalty(me, foul, isBreak);
      return;
    }

    if (labels.length) {
      const objects = labels.filter((l) => l !== 0);
      const kinds = [svoyak ? `свояк (${tech.toLowerCase()})` : null, objects.length ? 'чужой' : null].filter(Boolean).join(' + ');
      if (this.combined && svoyak) {
        // the cue ball's point is taken as an object ball of the player's choice (КП п.5.2)
        this.score(me, objects);
        if (this.over) return;
        this.pending = { kind: 'svoyak', taker: me };
        this.message = `${cap(kinds)}! ${say(this.players[me], 'снимает', 'сними')} со стола любой прицельный шар взамен битка (+1) — и с руки из дома.`;
        return;
      }
      this.score(me, labels);
      if (this.over) return;
      this.message = `${cap(kinds)}: +${labels.length}. ${say(this.players[me], 'бьёт', 'бьёшь')} ещё.`;
      this.ensureStriker();
      return;
    }
    this.cur = opp;
    this.message = this.players[opp].you ? 'Мимо. Твой ход.' : `Мимо. Ход: ${this.players[opp].name}.`;
  }

  score(player, labels) {
    this.scores[player] += labels.length;
    this.pocketed[player].push(...labels);
    if (this.scores[player] >= TARGET) {
      this.winner = player;
      this.pending = null;
      this.message = this.players[player].you
        ? `У тебя ${this.scores[player]} — победа!`
        : `${this.players[player].name} — ${this.scores[player]}. Победа!`;
    }
  }

  foulPenalty(offender, foul, breakFoul) {
    const taker = 1 - offender;
    const head = `Фол: ${foul}.`;
    if (this.penalty === PENALTY.club) {
      // club custom: the offender's last scored ball goes back on the table
      const label = this.pocketed[offender].pop();
      let note = ' У нарушителя нет забитых шаров — штрафа нет.';
      if (label !== undefined) {
        this.scores[offender]--;
        this.respot([this.labels.indexOf(label)]);
        note = ` Шар ${label || 'без номера'} возвращается на стол.`;
      }
      this.pending = { kind: 'choice', taker, offender, breakFoul };
      this.message = `${head}${note} ${say(this.players[taker], 'решает', 'решай')}: бить или передать удар.`;
      return;
    }
    this.pending = { kind: 'penalty', taker, offender, breakFoul };
    this.message = `${head} ${say(this.players[taker], 'снимает', 'снимаешь')} со стола любой шар себе (+1).`;
  }

  /** Balls that may be taken off the table now (the cue ball of the combined game never is). */
  canTake(i) {
    return this.table.on[i] && !(this.combined && i === 0);
  }

  /** Сибирка, after a свояк: the player takes object ball i for the cue ball, then plays from hand (КП п.5.2). */
  takeForSvoyak(i) {
    const p = this.pending;
    if (!p || p.kind !== 'svoyak' || !this.canTake(i)) return false;
    const label = this.labels[i];
    this.table.on[i] = false;
    this.score(p.taker, [label]);
    if (this.over) return true;
    this.pending = null;
    this.cueFromHand();
    this.message = this.players[p.taker].you ? `Шар ${label} — взамен битка.` : `Шар ${label} — взамен битка. ${this.players[p.taker].name} бьёт с руки из дома.`;
    return true;
  }

  /** Official penalty: the opponent takes table slot i to their shelf (СП п.6, п.8; КП п.7.1). */
  takePenalty(i) {
    const p = this.pending;
    if (!p || p.kind !== 'penalty' || !this.canTake(i)) return false;
    const label = this.labels[i];
    this.table.on[i] = false;
    this.score(p.taker, [label]);
    if (this.over) return true;
    this.ensureStriker();
    this.pending = { ...p, kind: 'choice' };
    const who = this.players[p.taker].you ? 'тебе' : this.players[p.taker].name;
    this.message = `Штрафной шар ${label || 'без номера'} — ${who}. ${say(this.players[p.taker], 'решает', 'решай')}: бить самому или передать удар.`;
    return true;
  }

  /** Options after a foul (п.7.4); after a faulty break also re-racking (п.13.2). */
  options() {
    const p = this.pending;
    if (!p || p.kind !== 'choice') return [];
    return p.breakFoul ? ['play', 'pass', 'rerack-self', 'rerack-pass'] : ['play', 'pass'];
  }

  chooseNext(option) {
    const p = this.pending;
    if (!this.options().includes(option)) return false;
    this.pending = null;
    const next = option === 'play' || option === 'rerack-self' ? p.taker : p.offender;
    const player = this.players[next];
    this.cur = next;
    if (option.startsWith('rerack')) {
      // the break is made with the coloured ball while it is still in play (п.12.2)
      const coloured = this.labels.indexOf(0);
      if (this.table.on[coloured]) this.swap(0, coloured);
      const whites = [];
      for (let i = 1; i < BALLS; i++) if (this.table.on[i]) whites.push(i);
      this.rack(whites);
      this.isBreak = true;
      this.ballInHand = true;
      this.message = player.you ? 'Шары расставлены заново. Разбиваешь ты.' : `Шары расставлены заново. Разбивает ${player.name}.`;
      return true;
    }
    if (option === 'play') this.message = player.you ? 'Бьёшь сам.' : `${player.name} бьёт сам.`;
    else this.message = player.you ? 'Удар передан тебе.' : `Удар передан: ${player.name}.`;
    if (this.combined && !this.table.on[0]) {
      // the cue ball dropped or flew off: the player coming in plays from hand (КП п.7.2)
      this.cueFromHand();
      this.message += ' Биток — с руки из дома.';
    }
    return true;
  }

  // ------------------------------------------------------------ persistence

  toJSON() {
    const t = this.table;
    return {
      players: this.players, variant: this.variant, penalty: this.penalty, scores: this.scores, pocketed: this.pocketed, cur: this.cur,
      isBreak: this.isBreak, ballInHand: this.ballInHand, winner: this.winner, message: this.message,
      pending: this.pending, labels: [...this.labels], x: [...t.x], y: [...t.y], on: t.on,
    };
  }

  static fromJSON(o) {
    const m = new Match({ players: o.players, variant: o.variant ?? VARIANT.free, penalty: o.penalty ?? PENALTY.official });
    Object.assign(m, {
      scores: o.scores, pocketed: o.pocketed, cur: o.cur, isBreak: o.isBreak, ballInHand: o.ballInHand,
      winner: o.winner, message: o.message, pending: o.pending ?? null,
    });
    m.labels = Int8Array.from(o.labels);
    for (let i = 0; i < BALLS; i++) {
      m.table.place(i, o.x[i], o.y[i]);
      m.table.on[i] = o.on[i];
    }
    return m;
  }
}

// ================================================================ rules of a single shot

/**
 * Why the finished shot is a foul, or null if it was correct:
 * the struck ball touched no object ball (п.6.2), a ball flew off the table
 * (п.23.3), from hand the first ball hit lay in the house (КП п.6.6), or the
 * break broke п.13.1 / any other shot did not end as п.20 requires.
 * `fromHandZone(y)` tells whether a ball standing at y may not be hit first.
 */
export function shotFoul(t, { isBreak = false, fromHandZone = null, startY = null } = {}) {
  if (t.firstHit < 0) return 'биток не коснулся ни одного прицельного шара';
  if (fromHandZone && startY && fromHandZone(startY[t.firstHit])) return 'с руки нужно бить по шару вне дома';
  if (t.jumped.length) {
    const cue = t.jumped.includes(0);
    const others = t.jumped.some((i) => i !== 0);
    if (cue && others) return 'биток и прицельный шар вылетели за борт';
    return cue ? 'биток вылетел за борт' : 'прицельный шар вылетел за борт';
  }
  if (isBreak) return legalBreak(t) ? null : 'неправильный разбой — ничего не забито и мало шаров дошло до бортов';
  return properlyCompleted(t) ? null : 'удар без борта — ничего не забито, и шары не дошли до бортов';
}

/** п.13.1: a ball pocketed, or 3 object balls at cushions, or 2 at cushions and one across the centre line. */
export function legalBreak(t) {
  if (t.potted.length) return true;
  const railed = new Set();
  let crossed = false;
  for (const e of t.events) {
    if (e.type === 'rail' && e.ball !== 0) railed.add(e.ball);
    if (e.type === 'cross' && e.ball !== 0) crossed = true;
  }
  return railed.size >= 3 || (railed.size >= 2 && crossed);
}

/**
 * п.20 «правильно завершённый удар»: after the first contact some ball must be
 * pocketed, or — itself or by driving another ball — go (2) from one cushion to
 * another, (3) across the centre line and then to a cushion, or (4) from a
 * cushion across the centre line. Events are replayed in order; each ball
 * remembers what the balls that struck it had already done.
 */
export function properlyCompleted(t) {
  if (t.potted.length) return true;
  const st = Array.from({ length: t.n }, () => ({ railed: false, rail: null, crossed: false, from: [] }));
  const otherSide = (ya, yb) => yb === H / 2 || Math.sign(yb - H / 2) !== Math.sign(ya - H / 2);
  for (const e of t.events) {
    if (e.type === 'rail') {
      const b = st[e.ball];
      if ((b.railed && b.rail !== e.rail) || b.crossed) return true; // (2а), (3а)
      if (b.from.some((s) => (s.railed && s.rail !== e.rail) || s.crossed)) return true; // (2в), (3в)
      b.railed = true;
      b.rail = e.rail;
    } else if (e.type === 'cross') {
      const b = st[e.ball];
      if (b.railed || b.from.some((s) => s.railed)) return true; // (4а), (4б)
      b.crossed = true;
    } else {
      for (const [s, o, ys, yo, frozen] of [[e.a, e.b, e.ya, e.yb, e.frozenB], [e.b, e.a, e.yb, e.ya, e.frozenA]]) {
        const S = st[s];
        if (S.railed && frozen && frozen !== S.rail) return true; // (2б)
        if (S.crossed && frozen) return true; // (3б)
        if (S.railed && otherSide(ys, yo)) return true; // (4в)
        st[o].from.push({ railed: S.railed, rail: S.rail, crossed: S.crossed });
      }
    }
  }
  return false;
}

// ================================================================ helpers

/** Positions of an (in)complete pyramid of n balls with its apex on the back spot (п.9.1, п.9.3). */
export function pyramidPositions(n) {
  const gap = 2 * R * 1.004;
  const at = (row, j) => [FOOT_SPOT.x + (j - row / 2) * gap, FOOT_SPOT.y - row * gap * 0.866];
  const out = [];
  let row = 0;
  while (out.length + row + 1 <= n) {
    for (let j = 0; j <= row; j++) out.push(at(row, j));
    row++;
  }
  let rest = n - out.length;
  if (rest > 0) {
    // the base row is filled from the middle outwards, symmetrically; when the
    // count makes symmetry impossible, the apex ball moves into the base (п.9.3)
    const slots = row + 1;
    if (slots % 2 === 0 && rest % 2 === 1 && out.length) {
      out.shift();
      rest++;
    }
    const mid = (slots - 1) / 2;
    const order = slots % 2 ? [mid] : [];
    for (let d = slots % 2 ? 1 : 0.5; d <= mid; d++) order.push(mid - d, mid + d);
    if (slots % 2 && rest % 2 === 0) order.shift(); // an even count skips the middle slot
    for (const j of order.slice(0, rest)) out.push(at(row, j));
  }
  return out;
}

function scanLine(t, i, from, to, dir) {
  for (let y = from; dir < 0 ? y >= to : y <= to; y += dir * 0.002) {
    if (t.isFree(W / 2, y, i)) return y;
  }
  return null;
}

/** Swaps the full state of two table slots. */
export function swapBalls(t, a, b) {
  for (const k of ['x', 'y', 'vx', 'vy', 'rx', 'ry', 'sp']) [t[k][a], t[k][b]] = [t[k][b], t[k][a]];
  [t.on[a], t.on[b]] = [t.on[b], t.on[a]];
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Компьютер бьёт" / "Бьёшь": the player marked `you` is addressed directly. */
export const say = (player, third, second) => (player.you ? cap(second) : `${player.name} ${third}`);
