import { Match, TARGET, FOOT_SPOT, PENALTY, VARIANT, VARIANT_NAMES, HOUSE_LINE, TEMP_HOUSE_LINE } from '../pyramid.js';
import { H } from '../physics.js';
import { LEVELS, planShot, planShotNow, choosePenaltyBall, chooseSvoyakBall, chooseNextOption } from '../ai.js';
import { TableView, GAME } from '../table-view.js';
import { ShotControls, playLayout } from '../shot-controls.js';
import { technique, LESSONS } from '../content.js';
import { signed } from '../kolkhoz.js';
import { store } from '../store.js';
import { h } from '../dom.js';
import { Scope, label, icon, buzz, segmented, plural, backBar } from '../ui.js';

const AIM_TIME = 0.9; // seconds the computer spends swinging the cue into line
const DECIDE_TIME = 1100; // ms the computer "thinks" over a penalty ball or who plays next
const LEVEL_ORDER = [LEVELS.novice, LEVELS.amateur, LEVELS.master];
/** Колхоз against the computer: the regulars of any billiard hall. */
const RIVALS = ['Петрович', 'Михалыч', 'Палыч', 'Кузьмич'];
const KOLKHOZ_SIZES = [3, 4, 5];

/**
 * The «Игра» tab: a setup page, or the table when a game is on. The game in
 * progress is saved after every shot, so leaving the tab never loses it.
 * `#/game/kolkhoz` opens the setup of колхоз instead of the game of two.
 */
export function gameScreen(scope, arg) {
  const kolkhozPage = arg === 'kolkhoz';
  const root = h('div.game-root');
  let tableScope = null; // owns the current table's loop; replaced for every game
  const show = (el) => root.replaceChildren(el);
  const closeTable = () => {
    tableScope?.destroy();
    tableScope = null;
  };
  const openSetup = () => {
    closeTable();
    show(kolkhozPage ? kolkhozSetupView(startGame) : setupView(scope, startGame));
  };
  const startGame = (game) => {
    closeTable();
    tableScope = scope.keep(new Scope());
    const level = game.level ? LEVELS[game.level] : null;
    // the break alternates from game to game (п.14.1); in колхоз it goes round the table
    const { variant, penalty } = game.match;
    const rematch = () => startGame(newGame(level, { variant, penalty, breaker: game.match.next(game.breaker), kolkhoz: game.kolkhoz }));
    show(matchView(tableScope, game, { exit: openSetup, rematch }));
  };
  const saved = store.savedGame();
  // the колхоз page always shows its setup first: the unfinished game is offered there
  if (saved && saved.match.winner < 0 && store.setting('resume', true) && !kolkhozPage) startGame(restore(saved));
  else openSetup();
  return root;
}

/** A new game: two players, or колхоз { size, humans } — 3–5 players, the rest of them computers. */
function newGame(level, { variant = store.setting('variant', VARIANT.free), penalty = store.setting('penalty', PENALTY.official), breaker = 0, kolkhoz = null } = {}) {
  const players = kolkhoz ? kolkhozPlayers(kolkhoz, level) : level
    ? [{ name: 'Ты', you: true }, { name: 'Компьютер', ai: level.id }]
    : [{ name: 'Игрок 1' }, { name: 'Игрок 2' }];
  const match = new Match({ players, variant, penalty, breaker, kolkhoz: kolkhoz ? { hapuga: Boolean(kolkhoz.hapuga) } : null });
  return { match, level: kolkhoz && kolkhoz.humans >= kolkhoz.size ? null : level?.id ?? null, breaker, kolkhoz, tally: freshTally() };
}

/** Колхоз seats: the people first («Ты» when alone), then the computers. */
function kolkhozPlayers({ size, humans }, level) {
  const people = humans === 1 ? [{ name: 'Ты', you: true }] : Array.from({ length: humans }, (_, i) => ({ name: `Игрок ${i + 1}` }));
  return [...people, ...RIVALS.slice(0, size - humans).map((name) => ({ name, ai: level.id }))];
}

/** Per-game counters of the human player's play (balls scored come from the final score). */
const freshTally = () => ({ svoyak: 0, hints: 0 });

