# Пирамида в Telegram (Mini App)

Приложение открывается прямо в Telegram из бота: это та же страница с GitHub Pages
(`https://vainkop.github.io/pyramid-billiards/`), показанная Telegram во весь экран. Сервер не нужен:
всё хранится на устройстве, данные пользователя Telegram приложению не нужны.

## Настройка бота (@BotFather)

Сделано один раз, повторять не нужно — записано на случай нового бота.

1. `/newbot` — создать бота. **Токен никому не передавать и не коммитить**: кто знает токен, управляет ботом.
   Для Mini App токен приложению не нужен.
2. *Bot Settings → Mini Apps → Main App*: адрес `https://vainkop.github.io/pyramid-billiards`, режим **full screen**.
   В профиле бота появляется кнопка «Launch app», ссылка на приложение — `https://t.me/<бот>?startapp`
   (`&mode=compact` — на полэкрана).
3. Кнопка меню рядом с полем ввода: в новом интерфейсе BotFather её нет — командой в чате с BotFather:
   `/setmenubutton` → бот → адрес `https://vainkop.github.io/pyramid-billiards/` → название `Играть`.
   Без BotFather — методом Bot API `setChatMenuButton`
   (`{"menu_button":{"type":"web_app","text":"Играть","web_app":{"url":"…"}}}`).
4. По желанию: *Bot Settings → Configure Mini App → Loading screen* — значок и цвет экрана загрузки
   (фон приложения `#0c1310`).

Изменения в коде попадают в Telegram сами после `git push` (GitHub Pages). Если Telegram показывает
старую версию — закрыть приложение полностью и открыть снова (новую версию подтягивает service worker,
`VERSION` в `sw.js`).

## Как устроено

| Где | Что |
|---|---|
| `index.html` | маленький встроенный скрипт: подключает `https://telegram.org/js/telegram-web-app.js`, **только если** страницу открыл Telegram — в хэше адреса есть параметры `tgWebApp…` или Telegram уже сохранил их в `sessionStorage` (`__telegram__initParams`, после перезагрузки). В браузере, в APK и без интернета ничего лишнего не грузится |
| `src/telegram.js` | всё, что делается внутри Telegram; вне Telegram `tg === null`, и функции ничего не делают |
| `styles.css` | класс `tg` на `<html>`: отступы `--safe-top` / `--safe-bottom` из переменных Telegram; `tg-back` прячет «Назад» на странице |
| `src/store.js` | после каждой записи — событие `pyramid:stored` (для копии в DeviceStorage) |
| `src/ui.js` | `buzz()` — вибрация Telegram (`HapticFeedback`), иначе `navigator.vibrate` |
| `sw.js` | `src/telegram.js` в списке офлайн-кэша (тест `test/offline.test.js` проверяет, что там все файлы `src/`) |

Что делает `src/telegram.js` (по рекомендациям Telegram, Bot API 6.1–9.x; каждый вызов — только если версия
клиента его поддерживает, `isVersionAtLeast`):

- **Маршрут**: Telegram открывает страницу с `#tgWebAppData=…` — хэш заменяется на `#/lessons` до первой отрисовки.
- **Отступы (full screen)**: сверху — вырез экрана (`safeAreaInset`) **плюс** кнопки Telegram Close / ⋯
  (`contentSafeAreaInset`), снизу так же; CSS-переменные `--tg-safe-area-inset-*` и
  `--tg-content-safe-area-inset-*` выставляет сам скрипт Telegram и обновляет при повороте и смене режима.
  `max()` с `env(safe-area-inset-*)` — чтобы не сложить вырез дважды.
- **Свайп**: `disableVerticalSwipes()` — свайп вниз не сворачивает приложение (кий тянут вниз).
  Закрыть можно кнопкой Close или свайпом по шапке.
- **Кнопка «Назад» Telegram**: видна, когда на экране есть ссылка «Назад» (`a.back`), и нажимает её;
  своя «Назад» на странице при этом скрыта. Следит `MutationObserver` за `#view`.
- **`ready()`** — после первой отрисовки, чтобы Telegram убрал экран загрузки уже над готовым экраном.
- **Цвета**: шапка, фон и нижняя панель — `#0c1310`, как у приложения (тёмная тема своя, не тема Telegram).
- **Ориентация**: `lockOrientation()` — стол рассчитан на портрет.
- **Ссылки наружу** (например «Telegram» в счёте колхоза): `t.me/…` — `openTelegramLink`, остальные — `openLink`,
  а не внутри окна Mini App.
- **Вибрация**: `HapticFeedback.impactOccurred` — работает и на iPhone, где `navigator.vibrate` нет.
- **Копия прогресса**: WebView может очистить `localStorage` (iPhone, мало памяти). Через секунду после
  изменения и при уходе в фон все ключи `pyramid:*` одной строкой пишутся в `DeviceStorage` (ключ `pyramid`,
  до 5 МБ на пользователя и бота); если при запуске `localStorage` пуст — оттуда восстанавливаются.

Чего нет и не нужно: проверки `initData` на сервере (нужна только тому, кто доверяет данным пользователя —
рейтинги, деньги; токен бота нельзя держать в GitHub Pages), `CloudStorage` (синхронизация между
устройствами — можно добавить без сервера), MainButton (у приложения свои кнопки).

## Проверка

```sh
npm run check:telegram            # headless Chromium: обычная страница и эмуляция Telegram (Android)
node tools/telegram-check.mjs out # то же + скриншоты web-game.png и telegram-game.png в out/
```

Скрипт поднимает свой сервер, открывает страницу как в браузере (не должно быть запросов к telegram.org)
и как её открывает Android-клиент Telegram: параметры запуска в хэше, мост `TelegramWebviewProxy`
(записывает вызовы приложения), события `safe_area_changed`, `content_safe_area_changed`,
`back_button_pressed`. Проверяет режим, очистку маршрута, `ready()`, отключение свайпа, отступ 36 + 48 px,
кнопку «Назад», копию в DeviceStorage и отсутствие ошибок. Размер экрана — 384 × 749 при 2.8125
(Galaxy S24 Ultra, измерено самопроверкой APK).

На телефоне: открыть бота → «Играть»; таблица и счёт не под кнопками Telegram и не под строкой состояния,
кий тянется вниз без закрытия приложения, в уроке стрелка ← вверху возвращает к списку.
