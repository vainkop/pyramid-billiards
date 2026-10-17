import { LESSONS, QUIZ, technique } from '../content.js';
import { DRILLS, drillById } from '../drills.js';
import { TableView, DEMO } from '../table-view.js';
import { SpinPad } from '../spin-pad.js';
import { store } from '../store.js';
import { h } from '../dom.js';
import { label, icon, spinIcon, backBar, progressBar, drillStars, plural } from '../ui.js';

const QUESTIONS = ['вопрос', 'вопроса', 'вопросов'];

export function lessonsScreen(scope) {
  const done = LESSONS.filter((_, i) => store.lessonDone(i)).length;
  const totalStars = DRILLS.reduce((s, d) => s + drillStars(d), 0);
  const stats = store.stats();
  const wins = Object.values(stats.wins).reduce((a, b) => a + b, 0);
  const stat = (big, small) => h('div.stat', h('b', big), h('span', small));

  return h('section.page',
    h('header.hero',
      h('div.hero-top',
        h('div', label('Русский бильярд'), h('h1', 'Пирамида'), h('p.hero-sub', 'школа удара и игра')),
        spinIcon(scope, { ox: 0, oy: 0.62 }, 80)),
      h('p', 'Научись управлять битком — накат, оттяжка, винт, свояк — и проверь технику в партии «американки».'),
      h('div.stats',
        stat(`${done}/${LESSONS.length}`, 'уроков'),
        stat(`${totalStars}/${DRILLS.length * 3}`, 'звёзд'),
        stat(String(wins), 'побед'),
        stat(String(stats.svoyak), 'свояков')),
      progressBar(done, LESSONS.length),
      h('div.buttons',
        h('a.btn.primary', { href: '#/game' }, 'Играть партию'),
        h('a.btn.secondary', { href: '#/practice' }, 'Тренироваться'))),
    label('Курс'),
    h('div.list', LESSONS.map((l, i) => h('a.row-card', { href: `#/lesson/${i}` },
      l.hit ? spinIcon(scope, l.hit) : h('span.num', String(i + 1)),
      h('div.grow', h('small', `Урок ${i + 1}`), h('h3', l.title), h('p', l.subtitle)),
      store.lessonDone(i) ? icon('check', '.ok') : icon('chevron', '.muted')))),
    h('a.row-card.quiz-link', { href: '#/quiz' },
      icon('quiz', '.gold'),
      h('div.grow', h('h3', 'Тест по технике'), h('p', `${plural(QUIZ.length, QUESTIONS)} · лучший результат ${store.quizBest()}`)),
      icon('chevron', '.muted')));
}

export function lessonScreen(scope, i) {
  const l = LESSONS[i];
  if (!l) return null;
  store.markLesson(i);
  const page = h('section.page',
    backBar(`Урок ${i + 1} из ${LESSONS.length}`, 'lessons'),
    h('h1', l.title),
    h('p.lead', l.subtitle));

  if (l.hit) {
    const name = h('h2.gold', l.interactive ? 'Клапштос' : l.title);
    const desc = h('p.muted', l.hitText);
    const size = l.interactive ? 150 : 104;
    const canvas = h('canvas.spin-pad', { style: { width: `${size}px`, height: `${size}px` } });
    const pad = scope.keep(new SpinPad(canvas, {
      interactive: l.interactive,
      onChange: (ox, oy) => {
        const t = technique(ox, oy);
        name.textContent = t.name;
        desc.textContent = t.desc;
      },
    }));
    pad.set(l.hit.ox, l.hit.oy, l.hit.elev ?? 0);
    page.append(h('div.card.hit', canvas, h('div.grow', label('Точка удара'), name, desc)));
  }

  page.append(h('div.card', label('Суть'), h('p', l.essence)));

  if (l.drill) {
    const d = drillById(l.drill);
    const canvas = h('canvas.demo');
    const table = scope.keep(new TableView(canvas, { mode: DEMO }));
    table.setPhysics(d.setup(), d);
    table.playDemo(900);
    const t = technique(d.solution.ox, d.solution.oy, d.solution.elev);
    page.append(h('div.card',
      label('Демонстрация'),
      canvas,
      h('p.muted.small', `Удар: ${t.name.toLowerCase()}, сила ${Math.round(d.solution.power * 100)}%.`
        + (d.hasZone ? ' Пунктирный круг — куда должен прийти биток.' : '')),
      h('div.buttons',
        h('button.btn.secondary', { onclick: () => table.playDemo(300) }, '▶ Показать'),
        h('a.btn.primary', { href: `#/drill/${d.id}` }, 'Попробовать сам'))));
  }

  page.append(h('div.card', label(l.stepsTitle), h('ol.steps', l.steps.map((s) => h('li', s)))));
  page.append(h('div.card', label(l.mistakesTitle),
    h(`ul.${l.glossary ? 'glossary' : 'mistakes'}`, l.mistakes.map((m) => h('li', m)))));
  if (l.strategy) page.append(h('div.card', label('Стратегия'), h('ul.strategy', l.strategy.map((m) => h('li', m)))));
  page.append(h('div.card.tip', label('Совет тренера'), h('p', l.tip)));
  if (l.cta) page.append(h('a.btn.primary.wide', { href: l.cta.href }, l.cta.text));
  if (i + 1 < LESSONS.length) {
    page.append(h(`a.btn.${l.cta ? 'secondary' : 'primary'}.wide`, { href: `#/lesson/${i + 1}` }, `Дальше: ${LESSONS[i + 1].title} →`));
  }
  return page;
}