function restore(saved) {
  return { match: Match.fromJSON(saved.match), level: saved.level, breaker: saved.breaker ?? 0, kolkhoz: saved.kolkhoz ?? null, tally: saved.tally ?? freshTally() };
}

const persist = (game) =>
  store.saveGame({ match: game.match.toJSON(), level: game.level, breaker: game.breaker, kolkhoz: game.kolkhoz, tally: game.tally });

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
    resumable ? resumeCard(saved, start) : null,
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
      label('Колхоз — втроём и больше'),
      h('p', 'От 3 до 5 игроков: люди и компьютеры в любом сочетании. Каждый за себя, по кругу, пока не кончатся шары.'),
      h('a.btn.primary.wide', { href: '#/game/kolkhoz' }, 'Настроить колхоз'),
      h('a.btn.secondary.wide', { href: '#/kolkhoz' }, 'Счёт для настоящего стола')),
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

/** The unfinished game, any kind, with a button to go on with it. */
function resumeCard(saved, start) {
  const m = saved.match;
  return h('div.card.resume',
    h('div', label(`Не закончена: ${m.kolkhoz ? 'колхоз · ' : ''}${VARIANT_NAMES[m.variant ?? VARIANT.free]}`),
      h('h3', m.kolkhoz
        ? m.players.map((p, i) => `${p.name} ${m.scores[i]}`).join(' · ')
        : `${m.players[0].name} ${m.scores[0]} : ${m.scores[1]} ${m.players[1].name}`)),
    h('button.btn.primary', { onclick: () => start(restore(saved)) }, 'Продолжить'));
}

