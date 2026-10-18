import {
  KolkhozSession, DEFAULTS, SETTLE, SETTLE_NAMES, SETTLE_NOTES, MIN_PLAYERS, MAX_PLAYERS, nets, rub, signed, signedRub,
} from '../kolkhoz.js';
import { LESSONS } from '../content.js';
import { store } from '../store.js';
import { h } from '../dom.js';
import { label, buzz, segmented, progressBar, plural } from '../ui.js';

const APP_URL = 'https://vainkop.github.io/pyramid-billiards/#/kolkhoz';
const LESSON = LESSONS.findIndex((l) => l.title.startsWith('Колхоз'));
const ROUNDS = ['партия', 'партии', 'партий'];

/**
 * «Колхоз» tab: a score sheet for a real table. Players in turn order, a tap per
 * ball or foul, every tap can be undone; the round's and the session's results
 * and who pays whom are always on screen. The session is saved after every tap.
 */
export function kolkhozScreen(scope) {
  const root = h('section.page.kolkhoz');
  let session = loadSession();
  const save = () => store.saveKolkhoz(session ? session.toJSON() : null);
  const render = () => root.replaceChildren(...(session ? sheetView() : setupView()));

  // ---------------------------------------------------------------- setup

  function setupView() {
    const draft = store.kolkhozSetup() ?? { players: ['Игрок 1', 'Игрок 2', 'Игрок 3'], settings: { ...DEFAULTS } };
    const settings = { ...DEFAULTS, ...draft.settings, extras: [...(draft.settings?.extras ?? [])] };
    let players = [...draft.players];
    const keep = () => store.setKolkhozSetup({ players, settings });

    const list = h('div.k-players');
    const showPlayers = () => {
      list.replaceChildren(...players.map((name, i) => h('div.k-player-row',
        h('span.k-order', String(i + 1)),
        h('input.k-input', {
          value: name, maxlength: 20, 'aria-label': `Игрок ${i + 1}`, autocomplete: 'off',
          oninput: (e) => { players[i] = e.target.value; keep(); },
        }),
        h('button.icon-btn.k-mini', { type: 'button', 'aria-label': 'Выше', disabled: i === 0, onclick: () => move(i, -1) }, '▲'),
        h('button.icon-btn.k-mini', { type: 'button', 'aria-label': 'Ниже', disabled: i === players.length - 1, onclick: () => move(i, 1) }, '▼'),
        h('button.icon-btn.k-mini', { type: 'button', 'aria-label': 'Убрать', disabled: players.length <= MIN_PLAYERS, onclick: () => remove(i) }, '✕'))));
      add.disabled = players.length >= MAX_PLAYERS;
    };
    const move = (i, d) => {
      [players[i], players[i + d]] = [players[i + d], players[i]];
      keep();
      showPlayers();
    };
    const remove = (i) => {
      players.splice(i, 1);
      keep();
      showPlayers();
    };
    const add = h('button.btn.secondary.wide', { type: 'button', onclick: () => {
      players.push(`Игрок ${players.length + 1}`);
      keep();
      showPlayers();
    } }, '+ Добавить игрока');
    showPlayers();

    const number = (key, { min = 0, step = 1, max } = {}) => h('input.k-input.k-num', {
      type: 'number', inputmode: 'decimal', min, max, step, value: settings[key],
      oninput: (e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v) && v >= min) settings[key] = v;
        keep();
      },
    });
    const field = (text, input, note) => h('label.k-field', h('span', text, note ? h('small', note) : null), input);

    const settleNote = h('p.muted.small', SETTLE_NOTES[settings.settle]);
    const extrasBox = h('div.k-extras');
    const showExtras = () => extrasBox.replaceChildren(...settings.extras.map((e, i) => h('div.k-player-row',
      h('input.k-input', { value: e.name, maxlength: 14, 'aria-label': 'Название шара', oninput: (ev) => { e.name = ev.target.value; keep(); } }),
      h('input.k-input.k-num', {
        type: 'number', inputmode: 'decimal', min: 0, step: 1, value: e.value, 'aria-label': 'Очков за шар',
        oninput: (ev) => { e.value = Math.max(0, Number(ev.target.value) || 0); keep(); },
      }),
      h('button.icon-btn.k-mini', { type: 'button', 'aria-label': 'Убрать шар', onclick: () => { settings.extras.splice(i, 1); keep(); showExtras(); } }, '✕'))));
    showExtras();

    const error = h('p.bad.small.hidden');
    const start = () => {
      const names = players.map((p, i) => p.trim() || `Игрок ${i + 1}`);
      if (new Set(names).size !== names.length) {
        error.textContent = 'У игроков должны быть разные имена.';
        error.classList.remove('hidden');
        return;
      }
      if (!(settings.balls >= 1)) settings.balls = DEFAULTS.balls;
      settings.extras = settings.extras.filter((e) => e.name.trim()).map((e) => ({ name: e.name.trim(), value: e.value }));
      players = names;
      keep();
      session = new KolkhozSession({ players: names, ...settings });
      save();
      buzz(20);
      render();
    };

    return [
      label('Колхоз'),
      h('h1', 'Счёт колхоза'),
      h('p.lead', 'Таблица расчёта для игры втроём и больше: кто сколько забил и кто кому сколько должен. Удобно держать телефон у стола.'),
      h('div.card',
        label('Игроки — в порядке ударов'),
        h('p.muted.small', 'Твои шары оплачивает тот, кто бьёт перед тобой. Порядок можно поменять стрелками.'),
        list, add),
      h('div.card',
        label('Договорённость'),
        field('Цена очка, ₽', number('price', { min: 0, step: 10 })),
        field('Шаров в партии', number('balls', { min: 1, max: 30 }), 'партия кончается, когда все забиты'),
        field('Очков за шар', number('value', { min: 0 })),
        field('Фол — минус очков', number('foul', { min: 0 })),
        h('div.k-field', h('span', 'Последний шар — за два')),
        segmented([{ id: 'yes', title: 'Да' }, { id: 'no', title: 'Нет' }], settings.lastDouble ? 'yes' : 'no', (id) => {
          settings.lastDouble = id === 'yes';
          keep();
        }),
        h('div.k-field', h('span', 'Расчёт')),
        segmented(Object.values(SETTLE).map((id) => ({ id, title: SETTLE_NAMES[id] })), settings.settle, (id) => {
          settings.settle = id;
          settleNote.textContent = SETTLE_NOTES[id];
          keep();
        }),
        settleNote),
      h('div.card',
        label('Особые шары'),
        h('p.muted.small', 'Если договорились, что какой-то шар дороже, — например, «Красный» за 3 очка.'),
        extrasBox,
        h('button.btn.secondary.wide', { type: 'button', onclick: () => {
          settings.extras.push({ name: 'Красный', value: 3 });
          keep();
          showExtras();
        } }, '+ Особый шар')),
      error,
      h('button.btn.primary.wide', { type: 'button', onclick: start }, 'Начать счёт'),
      LESSON >= 0 ? h('a.btn.secondary.wide', { href: `#/lesson/${LESSON}` }, 'Правила колхоза') : null,
      h('a.btn.secondary.wide', { href: '#/game' }, 'Сыграть колхоз на столе в приложении'),
    ];
  }

  // ---------------------------------------------------------------- the score sheet

  function sheetView() {
    const s = session;
    const st = s.settings;
    const pts = s.roundPoints();
    const roundNets = nets(pts, st.settle);
    const totals = s.totals();
    const round = s.rounds.length + 1;
    const act = (fn) => () => {
      if (fn() === false) return;
      buzz();
      save();
      render();
    };

    const head = h('div.card.k-round',
      h('div.k-round-top',
        h('div', label(`Партия ${round}`), h('h2', `Разбивает ${s.players[s.breaker]}`)),
        h('div.k-left', h('b', String(s.remaining)), h('small', `из ${st.balls}`))),
      progressBar(s.scored, st.balls),
      h('p.small.muted', s.roundComplete
        ? 'Все шары забиты — закрой партию.'
        : s.lastBallNext && st.lastDouble ? 'Следующий шар — последний, идёт за два.' : `Осталось ${plural(s.remaining, ['шар', 'шара', 'шаров'])}.`));

    const rows = s.players.map((name, i) => {
      const next = s.players[(i + 1) % s.n];
      return h(`div.card.k-row${i === s.breaker ? '.breaker' : ''}`,
        h('div.k-row-top',
          h('div.grow',
            h('h3', name),
            h('small.muted', st.settle === SETTLE.ring ? `получает с: ${s.players[(i + s.n - 1) % s.n]} · платит: ${next}` : 'расчёт с каждым')),
          h('div.k-pts', h('b', String(pts[i])), h('small', 'очков'))),
        h('div.k-row-net',
          h('span', 'Партия: ', h(`b.${tone(roundNets[i])}`, signed(roundNets[i]))),
          h('span', 'Всего: ', h(`b.${tone(totals[i])}`, signedRub(totals[i] * st.price)))),
        h('div.k-actions',
          s.kinds.map((k, kind) => h(`button.btn.${kind ? 'secondary' : 'primary'}.k-pot`, {
            type: 'button', disabled: s.roundComplete, onclick: act(() => s.pot(i, kind)),
          }, kind ? `${k.name} +${s.valueOf(kind)}` : `Шар +${s.valueOf(0)}`)),
          h('button.btn.secondary.k-foul', { type: 'button', onclick: act(() => s.foul(i)) }, `Фол −${st.foul}`)));
    });

    const last = s.log.at(-1);
    const undo = h('button.btn.secondary', { type: 'button', disabled: !last, onclick: act(() => Boolean(s.undo())) },
      last ? `Отменить: ${s.players[last.player]} ${last.type === 'foul' ? 'фол' : `+${last.value}`}` : 'Отменить');
    const close = h(`button.btn.${s.roundComplete ? 'primary' : 'secondary'}`, {
      type: 'button', disabled: !s.log.length,
      onclick: confirmTwice(s.roundComplete ? null : 'Шары ещё есть. Закрыть?', act(() => Boolean(s.endRound()))),
    }, s.roundComplete ? 'Следующая партия' : 'Закрыть партию');

    return [
      h('div.topbar', h('span.label', 'Колхоз'), h('span.muted', `${rub(st.price)} за очко · ${SETTLE_NAMES[st.settle].toLowerCase()}`)),
      head,
      ...rows,
      h('div.buttons.k-bar', undo, close),
      s.rounds.length && !s.log.length ? h('button.btn.secondary.wide', { type: 'button', onclick: act(() => s.reopenRound()) }, 'Вернуть прошлую партию') : null,
      summaryCard(s),
      historyCard(s),
      h('button.btn.secondary.wide.k-danger', {
        type: 'button',
        onclick: confirmTwice('Счёт удалится. Точно?', () => {
          session = null;
          save();
          render();
        }),
      }, 'Новый колхоз'),
    ];
  }

  function summaryCard(s) {
    const totals = s.totals();
    const order = s.players.map((_, i) => i).sort((a, b) => totals[b] - totals[a] || a - b);
    const pay = s.settlement();
    const text = () => s.report();
    const played = s.allRounds().length;
    return h('div.card',
      label(`Итог · ${plural(played, ROUNDS)}`),
      h('div.k-table',
        h('div.k-tr.k-th', h('span', 'Игрок'), h('span', 'Очки'), h('span', '₽')),
        order.map((i) => h('div.k-tr',
          h('span', s.players[i]),
          h(`span.${tone(totals[i])}`, signed(totals[i])),
          h(`span.${tone(totals[i])}`, signedRub(totals[i] * s.settings.price))))),
      label('Кто кому платит'),
      pay.length
        ? h('ul.k-pay', pay.map((t) => h('li', h('b', s.players[t.from]), ' → ', h('b', s.players[t.to]), h('span.gold', rub(t.amount)))))
        : h('p.muted', 'Пока все в нуле.'),
      h('div.buttons',
        navigator.share ? h('button.btn.primary', { type: 'button', onclick: () => navigator.share({ title: 'Колхоз', text: text(), url: APP_URL }).catch(() => {}) }, 'Поделиться') : null,
        h('a.btn.secondary', { href: `https://t.me/share/url?url=${encodeURIComponent(APP_URL)}&text=${encodeURIComponent(text())}`, target: '_blank', rel: 'noopener' }, 'Telegram'),
        h('a.btn.secondary', { href: `https://wa.me/?text=${encodeURIComponent(text() + '\n' + APP_URL)}`, target: '_blank', rel: 'noopener' }, 'WhatsApp')),
      copyButton(text));
  }

  function historyCard(s) {
    if (!s.rounds.length) return null;
    const cols = { gridTemplateColumns: `28px repeat(${s.n}, minmax(0, 1fr))` };
    return h('div.card',
      label('Сыгранные партии'),
      h('div.k-table.k-history',
        h('div.k-tr.k-th', { style: cols }, h('span', '№'), s.players.map((p) => h('span', p))),
        s.rounds.map((r, k) => {
          const n = nets(r.points, s.settings.settle);
          return h('div.k-tr', { style: cols }, h('span', String(k + 1)), r.points.map((p, i) => h('span', `${p} `, h(`small.${tone(n[i])}`, `(${signed(n[i])})`))));
        })));
  }

  render();
  return root;
}

