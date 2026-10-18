/**
 * «Колхоз» («колбаса»): a club game of the pyramid for three or more, each for
 * themselves, in a fixed order. There is no official rulebook (it is not an
 * ФБСР discipline); what the club sources agree on is the money:
 *  - «кольцо»: your result is your points minus the points of the player who
 *    strikes after you — every ball you pot is paid by the player before you
 *    (artel-billiards.ru, «Правила бильярда: Колхоз (Колбаса)»);
 *  - «каждый с каждым»: you settle with everybody, N·p − Σp — the scheme of the
 *    multi-player «малая русская пирамида» (ru-billiards.ucoz.ru).
 * Ball values are agreed before the game, the last ball often counts double and
 * a foul costs the offender a ball's value. Both schemes add up to zero.
 */

export const SETTLE = { ring: 'ring', all: 'all' };
export const SETTLE_NAMES = { ring: 'Кольцо', all: 'Каждый с каждым' };
export const SETTLE_NOTES = {
  ring: 'итог — твои очки минус очки следующего игрока',
  all: 'итог — N × твои очки минус сумма всех очков',
};

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;

/** Each player's result for the given points: the scheme's net, adding up to zero. */
export function nets(points, mode = SETTLE.ring) {
  const n = points.length;
  if (mode === SETTLE.all) {
    const sum = points.reduce((a, b) => a + b, 0);
    return points.map((p) => n * p - sum);
  }
  return points.map((p, i) => p - points[(i + 1) % n]);
}

/**
 * Who pays whom, in as few payments as the greedy rule finds: the biggest debtor
 * pays the biggest creditor, and so on. `balances` add up to zero (money).
 */
export function transfers(balances) {
  const cents = balances.map((b) => Math.round(b * 100));
  const debt = cents.map((c, i) => ({ i, c })).filter((d) => d.c < 0).map((d) => ({ i: d.i, c: -d.c }));
  const cred = cents.map((c, i) => ({ i, c })).filter((d) => d.c > 0);
  const out = [];
  const byLargest = (a, b) => b.c - a.c || a.i - b.i;
  while (debt.length && cred.length) {
    debt.sort(byLargest);
    cred.sort(byLargest);
    const d = debt[0];
    const c = cred[0];
    const amount = Math.min(d.c, c.c);
    out.push({ from: d.i, to: c.i, amount: amount / 100 });
    d.c -= amount;
    c.c -= amount;
    if (!d.c) debt.shift();
    if (!c.c) cred.shift();
  }
  return out;
}

/** Defaults of a new scoring session. */
export const DEFAULTS = {
  price: 100, // ₽ per point
  balls: 15, // balls in a round: the round ends when they are all scored
  value: 1, // points for an ordinary ball
  lastDouble: true, // the last ball of the round counts double
  foul: 1, // points a foul costs the offender
  settle: SETTLE.ring,
  extras: [], // balls with their own price: [{ name, value }]
};

/**
 * A scoring session at a real table: players in turn order, rounds of `balls`
 * balls, a log of every ball and foul so any tap can be undone. Rounds already
 * played are kept with their points; money is points × price.
 */
export class KolkhozSession {
  constructor({ players, ...settings }) {
    if (!players || players.length < MIN_PLAYERS) throw new Error(`нужно не меньше ${MIN_PLAYERS} игроков`);
    this.players = players.map((p) => (typeof p === 'string' ? p : p.name));
    this.settings = { ...DEFAULTS, ...settings, extras: (settings.extras ?? []).map((e) => ({ ...e })) };
    this.rounds = []; // finished rounds: { points, breaker, balls }
    this.log = []; // the round in play: { type: 'ball' | 'foul', player, value, kind, last }
  }

  get n() {
    return this.players.length;
  }

  /** The order rotates every round: the next player breaks. */
  get breaker() {
    return this.rounds.length % this.n;
  }

  /** Balls scored in the round in play (each ball counts once, whatever its price). */
  get scored() {
    return this.log.filter((e) => e.type === 'ball').length;
  }

  get remaining() {
    return Math.max(0, this.settings.balls - this.scored);
  }

  /** All the balls are down: the round only waits to be closed. */
  get roundComplete() {
    return this.remaining === 0;
  }

  /** The next ball scored is the last one of the round. */
  get lastBallNext() {
    return this.remaining === 1;
  }

  /** Ball kinds with their prices: the ordinary ball, then the agreed special balls. */
  get kinds() {
    return [{ name: 'Шар', value: this.settings.value }, ...this.settings.extras];
  }

