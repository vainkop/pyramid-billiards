import { Match, TARGET, FOOT_SPOT, PENALTY, VARIANT, VARIANT_NAMES, HOUSE_LINE, TEMP_HOUSE_LINE } from '../pyramid.js';
import { H } from '../physics.js';
import { LEVELS, planShot, planShotNow, choosePenaltyBall, chooseSvoyakBall, chooseNextOption } from '../ai.js';
import { TableView, GAME } from '../table-view.js';
import { ShotControls, playLayout } from '../shot-controls.js';
import { technique, LESSONS } from '../content.js';
import { store } from '../store.js';
import { h } from '../dom.js';
import { Scope, label, icon, buzz, segmented } from '../ui.js';

const AIM_TIME = 0.9; // seconds the computer spends swinging the cue into line
const DECIDE_TIME = 1100; // ms the computer "thinks" over a penalty ball or who plays next
const LEVEL_ORDER = [LEVELS.novice, LEVELS.amateur, LEVELS.master];

/**
 * The «Игра» tab: a setup page, or the table when a game is on. The game in
 * progress is saved after every shot, so leaving the tab never loses it.
 */
export function gameScreen(scope) {
  const root = h('div.game-root');
  let tableScope = null; // owns the current table's loop; replaced for every game
  const show = (el) => root.replaceChildren(el);
  const closeTable = () => {
    tableScope?.destroy();
    tableScope = null;
  };
  const openSetup = () => {
    closeTable();
    show(setupView(scope, startGame));
  };
  const startGame = (game) => {
    closeTable();
    tableScope = scope.keep(new Scope());
    const level = game.level ? LEVELS[game.level] : null;
    // the break alternates from game to game (п.14.1)
    const { variant, penalty } = game.match;
    const rematch = () => startGame(newGame(level, { variant, penalty, breaker: 1 - game.breaker }));
    show(matchView(tableScope, game, { exit: openSetup, rematch }));
  };
  const saved = store.savedGame();
  if (saved && saved.match.winner < 0 && store.setting('resume', true)) startGame(restore(saved));
  else openSetup();
  return root;
}

function newGame(level, { variant = store.setting('variant', VARIANT.free), penalty = store.setting('penalty', PENALTY.official), breaker = 0 } = {}) {
  const players = level
    ? [{ name: 'Ты', you: true }, { name: 'Компьютер', ai: level.id }]
    : [{ name: 'Игрок 1' }, { name: 'Игрок 2' }];
  return { match: new Match({ players, variant, penalty, breaker }), level: level?.id ?? null, breaker, tally: freshTally() };
}

/** Per-game counters of the human player's play (balls scored come from the final score). */
const freshTally = () => ({ svoyak: 0, hints: 0 });

function restore(saved) {
  return { match: Match.fromJSON(saved.match), level: saved.level, breaker: saved.breaker ?? 0, tally: saved.tally ?? freshTally() };
}

const persist = (game) =>
  store.saveGame({ match: game.match.toJSON(), level: game.level, breaker: game.breaker, tally: game.tally });

// ================================================================ setup

/** What each game is about, for the setup page. */
const GAMES = {
  [VARIANT.free]: {
    lead: `Свободная пирамида: бей любым шаром по любому, свояки засчитываются. Побеждает тот, кто первым наберёт ${TARGET}.`,
    lesson: LESSONS.findIndex((l) => l.title.startsWith('Американка')),
    rules: [
      'Разбой — цветным шаром из дома. Правильный разбой: забит шар, или 3 прицельных шара коснулись бортов, или 2 коснулись и один пересёк центр.',
      'Дальше битком может быть любой шар — удерживай его на столе, чтобы выбрать.',
      'Засчитываются все шары, упавшие при правильном ударе: «чужой» и сам биток («свояк»). Забил — бьёшь ещё.',
    ],
  },
  [VARIANT.combined]: {
    lead: `Комбинированная («московская») пирамида: бьют только цветным шаром. После свояка — шар взамен битка и удар с руки из дома. До ${TARGET} очков.`,
    lesson: LESSONS.findIndex((l) => l.title.startsWith('Сибирка')),
    rules: [
      'Разбой — как в «американке». Дальше бьют только цветным шаром.',
      'Свояк: сам снимаешь любой прицельный шар взамен битка (+1) и бьёшь с руки из дома — только по шару вне дома.',
      'Если все прицельные шары в доме — бьют с руки из временного дома у дальнего борта.',
    ],
  },
};
const COMMON_RULES = [
  'Фол: биток не задел ни одного шара; шар (любой) вылетел за борт; удар «без борта» — ничего не забито и шары не дошли до бортов.',
  'За фол соперник снимает со стола шар себе (+1) и решает: бить самому или передать удар. Шары, упавшие при фоле, ставятся на заднюю отметку.',
];