function loadSession() {
  const saved = store.savedKolkhoz();
  if (!saved) return null;
  try {
    return KolkhozSession.fromJSON(saved);
  } catch {
    return null;
  }
}

const tone = (v) => (v > 0 ? 'ok' : v < 0 ? 'bad' : 'muted');

/** A button action that asks for a second tap first (WebView has no confirm dialog). */
function confirmTwice(question, action) {
  if (!question) return action;
  let armed = 0;
  return (e) => {
    const btn = e.currentTarget;
    if (Date.now() - armed < 3000) return action(e);
    armed = Date.now();
    const text = btn.textContent;
    btn.textContent = question;
    setTimeout(() => {
      if (btn.isConnected) btn.textContent = text;
    }, 3000);
  };
}

function copyButton(text) {
  const btn = h('button.btn.secondary.wide', { type: 'button' }, 'Скопировать итог');
  btn.addEventListener('click', async () => {
    const value = text();
    let ok = false;
    try {
      await navigator.clipboard.writeText(value);
      ok = true;
    } catch {
      // older WebViews: copy through a hidden text field
      const area = h('textarea', { style: { position: 'fixed', opacity: '0' } }, value);
      document.body.append(area);
      area.select();
      ok = document.execCommand('copy');
      area.remove();
    }
    btn.textContent = ok ? 'Скопировано ✓' : 'Не удалось скопировать';
    setTimeout(() => (btn.textContent = 'Скопировать итог'), 2000);
  });
  return btn;
}
