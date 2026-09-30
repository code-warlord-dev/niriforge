# Архитектура NiriForge

## 1. Обзор

NiriForge — desktop-приложение на Tauri 2, которое редактирует `~/.config/niri/config.kdl` (и все `include`) через типизированную модель, валидацию и безопасную запись.

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (React + Zustand + Tailwind + shadcn)             │
│  ├── pages/                                                 │
│  ├── components/ (MonitorCanvas, KeyHeatmap, CurveEditor)   │
│  ├── stores/ (useConfigStore, useHistoryStore, useUiStore)  │
│  └── hooks/ (useNiriIpc, useValidation, useBackup)          │
└───────────────────────────┬─────────────────────────────────┘
                            │ Tauri invoke / events
┌───────────────────────────▼─────────────────────────────────┐
│  Tauri Backend (Rust)                                       │
│  ├── commands/                                              │
│  ├── kdl/ (parser, serializer, include resolver, mapper)    │
│  ├── schema/ (typed Config + validation)                    │
│  ├── niri/ (ipc client, validate wrapper)                   │
│  ├── fs/ (atomic write, symlink resolve, watch, backup)     │
│  └── profiles/ + history/                                   │
└─────────────────────────────────────────────────────────────┘
                            │
                   ~/.config/niri/*.kdl
                   + niri socket / niri msg
```

## 2. Принципы проектирования

1. **Safety first** — никогда не пишем невалидный конфиг. Всегда `niri validate` (или эквивалент) перед commit.
2. **Typed everything** — единая schema на Rust и TypeScript.
3. **Source of truth** — Zustand-модель. UI только отображает и отправляет команды.
4. **Preserve user intent** — комментарии, formatting, неизвестные блоки сохраняются максимально возможно.
5. **Multi-file first-class** — include резолвятся, изменения пишутся в правильный файл.
6. **Atomic + Backup** — temp → fsync → rename + автоматический бэкап.
7. **Live data** — IPC `niri msg` для реальных outputs/windows/workspaces.
8. **Themes first-class** — System / Dark / Light, без хардкода цветов в компонентах.
9. **i18n first-class** — ru + en до 1.0; остальные языки после 1.0.0. Все UI-строки через ключи, не литералы.
## 3. Слои

### 3.1. Frontend Layer

- **Stores (Zustand)**
  - `useConfigStore` — текущая модель `Config`, dirty, original.
  - `useHistoryStore` — undo/redo (temporal middleware или свой stack).
  - `useUiStore` — sidebar, active page, dialogs, toasts, **theme**, **locale**.
  - `useValidationStore` — ошибки schema + niri validate.
  - `useBackupStore` — список бэкапов, restore.
  - `useSettingsStore` (или часть UiStore) — персистентные настройки приложения (theme, language), отдельно от niri-конфига.

- **Pages** (одна страница = одна большая секция niri или группа):
  - Outputs
  - Input
  - Binds
  - Layout
  - Window Rules / Layer Rules
  - Animations
  - Gestures + Overview + Recent Windows
  - Startup & Environment
  - Workspaces
  - Miscellaneous + Debug
  - Raw Editor
  - Backups & Profiles

- **Ключевые компоненты**
  - `MonitorCanvas` — drag-and-drop раскладка мониторов.
  - `KeyHeatmap` — визуальная карта клавиатуры + конфликты.
  - `CurveEditor` — cubic-bezier / spring с live preview.
  - `RuleBuilder` — match/exclude + свойства.
  - `ActionPicker` — каталог всех actions niri.
  - `KdlEditor` — Monaco/CodeMirror с валидацией.

### 3.2. Tauri Command Layer

Все операции с файловой системой и процессами только через backend:

```rust
#[tauri::command]
async fn load_config(path: Option<PathBuf>) -> Result<ConfigDto, AppError>;

#[tauri::command]
async fn save_config(config: ConfigDto, options: SaveOptions) -> Result<SaveResult, AppError>;

#[tauri::command]
async fn validate_config(config: ConfigDto) -> Result<ValidationResult, AppError>;

#[tauri::command]
async fn list_backups() -> Result<Vec<BackupMeta>, AppError>;

#[tauri::command]
async fn restore_backup(id: String) -> Result<(), AppError>;

#[tauri::command]
async fn niri_msg(args: Vec<String>) -> Result<String, AppError>;

#[tauri::command]
async fn get_outputs() -> Result<Vec<OutputInfo>, AppError>;
// ... и т.д.
```

### 3.3. KDL Engine

- Парсер → AST (`kdl` crate).
- Include resolver (глубина 5–8, cycle detection).
- Source-map: каждый node знает, из какого файла он пришёл.
- Typed `Config` (serde) + `Unknown` ноды для неизвестного.
- Serializer: точечная замена изменённых node, сохранение комментариев и whitespace где возможно.
- При невозможности сохранить formatting — graceful degradation + предупреждение.

### 3.4. Schema & Validation

1. **Static schema** (schemars + Zod) — структура, типы, диапазоны.
2. **Semantic validation** — дубликаты биндов, валидные mode/scale, конфликты.
3. **Authoritative** — `niri validate --config <tmpfile>`.

Ошибки возвращаются с location (file + line/column) и human-readable сообщением.

### 3.5. FS & Safety

- Resolve symlink → реальный путь.
- Atomic write: write to `.tmp` → fsync → rename.
- File watcher (`notify`) → reload при внешних изменениях (с confirm если dirty).
- Backup manager:
  - Автоматический перед каждым save.
  - Named profiles.
  - Ротация (хранить N последних).
  - Metadata (niri version, source files, timestamp, comment).

### 3.6. Niri IPC

- Обёртка над `niri msg` (outputs, windows, workspaces, layers, focused-window и т.д.).
- Опционально — прямой unix socket, если понадобится event stream.
- Используется для:
  - Реальных имён мониторов и доступных mode.
  - Preview текущего состояния.
  - Проверки, запущен ли niri.

## 4. Модель данных (упрощённо)

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub input: Option<InputConfig>,
    pub outputs: Vec<OutputConfig>,
    pub binds: BindsConfig,
    pub layout: Option<LayoutConfig>,
    pub window_rules: Vec<WindowRule>,
    pub layer_rules: Vec<LayerRule>,
    pub animations: Option<AnimationsConfig>,
    pub gestures: Option<GesturesConfig>,
    pub overview: Option<OverviewConfig>,
    pub recent_windows: Option<RecentWindowsConfig>,
    pub workspaces: Vec<NamedWorkspace>,
    pub spawn_at_startup: Vec<SpawnEntry>,
    pub environment: HashMap<String, Option<String>>,
    pub cursor: Option<CursorConfig>,
    // ... misc, debug, switch_events
    pub unknown: Vec<KdlNode>,          // неизвестные top-level
    pub includes: Vec<IncludeEntry>,    // исходные include
}
```

TypeScript-зеркало **генерируется** из Rust-типов (`schemars` → `json2ts`, команда
`pnpm gen:types`) и проверяется тестом на каждом запуске. Форма и правила — в
[CONTRACT.md](CONTRACT.md).

## 5. Потоки данных

### Load
1. Resolve main config path (`$XDG_CONFIG_HOME/niri/config.kdl` или override).
2. Parse + resolve includes → AST + source-map.
3. AST → typed `Config`.
4. Отдать во frontend + сохранить original.

### Edit
1. UI вызывает `setSection` / `updateRule` и т.д.
2. Zustand обновляет model + помечает dirty + пушит в history.
3. (Опционально) live schema validation.

### Save
1. Config → AST (с учётом source-map).
2. Для каждого изменённого файла: atomic write во временный.
3. `niri validate` на временных файлах.
4. Если OK → rename + создать backup + clear dirty.
5. Если fail → вернуть ошибки, временные файлы удалить.

### External change
1. File watcher срабатывает.
2. Если dirty → показать диалог «Конфиг изменён снаружи. Перезагрузить?».
3. Если не dirty → silent reload.

## 6. Обработка ошибок

- Все ошибки — `AppError` в форме `{ type, details }`: `type` — машинный
  дискриминант, `details` — человеческий текст. Форма и её разбор во frontend —
  в [CONTRACT.md](CONTRACT.md).
- Frontend показывает toast + детали в Validation panel.
- Критические (не удалось прочитать конфиг) — блокируют UI до выбора действия.

## 7. Темы (System / Dark / Light)

**Требование продукта:** три режима — **System**, **Dark**, **Light**.

### Реализация

- CSS variables / Tailwind dark mode (`class` strategy).
- shadcn/ui theming tokens (background, foreground, muted, border, primary, destructive, …).
- Режим **System**: следовать `prefers-color-scheme` (и обновлять при смене ОС).
- Режим **Dark** / **Light**: принудительный class на `document.documentElement` (`dark` / без `dark` или `light`).
- Выбор темы хранится в **настройках приложения** (не в niri config), например:
  - `$XDG_CONFIG_HOME/niriforge/settings.json` или Tauri store / local preference via backend.
- Переключение без перезапуска приложения.
- Компоненты **не** хардкодят цвета (`bg-white`, `#fff`) — только semantic tokens.

### UI

- Пункт в настройках приложения / header: Theme = System | Dark | Light.
- Иконки (sun/moon/monitor) допустимы.

## 8. Интернационализация (i18n)

**До 1.0.0:** только **Русский** и **Английский**.  
**После 1.0.0:** остальные языки по запросу (не блокируют 1.0).

### Реализация

- Библиотека: `i18next` + `react-i18next` (или аналог с тем же контрактом).
- Все пользовательские строки — через ключи (`t('binds.conflict.title')`), **не** литералы в JSX.
- Файлы локалей: `src/locales/ru/*.json`, `src/locales/en/*.json` (или единый namespace).
- Язык по умолчанию: системный locale, если ru/en; иначе English. Пользователь может переопределить.
- Выбор языка персистентен (тот же settings store, что и theme).
- Форматы дат/чисел — через locale API при необходимости.
- Ошибки от backend (`AppError.message`) либо коды ошибок + локализация на фронте, либо уже локализованные строки (предпочтительно коды + `t('errors.xxx')`).

### Процесс

- Новый UI-текст → ключ в ru + en одновременно (в одном PR).
- CI может проверять parity ключей ru/en (script).
- Документация пользователя: ru в приоритете до 1.0; en параллельно по возможности.

## 9. Расширяемость

- Новые секции niri добавляются в schema + page + serializer.
- Плагины не планируются в v1 (избыточно).
- Новые языки после 1.0 — добавление locale-файлов без смены архитектуры.

## 10. Нефункциональные требования

- Время загрузки типичного multi-file конфига < 300 ms.
- Save (включая validate) < 800 ms.
- UI остаётся отзывчивым (тяжёлые операции в async commands).
- Поддержка больших конфигов (сотни window-rule).
- Работает без запущенного niri (save + validate возможны, live IPC — нет).
- Смена темы и языка — мгновенно, без reload окна.
