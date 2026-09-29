# Спецификация: Фаза 3 — Advanced + UX (v0.3.0)

## Цель

Полное покрытие всех секций niri + advanced UX: live IPC, profiles, search, raw-sync, heatmap polish, i18n.

---

## Секции, которые нужно закрыть

### Gestures
- hot-corners (top-left / top-right / ... + off)
- dnd-edge-view-scroll
- dnd-edge-workspace-switch
- другие актуальные на момент реализации

### Overview
- zoom
- backdrop-color
- workspace-shadow

### Recent Windows
- debounce-ms, open-delay-ms, highlight, previews и т.д.

### Switch Events
- lid-close / lid-open
- tablet-mode-on / tablet-mode-off
- действия (spawn, spawn-sh и т.д.)

### Named Workspaces
- имя
- open-on-output
- layout overrides

### Debug
- Все debug-флаги из актуальной документации (preview-render, disable-direct-scanout, honor-xdg-activation-... и т.д.)
- Только для advanced пользователей (отдельная страница с предупреждением)

### Misc (оставшееся)
- xwayland-satellite
- clipboard
- hotkey-overlay
- config-notification
- blur (если не вошло в 2.3)

---

## Live IPC

**Требования**
- Команды `niri msg`:
  - outputs
  - windows
  - workspaces
  - layers
  - focused-window
  - version
- Периодический refresh или event-driven (если socket доступен).
- Использование:
  - Реальные имена мониторов и modes в Outputs.
  - Подсветка matching window-rule на живых окнах.
  - Статус "niri running / not running".
  - Возможность "Apply & Reload" (если niri поддерживает).

**Ограничения**
- Если niri не запущен — все live-фичи деградируют gracefully.

---

## Profiles

- Named snapshot текущего конфига (или выбранных файлов).
- Список профилей с preview / comment / date.
- Apply profile = restore + optional validate + reload.
- Экспорт / импорт профиля (zip или директория).

Хранение: `$XDG_DATA_HOME/niriforge/profiles/<name>/`

---

## Global Search

- Поиск по:
  - ключам конфигурации
  - значениям
  - комментариям (если сохранены)
  - actions в binds
- Результат — кликабельный, открывает нужную страницу + подсвечивает поле.

---

## Diff View

- Перед save (опционально, настраиваемо) показывать unified diff или side-by-side.
- Особенно полезно при multi-file.

---

## Raw KDL Editor

- Monaco / CodeMirror с:
  - syntax highlighting для KDL
  - diagnostics из schema + niri validate
  - format (если возможно)
- Двусторонняя синхронизация:
  - Изменения в GUI → обновляют raw (если raw открыт).
  - Изменения в raw → после "Apply from raw" парсятся в модель.
- Режим "только raw" для power-users.

---

## KeyHeatmap (polish)

- Точная раскладка (поддержка разных layout).
- Цветовая кодировка по типу action.
- Tooltip с полным биндом.
- Фильтры (только Mod, только window actions и т.д.).

---

## i18n и темы (полировка)

- Полный охват **всех** страниц ключами ru + en (parity в CI).
- Темы System/Dark/Light: контраст, focus, canvas/heatmap/editor в обоих режимах.
- Документация пользователя: ru в приоритете; en по возможности.
- Другие языки — **не** в scope до 1.0.0.

---

## Критерии готовности v0.3.0

- [ ] Все секции niri из wiki покрыты.
- [ ] Live IPC работает при запущенном niri.
- [ ] Profiles + Search + Diff + Raw sync реализованы.
- [ ] i18n ru/en.
- [ ] Нет регрессий по safety из Фазы 1–2.