/** «Колхоз на столе»: the game, how many play, how many of them are people, how strong the computers are. */
function kolkhozSetupView(start) {
  const saved = store.savedGame();
  let variant = store.setting('variant', VARIANT.free);
  let level = LEVELS[store.setting('level', 'amateur')] ?? LEVELS.amateur;
  let size = store.setting('kolkhozPlayers', 3);
  let humans = Math.min(size, store.setting('kolkhozHumans', 1));
  let hapuga = store.setting('kolkhozHapuga', false);

  const who = h('p.muted.small');
  const humansBox = h('div');
  const computerCard = h('div.card',
    label('Компьютеры'),
    segmented(LEVEL_ORDER.map((l) => ({ id: l.id, title: l.name, note: levelBlurb(l) })), level.id, (id) => {
      level = LEVELS[id];
      store.setSetting('level', id);
    }),
    h('p.muted.small', 'В колхозе любитель и мастер играют по-колхозному: их шары оплачивает предыдущий игрок, а за промах платит следующий — он получает стол. Поэтому они взвешивают каждый рискованный шар против отыгрыша, который оставит следующему меньше всего, и смелее бьют последний шар — он за два. Новичок просто бьёт первый удобный шар.'));
  const describe = () => {
    const bots = size - humans;
    const people = humans === 1 ? 'Ты' : `${humans} ${humans < 5 ? 'человека' : 'человек'} на одном телефоне`;
    who.textContent = bots ? `${people} и ${plural(bots, ['компьютер', 'компьютера', 'компьютеров'])}: ${RIVALS.slice(0, bots).join(', ')}.` : `${people}, без компьютеров.`;
    computerCard.classList.toggle('hidden', !bots);
  };
  const showHumans = () => {
    humansBox.replaceChildren(segmented(Array.from({ length: size }, (_, k) => ({
      id: k + 1, title: String(k + 1), note: k + 1 === size ? 'все' : k ? 'людей' : 'ты',
    })), humans, (n) => {
      humans = n;
      store.setSetting('kolkhozHumans', n);
      describe();
    }));
    describe();
  };
  showHumans();

  return h('section.page',
    backBar('Колхоз на столе', 'game'),
    h('h1', 'Колхоз на столе'),
    h('p.lead', 'Каждый за себя, по кругу, пока не кончатся шары. Итог — разница в очках с тем, кто бьёт после тебя.'),
    saved && saved.match.winner < 0 ? resumeCard(saved, start) : null,
    h('div.card',
      label('Игра'),
      segmented(Object.values(VARIANT).map((v) => ({ id: v, title: VARIANT_NAMES[v], note: v === VARIANT.free ? 'любым по любому' : 'только цветным' })), variant, (v) => {
        variant = v;
        store.setSetting('variant', v);
      })),
    h('div.card',
      label('Сколько игроков'),
      segmented(KOLKHOZ_SIZES.map((n) => ({ id: n, title: String(n), note: n < 5 ? 'игрока' : 'игроков' })), size, (n) => {
        size = n;
        humans = Math.min(humans, n);
        store.setSetting('kolkhozPlayers', n);
        showHumans();
      }),
      label('Из них людей'),
      humansBox,
      who),
    computerCard,
    h('div.card',
      label('Хапуга'),
      segmented([{ id: 'no', title: 'Без хапуги' }, { id: 'yes', title: 'С хапугой' }], hapuga ? 'yes' : 'no', (id) => {
        hapuga = id === 'yes';
        store.setSetting('kolkhozHapuga', hapuga);
      }),
      h('p.muted.small', 'Клубная ставка: перед ударом объяви шар, который точно забьёшь (кнопка «Хапуга», потом касание шара). Забил его — шар вдвойне. Не забил — минус 2 очка, фол — штраф вдвойне. Компьютер объявляет хапугу, только когда уверен в ударе.')),
    h('div.card',
      label('Правила коротко'),
      h('ul.rules-list', [
        'Порядок ударов постоянный; в следующей партии разбивает следующий игрок.',
        'Забил — бьёшь ещё, промахнулся — бьёт следующий.',
        'Партия идёт, пока не кончатся шары; последний шар — за два.',
        'Фол — минус очко нарушителю, удар переходит к следующему.',
        'Итог — твои очки минус очки следующего игрока: твои шары оплачивает тот, кто бьёт перед тобой.',
      ].map((r) => h('li', r))),
      h('a.btn.secondary.wide', { href: `#/lesson/${LESSONS.findIndex((l) => l.title.startsWith('Колхоз'))}` }, 'Урок о колхозе')),
    h('button.btn.primary.wide', { onclick: () => start(newGame(level, { variant, kolkhoz: { size, humans, hapuga } })) }, 'Начать колхоз'),
    h('a.btn.secondary.wide', { href: '#/kolkhoz' }, 'Счёт для настоящего стола'));
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
  // колхоз: name a ball as «хапуга» before the shot
  const hapugaBtn = match.kolkhoz?.hapuga ? h('button.btn.secondary.small.hapuga-btn', { 'aria-label': 'Объявить хапугу' }, 'Хапуга') : null;
  let declaring = false;
  // the dock has room for one more button only if the coach's button shows just its bulb
  if (hapugaBtn) hintBtn.lastChild.remove();
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
    canPick: (i) => (declaring ? match.canDeclare(i) : match.canTake(i)),
    marked: () => match.hapugaSlot,
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
    if (match.kolkhoz) {
      // колхоз: points and the result against the next player, for everybody at the table
      const nets = match.nets;
      scoreboard.classList.add('many');
      scoreboard.replaceChildren(...match.players.map((pl, p) => h(`div.player${active === p && !match.over ? '.active' : ''}`,
        h('div.player-name', pl.name),
        h('div.player-score', h('b', String(match.scores[p])), h(`span.${nets[p] > 0 ? 'ok' : nets[p] < 0 ? 'bad' : 'muted'}`, ` ${signed(nets[p])}`)))),
      h('button.icon-btn', { 'aria-label': 'Меню партии', onclick: exit }, icon('more')));
      return;
    }
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
    declaring = false;
    showHapuga();
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
    if (match.kolkhoz && !match.isBreak) hand += ` Осталось ${plural(match.ballsLeft, ['шар', 'шара', 'шаров'])}.`;
    setStatus(match.current.you ? 'Твой удар' : `Ход: ${name}`, `${match.message} ${hand}`.trim());
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
    if (declaring) {
      // the cue was struck while choosing: no ball named, no bet
      declaring = false;
      table.pickMode = false;
    }
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
    if (hapugaBtn) hapugaBtn.disabled = v;
  }

  // ---- колхоз, «хапуга»: tap the button, then the ball you are sure to pot

  function showHapuga() {
    if (!hapugaBtn) return;
    hapugaBtn.disabled = isComputer() || match.isBreak || Boolean(match.pending) || match.over;
    hapugaBtn.classList.toggle('on', match.hapuga >= 0 || declaring);
    hapugaBtn.textContent = match.hapuga >= 0 ? `Хапуга: ${match.hapuga || 'цв.'}` : 'Хапуга';
  }

  function toggleHapuga() {
    if (table.busy || isComputer() || match.isBreak || match.pending) return;
    if (match.hapuga >= 0 || declaring) {
      // a second tap takes the bet back
      match.hapuga = -1;
      declaring = false;
      table.pickMode = false;
      table.invalidate();
      showHapuga();
      return describeSettings();
    }
    declaring = true;
    table.pickMode = true;
    showHapuga();
    const miss = match.kolkhoz.hapugaMiss;
    setStatus('Хапуга', `Коснись шара, который точно забьёшь этим ударом: забьёшь — он вдвойне, нет — минус ${miss}, фол — штраф вдвойне.`);
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
    if (declaring) {
      if (!match.declareHapuga(i)) return;
      buzz(20);
      declaring = false;
      table.pickMode = false;
      table.invalidate();
      showHapuga();
      setStatus(`Хапуга: шар ${match.hapuga || 'без номера'}`, 'Шар обведён красным. Забьёшь его этим ударом — он вдвойне. Нажми «Хапуга» ещё раз, чтобы передумать.', 'ok');
      return;
    }
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
        const named = ai.plan.hapuga >= 0 && match.declareHapuga(match.labels.indexOf(ai.plan.hapuga));
        setStatus(`${match.current.name}: шар ${match.strikerLabel || 'без номера'}`,
          `${named ? `Хапуга на шар ${ai.plan.hapuga || 'без номера'}! ` : ''}${cap(ai.plan.kind)} — ${t.name.toLowerCase()}, сила ${Math.round(ai.plan.power * 100)}%.`);
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
    if (match.kolkhoz) return finishKolkhoz();
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

  /** Колхоз: the round's table — points and each player's result, best first. */
  function finishKolkhoz() {
    const you = match.players.findIndex((p) => p.you);
    store.recordGame({ level: null, won: false, svoyak: game.tally.svoyak, potted: you >= 0 ? Math.max(0, match.scores[you]) : 0 });
    store.saveGame(null);
    const nets = match.nets;
    const order = match.players.map((_, i) => i).sort((a, b) => nets[b] - nets[a] || a - b);
    const best = match.players[match.winner];
    const happy = best.you || you < 0;
    const title = best.you ? 'Лучший итог!' : `${best.name} — лучший итог`;
    const tone = (v) => (v > 0 ? 'ok' : v < 0 ? 'bad' : 'muted');
    overlay.replaceChildren(h('div.sheet',
      h('div.trophy', happy ? '🏆' : '🎱'),
      h('h2', title),
      h('div.k-table',
        h('div.k-tr.k-th', h('span', 'Игрок'), h('span', 'Очки'), h('span', 'Итог')),
        order.map((i) => h('div.k-tr',
          h('span', match.players[i].name, i === match.lastBall ? ' ★' : ''),
          h('span', String(match.scores[i])),
          h(`span.${tone(nets[i])}`, signed(nets[i]))))),
      h('p.muted.small', 'Итог — очки минус очки следующего игрока. ★ — последний шар, за два.'),
      h('button.btn.primary.wide', { onclick: rematch }, 'Ещё партия'),
      h('button.btn.secondary.wide', { onclick: exit }, 'В меню')));
    overlay.classList.remove('hidden');
    setStatus(title, match.message, happy ? 'ok' : 'bad');
  }

  hintBtn.addEventListener('click', hint);
  hapugaBtn?.addEventListener('click', toggleHapuga);

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
      hapugaBtn,
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
