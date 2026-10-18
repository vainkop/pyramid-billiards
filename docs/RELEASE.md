# Выпуск версии

Веб (GitHub Pages, в том числе Telegram) обновляется сам после `git push` в `main`. APK собирается
и ставится на телефон из Termux.

1. **Версии.** Любое изменение файлов приложения — увеличить `VERSION` в `sw.js` (иначе веб-клиенты и
   Telegram останутся на старом кэше). Новый файл в `src/` — добавить его в `SHELL` в `sw.js`
   (`test/offline.test.js` упадёт, если забыть). Для APK — `version` в `package.json`
   (из него `versionName` и номер в имени файла).
2. **Тесты.** `npm test` — физика, упражнения, правила, ИИ, колхоз, прицел, офлайн-кэш.
   `npm run check:telegram` — страница в браузере и в эмуляции Telegram (см. [TELEGRAM.md](TELEGRAM.md)).
3. **Раскладка на экране телефона.** Узкое место — нижняя панель игры: проверять при ширине
   **384 px** (Galaxy S24 Ultra), а не только 412. Headless Chromium в Termux (`chromium-browser`) с
   `Emulation.setDeviceMetricsOverride` и **новым профилем** каждый раз — иначе service worker отдаёт
   старые файлы. Пример — `tools/telegram-check.mjs`.
4. **APK.**
   ```sh
   npm run android
   cp android/build/pyramid.apk "/storage/emulated/0/Download/apks/Pyramid - Russian billiards school & game vX.Y.Z.apk"
   termux-open "/storage/emulated/0/Download/apks/Pyramid - Russian billiards school & game vX.Y.Z.apk"
   ```
   Пользователь нажимает «Обновить» и **возвращается в Termux**. Ждать установку — по смене `pm path com.kiy.pyramid`.
5. **Самопроверка на телефоне** (только пока Termux на экране; у Termux должно быть разрешение
   «Поверх других приложений», иначе Android 14+ не даёт ему запускать приложения):
   ```sh
   am start -S -n com.kiy.pyramid/.MainActivity --ez selftest true
   ```
   Приложение проходит уроки, практику, тренажёр, тест, обе игры, колхоз с хапугой и счёт колхоза и пишет
   отчёт в `Download/pyramid-selftest-<время>.txt`: в конце должно быть `NO ERRORS`, в строке
   «колхоз later» — `dock fits: true` и размер экрана. Код — `installSelfTest` / `runSelfTest` в
   `android/src/com/kiy/pyramid/MainActivity.java`.
6. **Коммит и push** в `main`; сборку Pages проверить: `gh api repos/vainkop/pyramid-billiards/pages/builds/latest`.
