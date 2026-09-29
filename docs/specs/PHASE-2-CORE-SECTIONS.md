# Спецификация: Фаза 2 — Основные секции (v0.2.0)

## Цель

Реализовать GUI для наиболее востребованных секций: Outputs, Input, Binds, Layout, Window/Layer Rules, Animations, Startup/Environment.

После этой фазы пользователь может настроить 80–90% типичного конфига без raw-редактора.

---

## Веха 2.1 — Outputs + Layout

### Outputs

**UI**
- Canvas с прямоугольниками мониторов (масштаб, позиция, rotation).
- Drag-and-drop для расположения.
- Боковая панель свойств выбранного output:
  - name / match (connector или manufacturer model serial)
  - off
  - mode (dropdown из `niri msg outputs` + custom)
  - scale (number, 0.1–10)
  - transform (normal/90/180/270/flipped-*)
  - position x/y
  - variable-refresh-rate (+ on-demand)
  - focus-at-startup
  - background-color / backdrop-color
  - hot-corners
  - max-bpc
  - per-output `layout {}` override

**Данные**
- Live: `niri msg outputs` → список реальных выходов + available modes.
- Если niri не запущен — показывать только то, что есть в конфиге + предупреждение.

**Валидация**
- mode должен существовать (или custom с предупреждением).
- scale в допустимом диапазоне.
- Нет перекрытий позиций (warning, не error).

### Layout

**Полный редактор `layout {}`:**
- gaps (number / fractional)
- center-focused-column (`never` | `always` | `on-overflow`)
- always-center-single-column
- empty-workspace-above-first
- default-column-display
- background-color
- preset-column-widths / default-column-width
- preset-window-heights
- focus-ring (on/off, width, colors, gradients)
- border (аналогично)
- shadow (softness, spread, offset, color, draw-behind-window)
- tab-indicator (position, colors, gaps, corner-radius и т.д.)
- struts
- insert-hint (если есть в актуальной версии niri)

**Preview**
- Упрощённый визуальный preview колонок/окон (не обязательно pixel-perfect).

### Критерии
- Можно полностью настроить multi-monitor layout мышкой.
- Layout-секция покрыта на 100% актуальной документации niri.

---

## Веха 2.2 — Input + Binds

### Input

Полное покрытие:
- `keyboard.xkb` (layout, variant, options, model, rules, file)
- repeat-delay / repeat-rate
- track-layout (`global` | `window`)
- numlock
- touchpad / mouse / trackpoint / trackball / tablet / touch:
  - off, natural-scroll, accel-speed, accel-profile
  - scroll-method, scroll-button, left-handed
  - tap, dwt, dwtp, drag, middle-emulation и т.д.
- focus-follows-mouse (+ max-scroll-amount)
- warp-mouse-to-focus
- mod-key
- workspace-auto-back-and-forth (если актуально)

**XKB Helper**
- Dropdown популярных layout/variant.
- Возможность указать произвольную строку.
- Ссылка на `xkeyboard-config(7)`.

### Binds

**UI**
1. Таблица биндов (hotkey → action) с поиском и фильтрами.
2. Добавление / редактирование / удаление.
3. Conflict detection (один hotkey → несколько actions → error/warning).
4. Action picker (категоризированный каталог всех actions niri).
5. Поддержка:
   - обычные key binds
   - WheelScroll*
   - MouseLeft/Right/Middle/Forward/Back
   - cooldown-ms
   - allow-when-locked / allow-inhibiting (если есть)
   - overlay titles

**KeyHeatmap**
- Визуальная клавиатура.
- Подсветка занятых клавиш.
- Клик → показать/редактировать бинд.
- Фильтр по модификаторам.

**Каталог actions**
- Статический список (из документации niri) + возможность spawn / spawn-sh.
- Группировка: focus, move, workspace, window, column, spawn, screenshot, quit и т.д.

### Критерии
- Можно найти и исправить конфликтующий бинд за < 10 секунд.
- Heatmap отражает реальные бинды.
- Все типы биндов niri поддерживаются.

---

## Веха 2.3 — Rules + Animations + Startup

### Window Rules / Layer Rules

**RuleBuilder**
- Список правил (drag-and-drop для изменения порядка — order matters!).
- Для каждого:
  - match / exclude (title, app-id, is-active, is-focused, is-floating, at-startup, namespace для layer и т.д.)
  - свойства: open-*, default-*-width/height, min/max size, border, focus-ring, shadow, geometry-corner-radius, clip-to-geometry, opacity, block-out-from и т.д.
- Preview matching (опционально через live windows из IPC).

### Animations

- Global: off, slowdown.
- Per-animation секции (window-open, window-close, horizontal-view-movement, workspace-switch, ...).
- Тип: easing (cubic-bezier) или spring.
- CurveEditor:
  - Визуальный редактор bezier (4 точки).
  - Spring parameters (damping, stiffness, epsilon...).
  - Live preview анимации (canvas или CSS).
- Пресеты.

### Startup & Environment

- Список `spawn-at-startup` / `spawn-sh-at-startup` (editable list, drag reorder).
- Environment key-value editor (с поддержкой `null` для unset).
- cursor { theme, size, hide-when-typing, hide-after-inactive-ms }
- screenshot-path
- prefer-no-csd
- blur (если актуально)

### Критерии
- Можно создать сложный window-rule без знания KDL.
- Анимации настраиваются визуально.
- Автозапуск и env полностью покрыты.

---

## Общие требования к Фазе 2

- Все изменения идут через Zustand + history.
- Schema validation в реальном времени.
- Перед save — полный `niri validate`.
- Multi-file: изменение output пишется в тот файл, где он был объявлен.
- i18n-ready (строки через i18n keys, даже если пока только ru/en заглушки).
- Accessibility: keyboard navigation в основных формах.

## Критерии готовности v0.2.0

- [ ] Outputs + Layout + Input + Binds + Rules + Animations + Startup работают end-to-end.
- [ ] Пользователь может мигрировать с текстового конфига на GUI для этих секций.
- [ ] Нет потери данных при round-trip.
- [ ] Тесты на schema + несколько integration-сценариев.