  /** Points for the next ball of kind k (the last ball may count double). */
  valueOf(k = 0) {
    const v = this.kinds[k]?.value ?? this.settings.value;
    return this.lastBallNext && this.settings.lastDouble ? v * 2 : v;
  }

  pot(player, k = 0) {
    if (this.roundComplete || player < 0 || player >= this.n) return false;
    const last = this.lastBallNext;
    this.log.push({ type: 'ball', player, kind: k, value: this.valueOf(k), last });
    return true;
  }

  foul(player) {
    if (player < 0 || player >= this.n) return false;
    this.log.push({ type: 'foul', player, value: -this.settings.foul });
    return true;
  }

  undo() {
    return this.log.pop() ?? null;
  }

  /** Points of the round in play. */
  roundPoints() {
    const pts = this.players.map(() => 0);
    for (const e of this.log) pts[e.player] += e.value;
    return pts;
  }

  /** Per-round points of all finished rounds and, if anything happened, the one in play. */
  allRounds({ withCurrent = true } = {}) {
    const list = this.rounds.map((r) => r.points);
    if (withCurrent && this.log.length) list.push(this.roundPoints());
    return list;
  }

  /** Net points per player over the session (each round settled on its own). */
  totals({ withCurrent = true } = {}) {
    const sum = this.players.map(() => 0);
    for (const pts of this.allRounds({ withCurrent })) nets(pts, this.settings.settle).forEach((v, i) => (sum[i] += v));
    return sum;
  }

  money(points) {
    return points.map((p) => p * this.settings.price);
  }

  /** Closes the round in play (even if balls are left, by agreement); returns its points. */
  endRound() {
    if (!this.log.length) return null;
    const round = { points: this.roundPoints(), breaker: this.breaker, balls: this.scored, log: this.log };
    this.rounds.push(round);
    this.log = [];
    return round;
  }

  /** Reopens the last closed round, e.g. after closing it by mistake. */
  reopenRound() {
    if (this.log.length || !this.rounds.length) return false;
    this.log = this.rounds.pop().log ?? [];
    return true;
  }

  /** Who pays whom for the whole session, in rubles. */
  settlement({ withCurrent = true } = {}) {
    return transfers(this.money(this.totals({ withCurrent })));
  }

  /** The session as plain text, to send to the group chat. */
  report({ withCurrent = true } = {}) {
    const s = this.settings;
    const rounds = this.allRounds({ withCurrent });
    const totals = this.totals({ withCurrent });
    const lines = [
      `Колхоз · ${plural(rounds.length, ['партия', 'партии', 'партий'])} · ${rub(s.price)} за очко · ${SETTLE_NAMES[s.settle].toLowerCase()}`,
      '',
    ];
    const order = this.players.map((_, i) => i).sort((a, b) => totals[b] - totals[a] || a - b);
    for (const i of order) lines.push(`${this.players[i]}: ${signed(totals[i])} ${pointsWord(totals[i])} = ${signedRub(totals[i] * s.price)}`);
    const pay = transfers(this.money(totals));
    lines.push('', pay.length ? 'Расчёт:' : 'Расчёт: все в нуле.');
    for (const t of pay) lines.push(`${this.players[t.from]} → ${this.players[t.to]}: ${rub(t.amount)}`);
    return lines.join('\n');
  }

  toJSON() {
    return { players: this.players, settings: this.settings, rounds: this.rounds, log: this.log };
  }

  static fromJSON(o) {
    const s = new KolkhozSession({ players: o.players, ...o.settings });
    s.rounds = o.rounds ?? [];
    s.log = o.log ?? [];
    return s;
  }
}

// ================================================================ formatting

/** 1500 → «1 500 ₽», 12.5 → «12,50 ₽». */
export function rub(v) {
  const abs = Math.round(Math.abs(v) * 100) / 100;
  const [int, frac] = (Number.isInteger(abs) ? String(abs) : abs.toFixed(2)).split('.');
  return `${v < 0 ? '−' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${frac ? ',' + frac : ''} ₽`;
}

export const signed = (v) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');
export const signedRub = (v) => (v > 0 ? `+${rub(v)}` : rub(v));
export const pointsWord = (v) => plural(Math.abs(v), ['очко', 'очка', 'очков']).split(' ')[1];

function plural(n, [one, few, many]) {
  const d = n % 10;
  const dd = n % 100;
  const word = d === 1 && dd !== 11 ? one : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many;
  return `${n} ${word}`;
}
