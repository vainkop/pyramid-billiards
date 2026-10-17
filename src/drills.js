import { Physics, POCKETS, cueFor } from './physics.js';
import { aimThrough } from './aim.js';

export const POT_ZONE = 'pot-zone';
export const POT = 'pot';
export const SVOYAK = 'svoyak';
export const MASSE = 'masse';

/** Table units → centimetres on a 12-ft table (playing width ≈ 178 cm). */
const CM_PER_UNIT = 178;

/**
 * A practice exercise. `pos` is [cueX, cueY, targetX, targetY, (blockerX, blockerY)].
 * The success zone is not hard-coded: it is wherever the reference shot (the
 * "solution") leaves the cue ball, so every drill is solvable by construction.
 */
export class Drill {
  constructor(spec) {
    Object.assign(this, { cuePocket: -1, fixedAim: null, zoneR: 0 }, spec);
    this.zone = null;
  }

  get hasZone() {
    return this.type === POT_ZONE;
  }

  get usesElevation() {
    return this.solution.elev > 0;
  }

  setup() {
    const p = new Physics(this.pos.length / 2);
    for (let i = 0; i < p.n; i++) p.place(i, this.pos[i * 2], this.pos[i * 2 + 1]);
    return p;
  }

  solutionAim(p) {
    if (this.fixedAim !== null) return this.fixedAim;
    if (this.pocket < 0) return Math.atan2(p.y[1] - p.y[0], p.x[1] - p.x[0]);
    // the ghost ball, corrected for the throw of this very shot
    const { x, y } = POCKETS[this.pocket];
    return aimThrough(p, 0, 1, 'object', x, y, p.aimFor(1, this.pocket), this.solution);
  }

  /** Simulates the reference shot once to find the zone centre. */
  prepare() {
    if (this.zone) return this;
    const p = this.setup();
    const { power, ox, oy, elev } = this.solution;
    p.shoot(this.solutionAim(p), power, ox, oy, elev);
    p.runToRest();
    this.zone = { x: p.x[0], y: p.y[0] };
    return this;
  }

  /** @returns {string|null} null on success, otherwise a hint about what went wrong */
  check(p) {
    const cueIn = p.potted.includes(0);
    const targetIn = p.potted.includes(1);
    if (p.firstHit < 0) return 'Биток не задел прицельный шар.';
    if (p.jumped?.length) return 'Слишком сильно — шар вылетел за борт. Бей мягче.';
    switch (this.type) {
      case MASSE:
        if (p.firstHit === 2) return 'Первым задет шар-помеха. Нужно сильнее закрутить дугу.';
        if (p.railsBeforeHit > 0) return 'Биток коснулся борта до шара — здесь нужна именно дуга.';
        return null;
      case SVOYAK:
        if (p.firstHit !== 1) return 'Биток должен сначала ударить прицельный шар.';
        if (!cueIn) return `Биток не упал в лузу. ${this.hint}`;
        if (this.cuePocket >= 0 && p.pocketOf[0] !== this.cuePocket) return `Биток упал, но не в ту лузу. ${this.hint}`;
        return null;
      case POT:
        if (!targetIn) return 'Шар не забит — поправь прицел через «мнимый шар».';
        if (cueIn) return 'Шар забит, но биток тоже упал (свояк). Удар чуть мягче.';
        return null;
      default: {
        if (!targetIn) return 'Шар не забит — поправь прицел.';
        if (cueIn) return `Биток упал в лузу. ${this.hint}`;
        this.prepare();
        const d = Math.hypot(p.x[0] - this.zone.x, p.y[0] - this.zone.y);
        if (d <= this.zoneR) return null;
        const cm = Math.round((d - this.zoneR) * CM_PER_UNIT);
        // compare how far the cue ball travelled with how far the zone is
        const zoneDist = Math.hypot(this.zone.x - this.pos[0], this.zone.y - this.pos[1]);
        const endDist = Math.hypot(p.x[0] - this.pos[0], p.y[0] - this.pos[1]);
        const how = endDist < zoneDist ? 'не дошёл до зоны' : 'проскочил зону';
        return `Биток ${how} на ${cm} см. ${this.hint}`;
      }
    }
  }
}

/** ★ done once, ★★ three times in total, ★★★ three in a row. */
export function stars(total, bestStreak) {
  if (bestStreak >= 3) return 3;
  if (total >= 3) return 2;
  return total >= 1 ? 1 : 0;
}

const shot = (power, ox, oy, elev = 0) => ({ power, ox, oy, elev });
const withCue = (cue, ...rest) => [...cue, ...rest];

/** Position for the draw-back svoyak: the cue ball sits between the target and pocket 4. */
function svoyakDrawPos() {
  const cue = [0.13, 1.87];
  const p = POCKETS[4];
  const l = Math.hypot(cue[0] - p.x, cue[1] - p.y);
  return withCue(cue, cue[0] + ((cue[0] - p.x) / l) * 0.3, cue[1] + ((cue[1] - p.y) / l) * 0.3);
}

