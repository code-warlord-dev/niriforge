# Дорожная карта NiriForge

## Общая стратегия

1. Сначала **ядро** (KDL + safety + schema + Zustand).
2. Потом **критичные секции** (Outputs, Input, Binds, Layout).
3. Затем полный охват + advanced UX.
4. В конце packaging, polish, 1.0.

Каждая веха заканчивается работающим, тестируемым инкрементом.

---

## Фаза 0 — Подготовка (1–2 недели)

**Цель:** репозиторий, инструменты и соглашения.

- [x] Архитектура и документация (этот пакет).
- [x] Scaffold Tauri 2 + React + Vite + TypeScript + Tailwind + shadcn.
- [x] CI (GitHub Actions): build, lint, test.
- [x] Соглашения: naming, error handling, commit style.
- [x] Выбор crates (`kdl`, `schemars`, `notify`, `thiserror` и т.д.).
- [x] Базовый `Config` skeleton (все секции как `Option` / `Vec`).
- [x] Зафиксировать стек i18n + theming (i18next, class-based dark mode, settings store).

**Результат:** можно клонировать и запускать пустой shell.

---

## Фаза 0.1 — UI Shell Polish (P0)

**Цель:** выровнять UI shell под DESIGN-SYSTEM: палитра, density, header, toasts, empty state — без demo данных.

- [x] Токены: DESIGN-SYSTEM.md → src/index.css (dark-first: `#0f1115`, `#161922`, `#1e222d`, `#2e3444`, Inter + JetBrains Mono, 13px)
- [x] Toasts: ToastContainer + uiStore.addToast (success `#10b981`, warning `#f59e0b`, danger `#ef4444`)
- [x] Header: path + dirty dot + Validate + Save (Validate активна, toast error от stub)
- [x] EmptyState: кнопка Browse… → Tauri dialog
- [x] Убрать дубль title «NiriForge» в Sidebar

**Критерий готовности:**
- `pnpm tauri dev` → окно: цвета/типографика/density shell по DESIGN-SYSTEM
- Toasts: Validate/Save/Load показывают цветные тосты
- Header: path + dirty + Validate + Save
- CI зелёный (typecheck, build, cargo check, clippy, tauri build)

---

## Фаза 1 — Core Engine (v0.1.0)

**Цель:** надёжная загрузка/сохранение/валидация + минимальный UI.

### Веха 1.1 — KDL Engine
- Парсер + serializer на `kdl` crate.
- Include resolver (глубина, cycles, optional includes).
- Source-map (node → file + span).
- Сохранение комментариев и неизвестных блоков (максимально возможно).
- Round-trip тесты на реальных конфигах (в т.ч. CachyOS/Noctalia style).

### Веха 1.2 — FS & Safety
- Resolve symlink.
- Atomic write (tmp + fsync + rename).
- Backup manager (timestamped + named + rotation + metadata).
- File watcher + external change detection.
- `niri validate` wrapper с маппингом ошибок.

### Веха 1.3 — Tauri + Zustand foundation
- Все базовые commands: `load_config`, `save_config`, `validate_config`, `list_backups`, `restore_backup`.
- `useConfigStore` + history (undo/redo).
- Минимальный shell: sidebar + content area + toast + validation panel.
- Dirty tracking + confirm on close.
- **App settings foundation:** theme (System / Dark / Light) + locale (ru | en), персистентные настройки приложения.
- i18n каркас (`i18next` / аналог), все строки shell через ключи; файлы `ru` + `en`.
- Tailwind/shadcn semantic tokens, без хардкода цветов.

**Критерий готовности v0.1.0:**
- Можно открыть любой валидный config.kdl (включая multi-file).
- Можно изменить одно поле, сохранить, получить валидный файл.
- Бэкап создаётся автоматически.
- Undo работает.
- Можно переключить тему System/Dark/Light и язык ru/en без перезапуска.

---

## Фаза 2 — Основные секции (v0.2.0)

**Цель:** покрыть 80% реальных нужд пользователей.

### Веха 2.1 — Outputs + Layout
- MonitorCanvas (drag-and-drop position, scale, mode, transform, VRR, hot-corners).
- Интеграция с `niri msg outputs`.
- Полный редактор `layout {}` (gaps, center-*, focus-ring, border, shadow, tab-indicator, presets, struts, background).
- Per-output layout overrides.

### Веха 2.2 — Input + Binds
- Полный `input {}` (keyboard/xkb, repeat, track-layout, touchpad/mouse/trackpoint/tablet/touch, focus-follows-mouse, mod-key и т.д.).
- XKB helper (layout/variant/options).
- Binds: searchable table + conflict detection + action catalog + cooldown + scroll/mouse binds.
- Базовый KeyHeatmap.

### Веха 2.3 — Rules + Animations + Startup
- Window-rule / Layer-rule builder (match/exclude + все свойства).
- Animations: global + per-animation + CurveEditor (easing + spring).
- spawn-at-startup / spawn-sh-at-startup + environment editor.
- cursor, screenshot-path, prefer-no-csd.

**Критерий готовности v0.2.0:**
- Пользователь может полностью настроить мониторы, ввод, бинды, layout, правила окон и анимации без raw-редактора.
- Multi-file работает корректно.
- Валидация и бэкапы стабильны.

---

## Фаза 3 — Advanced + UX (v0.3.0)

**Цель:** полный охват + приятный UX.

- Gestures, overview, recent-windows, switch-events, debug, named workspaces.
- Полноценный live IPC (windows, workspaces, layers).
- Profiles (named snapshots).
- Global search по конфигу.
- Diff view перед save.
- Raw KDL editor с двусторонней синхронизацией.
- Улучшенный KeyHeatmap + visual feedback.
- i18n: полный охват всех страниц (ru + en), parity ключей, проверка в CI.
- Themes: полировка токенов, контраст, focus states под Light/Dark.
- Accessibility базовый уровень.

**Критерий готовности v0.3.0:**
- Все секции niri покрыты.
- Можно работать полностью через GUI или через raw.
- Профили и search работают.
- Весь UI на ключах i18n (ru/en); тема System/Dark/Light стабильна.

---

## Фаза 4 — Packaging & 1.0

**Цель:** стабильный релиз, удобная установка.

- Arch PKGBUILD + AUR.
- AppImage (универсальный).
- Опционально: Flatpak / deb.
- Полная пользовательская документация.
- Набор тестовых конфигов + integration tests.
- Performance pass (большие multi-file).
- Release checklist + changelog.

**Критерий готовности 1.0:**
- Можно установить одной командой на Arch/CachyOS и на других distro через AppImage.
- Документация полная.
- Нет известных блокеров по safety.

---

## Пост-1.0 (идеи)

- Theme editor (интеграция с Noctalia / других shell).
- Import/export профилей.
- Plugin system (если появится реальная потребность).
- Web version (read-only preview) — низкий приоритет.
- Автоматический migration helper при breaking changes niri.

---

## Приоритеты при конфликте сроков

1. Safety и correctness.
2. Multi-file + include.
3. Outputs + Binds + Layout.
4. Остальное.
