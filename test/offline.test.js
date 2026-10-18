import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

test('the service worker caches every source file, so the web app works offline', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const files = readdirSync(new URL('../src', import.meta.url), { recursive: true })
    .filter((f) => f.endsWith('.js'))
    .map((f) => `src/${f.replaceAll('\\', '/')}`);
  for (const f of files) assert.ok(sw.includes(`'${f}'`), `${f} is missing from SHELL in sw.js`);
});
