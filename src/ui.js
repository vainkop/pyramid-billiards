import { h } from './dom.js';
import { ICONS } from './icons.js';
import { SpinPad } from './spin-pad.js';
import { stars } from './drills.js';
import { store } from './store.js';

/** Owns a screen's live components (canvases, timers, loops) and tears them down on navigation. */
export class Scope {
  constructor() {
    this.items = [];
  }

  keep(item) {
    this.items.push(item);
    return item;
  }

  /** requestAnimationFrame loop that stops with the scope; fn receives dt in seconds. */
  loop(fn) {
    let last = null;
    let raf = 0;
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      const dt = last === null ? 0 : Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      fn(dt);
    };
    raf = requestAnimationFrame(tick);
    this.keep({ destroy: () => cancelAnimationFrame(raf) });
  }

  timeout(fn, ms) {
    const id = setTimeout(fn, ms);
    this.keep({ destroy: () => clearTimeout(id) });
  }

  destroy() {
    this.items.forEach((i) => i.destroy());
    this.items = [];
    this.dead = true;
  }
}

export const label = (text) => h('div.label', text);
export const icon = (name, cls = '') => h(`span.icon${cls}`, { html: ICONS[name] });

export function starRow(n) {
  return h('span.stars', [0, 1, 2].map((k) => icon(k < n ? 'star' : 'starEmpty', k < n ? '.on' : '')));
}

export function drillStars(d) {
  const r = store.drill(d.id);
  return stars(r.total, r.best);
}

/** Small cue ball showing a hit point. */
export function spinIcon(scope, hit, size = 46) {
  const c = h('canvas.spin-icon', { style: { width: `${size}px`, height: `${size}px` } });
  scope.keep(new SpinPad(c)).set(hit.ox, hit.oy, hit.elev ?? 0);
  return c;
}

export function backBar(caption, route) {
  return h('div.topbar',
    h('a.back', { href: `#/${route}` }, icon('back'), 'Назад'),
    h('span.muted', caption));
}

export function progressBar(value, max) {
  return h('div.progress', h('div', { style: { width: `${(100 * value) / Math.max(1, max)}%` } }));
}

/** Short haptic tick where supported (Android); silently ignored elsewhere. */
export function buzz(ms = 12) {
  navigator.vibrate?.(ms);
}

/**
 * A row of mutually exclusive choices (game, level, penalty…). `options` are
 * { id, title, note }; the chosen one is marked with aria-pressed. Changing the
 * choice updates the buttons in place — nothing else on the page re-renders.
 */
export function segmented(options, current, onPick) {
  const buttons = options.map((o) => h('button.segment', {
    type: 'button',
    'aria-pressed': o.id === current,
    onclick: () => {
      if (o.id === current) return;
      current = o.id;
      for (const [k, b] of buttons.entries()) b.setAttribute('aria-pressed', String(options[k].id === current));
      onPick(o.id);
    },
  }, h('b', o.title), o.note ? h('small', o.note) : null));
  return h('div.segments', buttons);
}

/** Russian plural: plural(22, ['вопрос', 'вопроса', 'вопросов']) → «22 вопроса». */
export function plural(n, [one, few, many]) {
  const d = n % 10;
  const dd = n % 100;
  const word = d === 1 && dd !== 11 ? one : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many;
  return `${n} ${word}`;
}
