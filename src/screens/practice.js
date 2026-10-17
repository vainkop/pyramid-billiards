import { DRILLS, drillById } from '../drills.js';
import { Physics } from '../physics.js';
import { TableView, TRAINER, DRILL } from '../table-view.js';
import { ShotControls, playLayout } from '../shot-controls.js';
import { technique } from '../content.js';
import { store } from '../store.js';
import { h } from '../dom.js';
import { label, icon, starRow, drillStars, spinIcon } from '../ui.js';

export function practiceScreen(scope) {
  const groups = new Map();
  for (const d of DRILLS) groups.set(d.group, [...(groups.get(d.group) ?? []), d]);
  return h('section.page',
    label('Практика'),
    h('h1', 'Упражнения'),
    h('a.row-card.feature', { href: '#/trainer' },
      spinIcon(scope, { ox: 0.4, oy: -0.5 }, 52),
      h('div.grow', h('h3', 'Свободный тренажёр'), h('p', 'Расставь шары сам и смотри, как точка удара меняет путь битка.')),
      icon('chevron', '.muted')),
    h('p.muted', '★ — выполнить хотя бы раз · ★★ — три раза · ★★★ — три подряд'),
    [...groups].map(([group, drills]) => [
      label(group),
      h('div.list', drills.map((d) => h('a.row-card', { href: `#/drill/${d.id}` },
        spinIcon(scope, { ox: d.solution.ox, oy: d.solution.oy }, 44),
        h('div.grow', h('h3', d.title), h('p.clamp', d.goal)),
        starRow(drillStars(d))))),
    ]));
}

function trainerLayout() {
  const p = new Physics(3);
  p.place(0, 0.5, 1.55);
  p.place(1, 0.42, 1.0);
  p.place(2, 0.72, 0.55);
  return p;
}

/** Trainer (drill = null) or a drill. */
export function playScreen(scope, drill) {
  const trainer = !drill;
  const headBtn = h('button.btn.secondary.small', trainer ? 'Сброс' : 'Решение');
  const status = h('h3.status');
  const detail = h('p.status-detail');
  const extraBtn = h('button.btn.secondary.small', trainer ? '↺ Позиция' : 'Заново');
  let starsEl = trainer ? null : starRow(drillStars(drill));

  const canvas = h('canvas.table');
  const table = scope.keep(new TableView(canvas, { mode: trainer ? TRAINER : DRILL, onShotDone: shotDone }));
  table.setPhysics(trainer ? trainerLayout() : drill.setup(), drill);
  const controls = new ShotControls(scope, {
    elevation: trainer || drill.usesElevation,
    onChange: refresh,
    onShoot: shoot,
    // after an attempt, starting the next pull puts the drill back in place
    onPullStart: () => { if (needsReset && !table.busy) resetDrill(); },
  });

  let saved = null; // trainer: table before the last shot
  let demo = false; // drill: the current shot is the solution being shown
  let needsReset = false;

  function refresh(values = controls.values) {
    table.setParams(values);
    if (controls.strip.power > 0) return setStatus(`Сила ${Math.round(values.power * 100)}%`, `${controls.technique.name}. Отпусти — удар, верни наверх — отмена.`);
    const t = controls.technique;
    setStatus(t.name, t.desc);
  }

  function setStatus(text, more, tone = '') {
    status.textContent = text;
    status.className = `status ${tone}`;
    detail.textContent = more;
  }

  function resetDrill() {
    table.setPhysics(drill.setup(), drill);
    needsReset = false;
    controls.locked = false;
    refresh();
  }

  function shoot() {
    if (table.busy) return;
    saved = table.phys.copy();
    demo = false;
    if (table.shoot()) {
      controls.locked = true;
      setStatus('Удар!', 'Коснись стола, чтобы сразу увидеть результат.');
    }
  }

  function shotDone(p, miscue) {
    controls.locked = false;
    if (trainer) {
      if (miscue) setStatus('Кикс!', 'Наклейка соскочила: бей ближе к центру битка.', 'bad');
      else setStatus(outcome(p), '«↺ Позиция» — повторить удар с того же места.');
      if (!p.on[0]) {
        p.place(0, 0.5, 1.55); // the cue ball returns to the house spot
        table.invalidate();
      }
      return;
    }
    needsReset = true;
    if (demo) {
      demo = false;
      setStatus('Так выглядит решение', 'Теперь попробуй сам — потяни кий.');
      return;
    }
    const err = miscue ? 'Кикс! Наклейка соскочила — бей ближе к центру битка.' : drill.check(p);
    const rec = store.recordDrill(drill.id, err === null);
    if (err === null) {
      setStatus('Отлично! Задание выполнено ✓',
        rec.streak > 1 ? `Серия: ${rec.streak} подряд. Так держать!`
          : rec.best >= 3 ? 'Засчитано!' : 'Засчитано! Три попадания подряд — и будет ★★★.', 'ok');
    } else {
      setStatus('Почти! Попробуй ещё', err, 'bad');
    }
    const fresh = starRow(drillStars(drill));
    starsEl.replaceWith(fresh);
    starsEl = fresh;
  }

  extraBtn.addEventListener('click', () => {
    if (table.busy) return;
    if (!trainer) return resetDrill();
    if (!saved) return;
    const aim = table.aim;
    table.setPhysics(saved.copy());
    table.aim = aim;
    refresh();
  });
  headBtn.addEventListener('click', async () => {
    if (table.busy) return;
    if (trainer) {
      table.setPhysics(trainerLayout());
      saved = null;
      return refresh();
    }
    table.setPhysics(drill.setup(), drill);
    controls.set(drill.solution);
    table.aim = drill.solutionAim(table.phys);
    table.invalidate();
    const { power, ox, oy, elev } = drill.solution;
    setStatus('Решение', `${technique(ox, oy, elev).name}, сила ${Math.round(power * 100)}%.`);
    demo = true;
    needsReset = false;
    controls.locked = true;
    await controls.stroke(power, 900);
    table.shoot({ allowMiscue: false });
  });

  refresh();
  return playLayout({
    head: h('div.play-head',
      h('a.back.icon-only', { href: '#/practice', 'aria-label': 'Назад' }, icon('back')),
      h('div.grow', label(trainer ? 'Тренажёр' : drill.group), h('h2', trainer ? 'Свободная практика' : drill.title)),
      starsEl,
      headBtn),
    goal: h('p.goal', trainer ? 'Тяни шары пальцем, касайся стола для прицела. Пунктир — прогноз удара.' : drill.goal),
    canvas,
    controls,
    status,
    detail,
    actions: [
      h('button.btn.secondary.small.square', { 'aria-label': 'Прицел левее', onclick: () => table.nudgeAim(-0.001) }, '◀'),
      h('button.btn.secondary.small.square', { 'aria-label': 'Прицел правее', onclick: () => table.nudgeAim(0.001) }, '▶'),
      extraBtn,
    ],
  });
}

export const drillScreen = (scope, id) => (drillById(id) ? playScreen(scope, drillById(id)) : null);

function outcome(p) {
  const objects = p.potted.filter((b) => b !== 0).length;
  const cue = p.potted.includes(0);
  if (p.firstHit < 0) return 'Мимо шаров';
  if (objects && cue) return 'Шар забит + свояк!';
  if (objects) return objects === 1 ? 'Шар забит!' : `Забито шаров: ${objects}`;
  return cue ? 'Свояк!' : 'Шар не забит';
}
