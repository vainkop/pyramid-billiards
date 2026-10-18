/**
 * Telegram Mini App support. index.html loads Telegram's script only when the
 * page was opened from Telegram, so on the plain web and in the Android app
 * `tg` is null and nothing here does anything.
 *
 * Inside Telegram (opened full screen from the bot): the page keeps clear of
 * the phone's notch and of Telegram's own Close / ⋯ buttons, a swipe down no
 * longer closes the app (the cue is pulled down), Telegram's Back button
 * stands in for the page's «Назад», links open through Telegram and taps give
 * Telegram's haptic feedback.
 */

import { PREFIX } from './store.js';

const BG = '#0c1310';
/** DeviceStorage key holding a copy of everything the app keeps in localStorage. */
const BACKUP = 'pyramid';

const webApp = globalThis.Telegram?.WebApp;
// the script also loads outside Telegram (e.g. a reload after the session ended): then its platform is 'unknown'
export const tg = webApp && webApp.platform !== 'unknown' ? webApp : null;

const at = (version) => Boolean(tg?.isVersionAtLeast?.(version));

/** Sets the app up inside Telegram; call before the first render. */
export function initTelegram(view) {
  if (!tg) return;
  document.documentElement.classList.add('tg');
  // Telegram's launch parameters arrive in the hash, where the routes live
  if (/^#?tgWebApp/.test(location.hash)) history.replaceState(null, '', `${location.pathname}${location.search}#/lessons`);
  tg.expand();
  if (at('6.1')) {
    tg.setHeaderColor(BG);
    tg.setBackgroundColor(BG);
  }
  if (at('7.10')) tg.setBottomBarColor(BG);
  if (at('7.7')) tg.disableVerticalSwipes();
  if (at('8.0')) tg.lockOrientation();
  if (at('6.1')) {
    document.documentElement.classList.add('tg-back');
    // Telegram's Back button: shown whenever the screen has its own «Назад» link, and follows it
    const back = () => view.querySelector('a.back');
    tg.BackButton.onClick(() => back()?.click());
    const sync = () => (back() ? tg.BackButton.show() : tg.BackButton.hide());
    new MutationObserver(sync).observe(view, { childList: true, subtree: true });
    sync();
  }
  if (at('9.0')) keepBackup();
  // links out of the app: through Telegram, not inside the Mini App's own window
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a || e.defaultPrevented) return;
    const url = new URL(a.href, location.href);
    if (url.origin === location.origin || !/^https?:$/.test(url.protocol)) return;
    e.preventDefault();
    if (url.hostname === 't.me' && at('6.1')) tg.openTelegramLink(url.href);
    else tg.openLink(url.href);
  });
}

/** Hides Telegram's loading screen: call once the first screen is on the page. */
export function telegramReady() {
  tg?.ready();
}

/**
 * Progress lives in localStorage, which a WebView may clear (iPhone, low storage).
 * Telegram's DeviceStorage keeps data per bot on the device: a copy of all of it
 * is written there a moment after each change and when the app goes to the
 * background, and brought back when localStorage turns up empty.
 */
function keepBackup() {
  const own = () => Object.keys(localStorage).filter((k) => k.startsWith(PREFIX));
  let timer = 0;
  const save = () => {
    clearTimeout(timer);
    timer = 0;
    const data = {};
    for (const k of own()) data[k] = localStorage.getItem(k);
    tg.DeviceStorage.setItem(BACKUP, JSON.stringify(data), () => {});
  };
  try {
    if (!own().length) {
      tg.DeviceStorage.getItem(BACKUP, (error, value) => {
        if (error || !value || own().length) return;
        for (const [k, v] of Object.entries(JSON.parse(value))) localStorage.setItem(k, v);
        window.dispatchEvent(new HashChangeEvent('hashchange')); // draw the screen again with the progress back
      });
    }
  } catch {
    return; // no localStorage: nothing to back up
  }
  window.addEventListener('pyramid:stored', () => {
    if (!timer) timer = setTimeout(save, 1000);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && timer) save();
  });
}

/** Telegram's haptic feedback for a tap; false when not in Telegram (or too old for it). */
export function haptic(ms) {
  if (!at('6.1')) return false;
  tg.HapticFeedback.impactOccurred(ms >= 20 ? 'medium' : 'light');
  return true;
}
