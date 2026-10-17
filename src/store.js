/** Progress, settings and the game in progress, kept in localStorage (guarded: it may be unavailable). */
const PREFIX = 'pyramid:';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    if (value === undefined) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* progress just won't persist */
  }
}

export const store = {
  lessonDone: (i) => read(`lesson:${i}`, false),
  markLesson: (i) => write(`lesson:${i}`, true),

  drill: (id) => read(`drill:${id}`, { total: 0, streak: 0, best: 0 }),
  /** @returns the updated record */
  recordDrill(id, ok) {
    const r = this.drill(id);
    r.streak = ok ? r.streak + 1 : 0;
    if (ok) {
      r.total += 1;
      r.best = Math.max(r.best, r.streak);
    }
    write(`drill:${id}`, r);
    return r;
  },

  quizBest: () => read('quiz:best', 0),
  setQuizBest: (n) => write('quiz:best', n),

  /** The game in progress: { match, level } or null. */
  savedGame: () => read('game', null),
  saveGame: (game) => write('game', game ?? undefined),

  /** Results against the computer per level, plus the player's shot-making totals. */
  stats: () => read('stats', { wins: {}, losses: {}, svoyak: 0, potted: 0, games: 0 }),
  recordGame({ level, won, svoyak, potted }) {
    const s = this.stats();
    s.games += 1;
    s.svoyak += svoyak;
    s.potted += potted;
    if (level) {
      const bucket = won ? s.wins : s.losses;
      bucket[level] = (bucket[level] ?? 0) + 1;
    }
    write('stats', s);
    return s;
  },

  setting: (key, fallback) => read(`setting:${key}`, fallback),
  setSetting: (key, value) => write(`setting:${key}`, value),
};
