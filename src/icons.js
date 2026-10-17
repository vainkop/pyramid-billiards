/** Inline SVG line icons (stroke = currentColor). */
const svg = (body, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

export const ICONS = {
  lessons: svg('<path d="M12 6.5C10 5 6.5 4.8 3 5.6v13c3.5-.8 7-.6 9 .9 2-1.5 5.5-1.7 9-.9v-13c-3.5-.8-7-.6-9 .9z"/><path d="M12 6.5v13"/>'),
  trainer: svg('<circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="7.2" r="1.4" fill="currentColor"/><path d="M15 15l6 6"/>'),
  drills: svg('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.8"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>'),
  quiz: svg('<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 10l2 2 4-4M8 16.5h8"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 'stroke-width="2.4"'),
  chevron: svg('<path d="M9 5l7 7-7 7"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>', 'stroke-width="2.2"'),
  star: svg('<path d="M12 3.5l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6L3.4 9.8l6-.7z" fill="currentColor"/>', 'stroke-width="1.2"'),
  starEmpty: svg('<path d="M12 3.5l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6L3.4 9.8l6-.7z"/>', 'stroke-width="1.4"'),
};

/** Cue and ball: the game tab. */
ICONS.game = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="15.5" cy="8.5" r="4.5"/><circle cx="15.5" cy="8.5" r="1.6" fill="currentColor"/><path d="M3 21l8.5-8.5"/></svg>`;
ICONS.bulb = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.3 1 2.1h5c0-.8.4-1.6 1-2.1A6 6 0 0012 3z"/></svg>`;
ICONS.more = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>`;
