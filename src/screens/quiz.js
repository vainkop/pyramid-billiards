import { QUIZ } from '../content.js';
import { store } from '../store.js';
import { h } from '../dom.js';
import { label, progressBar, plural } from '../ui.js';

const quiz = { pos: -1, score: 0, order: [] };

const QUESTIONS = ['вопрос', 'вопроса', 'вопросов'];

export function quizScreen(scope, rerender) {
  const total = QUIZ.length;

  if (quiz.pos < 0) {
    const best = store.quizBest();
    return h('section.page',
      label('Проверь себя'),
      h('h1', 'Тест по технике'),
      h('div.card',
        h('p', `${plural(total, QUESTIONS)} о точке удара, винтах, свояках, правилах «американки» и терминах. После каждого ответа — короткое объяснение.`),
        best ? h('h3.gold', `Лучший результат: ${best} из ${total}`) : null,
        h('button.btn.primary.wide', {
          onclick: () => {
            quiz.order = shuffle([...QUIZ.keys()]);
            quiz.pos = 0;
            quiz.score = 0;
            rerender();
          },
        }, best ? 'Пройти ещё раз' : 'Начать тест')));
  }

  if (quiz.pos >= total) {
    const record = quiz.score > store.quizBest();
    if (record) store.setQuizBest(quiz.score);
    const ratio = quiz.score / total;
    const msg = ratio === 1 ? 'Безупречно! Теория — на уровне мастера.'
      : ratio >= 0.75 ? 'Отлично! Осталось закрепить на столе.'
        : ratio >= 0.5 ? 'Хорошая база. Перечитай уроки, где были ошибки.'
          : 'Начни с уроков — дальше будет проще.';
    return h('section.page.center',
      label('Результат'),
      h('div.score', `${quiz.score} / ${total}`),
      h('p', (record ? 'Новый рекорд! ' : '') + msg),
      h('button.btn.primary.wide', { onclick: () => { quiz.pos = -1; rerender(); } }, 'Пройти ещё раз'),
      h('a.btn.secondary.wide', { href: '#/lessons', onclick: () => { quiz.pos = -1; } }, 'К урокам'));
  }

  const q = QUIZ[quiz.order[quiz.pos]];
  const explain = h('div.card.hidden');
  const next = h('button.btn.primary.wide.hidden', { onclick: () => { quiz.pos++; rerender(); } },
    quiz.pos + 1 < total ? 'Дальше' : 'Результат');
  const options = q.options.map((text, k) => h('button.option', {
    onclick: () => {
      if (!next.classList.contains('hidden')) return;
      const right = k === q.answer;
      if (right) quiz.score++;
      options.forEach((o, j) => o.classList.add(j === q.answer ? 'right' : j === k ? 'wrong' : 'dim'));
      explain.replaceChildren(h(`h3.${right ? 'ok' : 'bad'}`, right ? 'Верно!' : 'Не совсем'), h('p', q.why));
      explain.classList.remove('hidden');
      next.classList.remove('hidden');
    },
  }, text));

  return h('section.page',
    label(`Вопрос ${quiz.pos + 1} из ${total}`),
    progressBar(quiz.pos, total),
    h('h2.question', q.q),
    h('div.options', options),
    explain,
    next);
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