function setupView(scope, start) {
  const saved = store.savedGame();
  const stats = store.stats();
  let variant = store.setting('variant', VARIANT.free);
  let level = LEVELS[store.setting('level', 'amateur')] ?? LEVELS.amateur;
  let penalty = store.setting('penalty', PENALTY.official);

  // the parts of the page that depend on the chosen game, updated in place
  const title = h('h1');
  const lead = h('p.lead');
  const rules = h('ul.rules-list');
  const lessonLink = h('a.btn.secondary.wide', 'Правила и стратегия в уроке');
  const showVariant = () => {
    const game = GAMES[variant];
    title.textContent = VARIANT_NAMES[variant];
    lead.textContent = game.lead;
    rules.replaceChildren(...[...game.rules, ...COMMON_RULES].map((r) => h('li', r)));
    lessonLink.setAttribute('href', `#/lesson/${game.lesson}`);
  };
  showVariant();

  const recordText = (l) => `Побед: ${stats.wins[l.id] ?? 0} · поражений: ${stats.losses[l.id] ?? 0}`;
  const record = h('p.muted.small', recordText(level));
  const penaltyNote = h('p.muted.small');
  const describePenalty = () => {
    penaltyNote.textContent = penalty === PENALTY.club
      ? 'Клубный обычай: нарушитель возвращает на стол свой последний забитый шар.'
      : 'Официальные правила ФБСР: соперник нарушителя снимает со стола любой шар себе (+1).';
  };
  describePenalty();

  const variants = segmented(Object.values(VARIANT).map((v) => ({
    id: v, title: VARIANT_NAMES[v], note: v === VARIANT.free ? 'любым по любому' : 'только цветным',
  })), variant, (v) => {
    variant = v;
    store.setSetting('variant', v);
    showVariant();
  });
  const levels = segmented(LEVEL_ORDER.map((l) => ({ id: l.id, title: l.name, note: levelBlurb(l) })), level.id, (id) => {
    level = LEVELS[id];
    store.setSetting('level', id);
    record.textContent = recordText(level);
  });
  const penalties = segmented([
    { id: PENALTY.official, title: 'Официальный' },
    { id: PENALTY.club, title: 'Клубный' },
  ], penalty, (id) => {
    penalty = id;
    store.setSetting('penalty', id);
    describePenalty();
  });

  const resumable = saved && saved.match.winner < 0;
  return h('section.page',
    label('Игра'),
    title,
    variants,
    lead,
    resumable ? h('div.card.resume',
      h('div', label(`Не закончена: ${VARIANT_NAMES[saved.match.variant ?? VARIANT.free]}`),
        h('h3', `${saved.match.players[0].name} ${saved.match.scores[0]} : ${saved.match.scores[1]} ${saved.match.players[1].name}`)),
      h('button.btn.primary', { onclick: () => start(restore(saved)) }, 'Продолжить')) : null,
    h('div.card',
      label('Против компьютера'),
      levels,
      record,
      h('button.btn.primary.wide', { onclick: () => start(newGame(level, { variant, penalty })) }, resumable ? 'Новая партия' : 'Начать партию')),
    h('div.card',
      label('Вдвоём на одном телефоне'),
      h('p', 'Передавайте телефон друг другу после каждого промаха.'),
      h('button.btn.secondary.wide', { onclick: () => start(newGame(null, { variant, penalty })) }, 'Играть вдвоём')),
    h('div.card',
      label('Штраф за фол'),
      penalties,
      penaltyNote),
    h('div.card',
      label('Правила коротко'),
      rules,
      lessonLink),
    stats.games ? h('div.card',
      label('Твоя статистика'),
      h('div.stats',
        h('div.stat', h('b', String(stats.games)), h('span', 'партий')),
        h('div.stat', h('b', String(stats.potted)), h('span', 'шаров')),
        h('div.stat', h('b', String(stats.svoyak)), h('span', 'свояков')))) : null);
}

function levelBlurb(l) {
  return { novice: 'часто мажет', amateur: 'играет с вращением', master: 'строит позицию' }[l.id];
}

// ================================================================ the table