export const DRILLS = [
  {
    id: 'klap1', group: 'Клапштос', title: 'Клапштос: прямой удар', type: POT_ZONE, pocket: 2,
    goal: 'Забей шар в среднюю лузу так, чтобы биток остановился на месте прицельного.',
    hint: 'Бей в центр или чуть ниже: в момент удара биток должен скользить, а не катиться.',
    pos: withCue(cueFor(0.3, 1, 2, 0, 0.35), 0.3, 1), zoneR: 0.055, solution: shot(0.35, 0, -0.3),
  },
  {
    id: 'klap2', group: 'Клапштос', title: 'Клапштос издалека', type: POT_ZONE, pocket: 0,
    goal: 'Длинный прямой удар в угол. Биток должен «встать» на месте прицельного шара.',
    hint: 'Чем длиннее удар, тем ниже центра нужно бить, иначе биток успеет накатиться.',
    pos: withCue(cueFor(0.35, 0.45, 0, 0, 0.95), 0.35, 0.45), zoneR: 0.06, solution: shot(0.5, 0, -0.45),
  },
  {
    id: 'nakat1', group: 'Накат', title: 'Накат: проводка', type: POT_ZONE, pocket: 2,
    goal: 'Забей шар и проведи биток вперёд, в зону перед лузой.',
    hint: 'Бей выше центра и мягко — дальность наката зависит и от точки, и от силы удара.',
    pos: withCue(cueFor(0.45, 1, 2, 0, 0.25), 0.45, 1), zoneR: 0.06, solution: shot(0.18, 0, 0.8),
  },
  {
    id: 'nakat2', group: 'Накат', title: 'Накат с подрезкой', type: POT_ZONE, pocket: 0,
    goal: 'Подрежь шар в угол и выведи биток накатом в зону.',
    hint: 'После подрезки накат «загибает» биток вперёд, ближе к линии прицельного шара.',
    pos: withCue(cueFor(0.3, 0.5, 0, 25, 0.5), 0.3, 0.5), zoneR: 0.07, solution: shot(0.3, 0, 0.7),
  },
  {
    id: 'ott1', group: 'Оттяжка', title: 'Оттяжка: прямой удар', type: POT_ZONE, pocket: 2,
    goal: 'Забей шар и оттяни биток назад, в зону за исходной точкой.',
    hint: 'Бей заметно ниже центра, кий веди насквозь — не обрывай удар.',
    pos: withCue(cueFor(0.3, 1, 2, 0, 0.3), 0.3, 1), zoneR: 0.06, solution: shot(0.3, 0, -0.8),
  },
  {
    id: 'ott2', group: 'Оттяжка', title: 'Оттяжка с подрезкой', type: POT_ZONE, pocket: 0,
    goal: 'Подрежь шар в угол и оттяни биток в зону.',
    hint: 'При подрезке оттяжка уводит биток назад от касательной линии.',
    pos: withCue(cueFor(0.3, 0.45, 0, 30, 0.45), 0.3, 0.45), zoneR: 0.09, solution: shot(0.45, 0, -0.85),
  },
  {
    id: 'cut1', group: 'Подрезка', title: 'Подрезка 30°', type: POT, pocket: 0,
    goal: 'Забей шар в угловую лузу. Целься через «мнимый шар».',
    hint: 'Представь биток вплотную к прицельному на линии в лузу и отправь его туда.',
    pos: withCue(cueFor(0.3, 0.35, 0, 30, 0.6), 0.3, 0.35), solution: shot(0.3, 0, 0),
  },
  {
    id: 'cut2', group: 'Подрезка', title: 'Тонкая подрезка', type: POT, pocket: 0,
    goal: 'Срежь шар тонко — биток едва касается его края.',
    hint: 'Чем тоньше подрезка, тем точнее нужен прицел. Сила — небольшая.',
    pos: withCue(cueFor(0.28, 0.3, 0, 55, 0.45), 0.28, 0.3), solution: shot(0.35, 0, 0),
  },
  {
    id: 'vint1', group: 'Винт', title: 'Винт: выход от борта', type: POT_ZONE, pocket: 0,
    goal: 'Забей шар и выведи биток от борта в зону — без винта туда не попасть.',
    hint: 'Боковой винт работает на борту: правый уводит отскок вправо, левый — влево.',
    pos: withCue(cueFor(0.3, 0.35, 0, -30, 0.5), 0.3, 0.35), zoneR: 0.08, solution: shot(0.45, 0.8, 0),
  },
  {
    id: 'svo1', group: 'Свояк', title: 'Свояк накатом', type: SVOYAK, pocket: 0, cuePocket: 0,
    goal: 'Забей шар и биток в одну лузу: биток идёт следом накатом.',
    hint: 'Бей высоко и уверенно, чтобы биток продолжил путь в лузу.',
    pos: withCue(cueFor(0.12, 0.12, 0, 0, 0.35), 0.12, 0.12), solution: shot(0.3, 0, 0.9),
  },
  {
    id: 'svo2', group: 'Свояк', title: 'Свояк оттяжкой', type: SVOYAK, pocket: -1, cuePocket: 4,
    goal: 'Ударь по шару и оттяжкой верни биток в лузу позади него.',
    hint: 'Нужна сильная оттяжка: бей низко и резко, с проводкой кия.',
    pos: svoyakDrawPos(), solution: shot(0.55, 0, -0.9),
  },
  {
    id: 'masse1', group: 'Массе', title: 'Массе: обвод шара', type: MASSE, pocket: -1, fixedAim: -1.23,
    goal: 'Шар-помеха закрывает прицельный. Обведи его дугой и попади в прицельный.',
    hint: 'Подними кий и бей сбоку битка: биток пойдёт по дуге в сторону винта.',
    pos: [0.5, 1.65, 0.5, 1.1, 0.5, 1.42], solution: shot(0.55, -0.9, -0.2, 0.9),
  },
].map((spec) => new Drill(spec));

export const drillById = (id) => DRILLS.find((d) => d.id === id);
