import { test } from 'node:test';
import assert from 'node:assert/strict';
import { technique, LESSONS, QUIZ } from '../src/content.js';
import { drillById } from '../src/drills.js';

test('technique names follow the hit point', () => {
  assert.equal(technique(0, 0).name, 'Клапштос');
  assert.equal(technique(0, -0.3).name, 'Клапштос'); // stop shot from a distance: slightly low
  assert.equal(technique(0, 0.6).name, 'Сильный накат');
  assert.equal(technique(0, -0.6).name, 'Оттяжка');
  assert.equal(technique(0, -0.9).name, 'Сильная оттяжка');
  assert.equal(technique(0.6, 0).name, 'Боковой винт');
  assert.equal(technique(-0.9, -0.2, 0.9).name, 'Массе');
  assert.match(technique(0, 0.99).desc, /кикс/i);
});

test('every lesson demo points at an existing drill', () => {
  for (const l of LESSONS) if (l.drill) assert.ok(drillById(l.drill), l.title);
});

test('quiz answers are valid option indexes', () => {
  for (const q of QUIZ) assert.ok(q.answer >= 0 && q.answer < q.options.length, q.q);
});
