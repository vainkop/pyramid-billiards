import { lessonsScreen, lessonScreen } from './screens/lessons.js';
import { practiceScreen, playScreen, drillScreen } from './screens/practice.js';
import { gameScreen } from './screens/game.js';
import { quizScreen } from './screens/quiz.js';
import { kolkhozScreen } from './screens/kolkhoz.js';
import { Scope, icon } from './ui.js';
import { h } from './dom.js';
import { initTelegram, telegramReady } from './telegram.js';

const view = document.getElementById('view');
const nav = document.getElementById('nav');

const TABS = [
  { route: 'lessons', label: 'Уроки', icon: 'lessons' },
  { route: 'practice', label: 'Практика', icon: 'drills' },
  { route: 'game', label: 'Игра', icon: 'game' },
  { route: 'kolkhoz', label: 'Колхоз', icon: 'kolkhoz' },
  { route: 'quiz', label: 'Тест', icon: 'quiz' },
];

/** route → [screen(scope, arg), tab it belongs to] */
const ROUTES = {
  lessons: [lessonsScreen, 'lessons'],
  lesson: [(s, i) => lessonScreen(s, Number(i)), 'lessons'],
  practice: [practiceScreen, 'practice'],
  trainer: [(s) => playScreen(s, null), 'practice'],
  drill: [drillScreen, 'practice'],
  game: [gameScreen, 'game'],
  kolkhoz: [kolkhozScreen, 'kolkhoz'],
  quiz: [(s) => quizScreen(s, render), 'quiz'],
};

let scope = new Scope();

function render() {
  const [name = 'lessons', arg] = location.hash.replace(/^#\/?/, '').split('/');
  let [screen, tab] = ROUTES[name] ?? ROUTES.lessons;
  scope.destroy();
  scope = new Scope();
  let el = screen(scope, arg);
  if (!el) [el, tab] = [lessonsScreen(scope), 'lessons'];
  view.replaceChildren(el);
  view.scrollTop = 0;
  for (const a of nav.querySelectorAll('a')) a.classList.toggle('active', a.dataset.route === tab);
}

nav.replaceChildren(...TABS.map((t) => h('a', { href: `#/${t.route}`, 'data-route': t.route }, icon(t.icon), t.label)));
initTelegram(view);
window.addEventListener('hashchange', render);
render();
telegramReady();

// Offline support on the web; the Android app serves the files itself.
if ('serviceWorker' in navigator && location.hostname.endsWith('github.io')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