function matchView(scope, game, { exit, rematch }) {
  const { match } = game;
  const level = game.level ? LEVELS[game.level] : null;
  const isComputer = (p = match.cur) => Boolean(match.players[p].ai);

  const status = h('h3.status');
  const detail = h('p.status-detail');
  const hintBtn = h('button.btn.secondary.small', { 'aria-label': 'Подсказка тренера' }, icon('bulb'), 'Совет');
  const scoreboard = h('div.scoreboard');
  const overlay = h('div.game-over.hidden');
  const decision = h('div.game-over.decision.hidden');

  const canvas = h('canvas.table');
  const table = scope.keep(new TableView(canvas, {
    mode: GAME,
    labels: match.labels,
    onShotDone: shotDone,
    onSelectBall: selectBall,
    onPick: pick,
    canPick: (i) => match.canTake(i),
    canPlace: (x, y) => match.ballInHand && !isComputer() && match.canPlaceStriker(x, y),
    handZone: () => {
      if (!match.ballInHand || isComputer() || match.pending) return null;
      return match.tempHouse ? [0, TEMP_HOUSE_LINE] : [HOUSE_LINE, H];
    },
  }));
  table.setPhysics(match.table);
  const controls = new ShotControls(scope, {
    onChange: (v, { silent } = {}) => onControls(v, silent),
    onShoot: shoot,
  });

  let ai = null; // { it, plan, t, from }
  let miscueShot = false;

  function onControls(values, silent) {
    table.setParams(values);
    if (silent || isComputer()) return;
    const pulling = controls.strip.power > 0;
    if (!pulling) table.hint = false; // changing spin or tilt drops the coach's path; pulling keeps it
    if (pulling) setStatus(`Сила ${Math.round(values.power * 100)}%`, `${controls.technique.name}. Отпусти — удар, верни наверх — отмена.`);
    else describeSettings();
  }

  function setStatus(text, more = '', tone = '') {
    status.textContent = text;
    status.className = `status ${tone}`;
    detail.textContent = more;
  }

  function describeSettings() {
    const t = controls.technique;
    setStatus(t.name, t.desc);
  }

  function renderScoreboard() {
    const active = match.pending ? match.pending.taker : match.cur; // after a foul the opponent is the one deciding
    scoreboard.replaceChildren(...[0, 1].map((p) => h(`div.player${active === p && !match.over ? '.active' : ''}`,
      h('div.player-name', match.players[p].name,
        match.players[p].ai && level ? h('small', ` · ${level.name}`) : null),
      h('div.player-score', h('b', String(match.scores[p])), h('span', ` / ${TARGET}`)),
      h('div.pips', Array.from({ length: TARGET }, (_, k) => h(`i${k < match.scores[p] ? '.on' : ''}`))))),
    h('button.icon-btn', { 'aria-label': 'Меню партии', onclick: exit }, icon('more')));
  }

  function turnStarted() {
    renderScoreboard();
    table.pickMode = false;
    table.invalidate();
    const name = match.current.name;
    controls.locked = isComputer();
    table.locked = isComputer();
    hintBtn.disabled = isComputer();
    if (isComputer()) {
      setStatus(`${name} думает…`, match.message);
      ai = { it: planShot(match, level), plan: null, t: 0 };
      return;
    }
    let hand = 'Удерживай шар, чтобы бить им. Потяни кий справа вниз и отпусти.';
    if (match.isBreak) hand = `${match.name}. Разбой: перетащи цветной шар в доме и бей по пирамиде — нужно довести шары до бортов.`;
    else if (match.combined && match.ballInHand) {
      hand = match.tempHouse
        ? 'С руки из временного дома: все шары в доме — ставь биток за линией у дальнего борта.'
        : 'С руки из дома: перетащи биток в подсвеченной зоне и бей по шару вне дома.';
    } else if (match.combined) hand = 'Бей цветным шаром. Потяни кий справа вниз и отпусти.';
    setStatus(level ? 'Твой удар' : `Ход: ${name}`, `${match.message} ${hand}`.trim());
  }

  function selectBall(i) {
    if (table.busy || isComputer()) return;
    if (match.combined) return setStatus('Сибирка', 'Здесь бьют только цветным шаром — белые служат прицельными.', 'bad');
    if (match.isBreak) return setStatus('Разбой', 'Разбивают шаром без номера.', 'bad');
    if (match.selectStriker(i)) {
      buzz();
      table.invalidate();
      setStatus(`Бьёшь шаром ${match.strikerLabel || 'без номера'}`, match.ballInHand ? 'Он перенесён в дом — перетащи, куда удобно.' : 'Теперь прицелься.');
    }
  }

  function shoot() {
    if (table.busy || isComputer() || match.over) return;
    miscueShot = false;
    if (table.shoot({ fire: (...a) => match.shoot(...a) })) {
      miscueShot = table.miscue;
      lock(true);
      setStatus('Удар!', 'Коснись стола, чтобы сразу увидеть результат.');
    }
  }

  function lock(v) {
    controls.locked = v;
    hintBtn.disabled = v;
  }

  function shotDone() {
    const shooter = match.cur;
    const humanShot = !isComputer(shooter);
    match.endShot();
    const shot = match.lastShot;
    if (humanShot && shot.svoyak) game.tally.svoyak += 1;
    persist(game);
    if (match.over) return finish();
    if (match.pending) return handlePending();
    turnStarted();
    // the player gets feedback on their own shot; the computer's result is in the turn message
    if (humanShot) review(shot, miscueShot);
  }

  // ---- after a foul: the penalty ball, then who plays next (СП п.6, п.7.4, п.13.2)

  function handlePending() {
    const p = match.pending;
    renderScoreboard();
    if (!p) return turnStarted();
    ai = null;
    lock(true);
    table.locked = true;
    const taker = match.players[p.taker];
    if (p.kind === 'svoyak') {
      if (isComputer(p.taker)) {
        setStatus(`Свояк! ${match.lastShot.technique}`, match.message, 'ok');
        scope.timeout(() => decide(() => match.takeForSvoyak(chooseSvoyakBall(match))), DECIDE_TIME);
      } else {
        table.locked = false;
        table.pickMode = true;
        setStatus(`Свояк! ${match.lastShot.technique}`, `${match.message} Коснись прицельного шара.`, 'ok');
      }
      return;
    }
    if (p.kind === 'penalty') {
      if (isComputer(p.taker)) {
        setStatus('Фол', match.message, 'bad');
        scope.timeout(() => decide(() => match.takePenalty(choosePenaltyBall(match))), DECIDE_TIME);
      } else {
        table.locked = false;
        table.pickMode = true;
        setStatus(level ? 'Фол соперника' : `Фол · ${taker.name} снимает шар`, `${match.message} Коснись шара на столе.`, 'bad');
      }
      return;
    }
    if (isComputer(p.taker)) {
      setStatus(`${taker.name} решает…`, match.message);
      scope.timeout(() => decide(() => match.chooseNext(chooseNextOption(match))), DECIDE_TIME);
      return;
    }
    const names = {
      play: 'Бить самому', pass: 'Передать удар',
      'rerack-self': 'Расставить заново и разбить', 'rerack-pass': 'Расставить заново — разбивает соперник',
    };
    decision.replaceChildren(h('div.sheet',
      h('h2', taker.you ? 'Твоё решение' : `Решает ${taker.name}`),
      h('p', match.message),
      match.options().map((o, k) => h(`button.btn.${k ? 'secondary' : 'primary'}.wide`, {
        onclick: () => {
          decision.classList.add('hidden');
          decide(() => match.chooseNext(o));
        },
      }, names[o]))));
    decision.classList.remove('hidden');
    setStatus(taker.you ? 'Твоё решение' : `Решает ${taker.name}`, match.message);
  }

  function decide(action) {
    if (scope.dead) return;
    action();
    persist(game);
    if (match.over) return finish();
    if (match.pending) return handlePending();
    turnStarted();
  }

  /** A tap on a ball while picking: the penalty ball, or (сибирка) the ball taken for a свояк. */
  function pick(i) {
    const p = match.pending;
    if (!p || isComputer(p.taker)) return;
    const taken = p.kind === 'svoyak' ? match.takeForSvoyak(i) : p.kind === 'penalty' && match.takePenalty(i);
    if (!taken) return;
    buzz(20);
    table.pickMode = false;
    persist(game);
    decide(() => {});
  }

  /** Feedback on the shot just played, with the technique that was used. */
  function review(shot, miscue) {
    if (miscue) return setStatus('Кикс!', 'Наклейка соскочила — бей ближе к центру битка. ' + match.message, 'bad');
    if (shot.foul) return setStatus('Фол', match.message, 'bad');
    if (shot.svoyak) return setStatus(`Свояк! ${shot.technique}`, match.message, 'ok');
    if (shot.pocketed.length) return setStatus(`Забит${shot.pocketed.length > 1 ? 'о ' + shot.pocketed.length : ''}! ${shot.technique}`, match.message, 'ok');
    return setStatus('Мимо', match.message);
  }

  function hint() {
    if (table.busy || isComputer() || match.over) return;
    const plan = planShotNow(match, LEVELS.master, { exact: true });
    applyPlan(plan);
    table.aim = plan.aim;
    table.hint = true;
    table.invalidate();
    game.tally.hints += 1;
    const t = technique(plan.ox, plan.oy, plan.elev);
    setStatus(`Совет: шар ${match.strikerLabel || 'без номера'}`,
      `${cap(plan.kind)} — ${t.name.toLowerCase()}, сила ${Math.round(plan.power * 100)}% (отметка на кие). Пунктир — пути шаров.`);
  }

  function applyPlan(plan) {
    if (plan.striker !== 0) match.selectStriker(plan.striker);
    if (plan.place) match.table.place(0, plan.place.x, plan.place.y);
    controls.set({ power: plan.power, ox: plan.ox, oy: plan.oy, elev: plan.elev });
    table.invalidate();
  }

  // the computer: think (several trial shots per frame), show its choice, swing, strike
  scope.loop((dt) => {
    if (!ai || table.busy || match.over) return;
    if (!ai.plan) {
      for (let k = 0; k < 6; k++) {
        const r = ai.it.next();
        if (!r.done) continue;
        ai.plan = r.value;
        ai.from = table.aim;
        applyPlan(ai.plan);
        const t = technique(ai.plan.ox, ai.plan.oy, ai.plan.elev);
        setStatus(`${match.current.name}: шар ${match.strikerLabel || 'без номера'}`,
          `${cap(ai.plan.kind)} — ${t.name.toLowerCase()}, сила ${Math.round(ai.plan.power * 100)}%.`);
        break;
      }
      return;
    }
    ai.t += dt;
    const k = Math.min(1, ai.t / AIM_TIME);
    const ease = k * k * (3 - 2 * k);
    table.aim = ai.from + Math.atan2(Math.sin(ai.plan.aim - ai.from), Math.cos(ai.plan.aim - ai.from)) * ease;
    table.invalidate();
    if (ai.t > AIM_TIME + 0.3 && !ai.stroking) {
      // draw the cue back on the strip, then strike
      ai.stroking = true;
      const { plan } = ai;
      table.aim = plan.aim;
      controls.stroke(plan.power).then(() => {
        if (scope.dead) return; // left the screen meanwhile
        ai = null;
        table.shoot({ allowMiscue: false, fire: (...a) => match.shoot(...a) });
      });
    }
  });

  function finish() {
    renderScoreboard();
    lock(true);
    const won = match.winner === 0;
    const vsComputer = Boolean(level);
    // balls put back as foul penalties don't count: the final score is what the player kept
    store.recordGame({ level: game.level, won: vsComputer && won, svoyak: game.tally.svoyak, potted: vsComputer ? match.scores[0] : 0 });
    store.saveGame(null);
    const title = vsComputer ? (won ? 'Победа!' : 'Поражение') : `${match.players[match.winner].name} — победа!`;
    overlay.replaceChildren(h('div.sheet',
      h('div.trophy', won || !vsComputer ? '🏆' : '🎱'),
      h('h2', title),
      h('p', `Счёт ${match.scores[0]} : ${match.scores[1]}`),
      h('p.muted', `Свояков: ${game.tally.svoyak}${game.tally.hints ? ` · подсказок: ${game.tally.hints}` : ''}`),
      h('button.btn.primary.wide', { onclick: rematch }, 'Реванш'),
      h('button.btn.secondary.wide', { onclick: exit }, 'В меню')));
    overlay.classList.remove('hidden');
    setStatus(title, match.message, won || !vsComputer ? 'ok' : 'bad');
  }

  hintBtn.addEventListener('click', hint);

  const view = playLayout({
    className: '.game',
    head: scoreboard,
    canvas,
    overlay: [overlay, decision],
    controls,
    status,
    detail,
    actions: [
      h('button.btn.secondary.small.square', { 'aria-label': 'Прицел левее', onclick: () => table.nudgeAim(-0.001) }, '◀'),
      h('button.btn.secondary.small.square', { 'aria-label': 'Прицел правее', onclick: () => table.nudgeAim(0.001) }, '▶'),
      hintBtn,
    ],
  });

  persist(game);
  controls.set({ power: match.isBreak ? 0.9 : 0.4, ox: 0, oy: match.isBreak ? 0.2 : 0, elev: 0 });
  table.aim = Math.atan2(FOOT_SPOT.y - match.table.y[0], FOOT_SPOT.x - match.table.x[0]);
  if (match.pending) handlePending(); // a game saved in the middle of a foul decision
  else turnStarted();
  return view;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
