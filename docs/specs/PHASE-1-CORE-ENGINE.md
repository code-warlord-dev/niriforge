# Спецификация: Фаза 1 — Core Engine (v0.1.0)

## Цель

Реализовать надёжный движок загрузки, редактирования модели, валидации и безопасного сохранения конфигурации niri. UI на этом этапе — минимальный shell.

## Веха 1.1 — KDL Engine

### Требования

1. Парсинг `config.kdl` + всех `include` (относительные, абсолютные, `~/`, optional).
2. Обнаружение циклов и ограничение глубины (по умолчанию 8).
3. Построение source-map: каждый значимый node знает файл и span.
4. Преобразование AST → typed `Config` (с `Unknown` для нераспознанного).
5. Обратное: `Config` + source-map → обновлённые файлы.
6. Максимально возможное сохранение комментариев и форматирования.
7. Поддержка `/-` commented-out nodes (не трогаем).

### API (Rust)

```rust
pub struct KdlDocument {
    pub root: KdlNode,
    pub source_map: SourceMap,
    pub includes: Vec<IncludeInfo>,
}

pub fn parse_config(main_path: &Path) -> Result<KdlDocument, KdlError>;
pub fn to_config(doc: &KdlDocument) -> Result<Config, SchemaError>;
pub fn apply_config(doc: &mut KdlDocument, config: &Config) -> Result<Vec<PathBuf>, ApplyError>; // изменённые файлы
pub fn serialize_file(doc: &KdlDocument, path: &Path) -> Result<String, SerializeError>;
```

### Тесты

- Round-trip на default-config.kdl niri.
- Multi-file с 3–4 include (в т.ч. CachyOS-style `cfg/`).
- Конфиг с большим количеством комментариев.
- Неизвестный top-level block сохраняется.
- Optional include, которого нет — не ошибка.

### Критерии приёмки

- Любой валидный конфиг пользователя открывается без потери данных.
- После load → save без изменений diff минимален (или нулевой по смыслу).

---

## Веха 1.2 — FS & Safety

### Требования

1. Resolve symlink до реального файла перед записью.
2. Atomic write:
   - Пишем во временный файл в той же директории.
   - fsync.
   - rename (atomic на Linux).
3. Backup manager:
   - Путь: `$XDG_DATA_HOME/niriforge/backups/` или `~/.local/share/niriforge/backups/`.
   - Автоматический бэкап перед каждым успешным save.
   - Named backup (пользователь может дать имя).
   - Metadata.json: timestamp, files, niri version (если доступна), comment, hash.
   - Ротация: хранить последние N (настраиваемо, default 20).
4. File watcher на main + все included файлы.
5. При внешнем изменении:
   - Если !dirty → silent reload.
   - Если dirty → диалог с выбором (reload / keep / diff).
6. `niri validate`:
   - Запуск `niri validate --config <path>` (или через stdin, если поддерживается).
   - Парсинг stdout/stderr в структурированные ошибки (file, line, message).

### API

```rust
pub struct BackupManager { ... }
impl BackupManager {
    pub fn create_auto(&self, files: &[PathBuf]) -> Result<BackupId, BackupError>;
    pub fn create_named(&self, name: &str, files: &[PathBuf], comment: Option<&str>) -> Result<BackupId, BackupError>;
    pub fn list(&self) -> Result<Vec<BackupMeta>, BackupError>;
    pub fn restore(&self, id: &BackupId) -> Result<(), BackupError>;
    pub fn prune(&self, keep: usize) -> Result<(), BackupError>;
}

pub fn atomic_write(path: &Path, content: &str) -> Result<(), FsError>;
pub fn resolve_symlink(path: &Path) -> Result<PathBuf, FsError>;
pub fn run_niri_validate(path: &Path) -> Result<ValidationResult, ValidateError>;
```

### Критерии приёмки

- Невозможно получить half-written файл.
- Бэкап всегда создаётся перед изменением реальных файлов.
- `niri validate` ошибки показываются пользователю с location.

---

## Веха 1.3 — Tauri Commands + Zustand

### Commands

| Command | Описание |
|---------|----------|
| `load_config` | path? → ConfigDto + meta |
| `save_config` | ConfigDto + SaveOptions → SaveResult |
| `validate_config` | ConfigDto → ValidationResult |
| `list_backups` | → Vec<BackupMeta> |
| `restore_backup` | id → () |
| `get_config_path` | → PathBuf |
| `check_niri_running` | → bool |
| `niri_msg` | args: Vec<String> → String |

### Zustand

```ts
interface ConfigState {
  config: Config | null;
  original: Config | null;
  meta: ConfigMeta | null; // paths, includes, niri version
  dirty: boolean;
  loading: boolean;
  error: AppError | null;

  load: (path?: string) => Promise<void>;
  save: (opts?: SaveOptions) => Promise<void>;
  setSection: <K extends keyof Config>(key: K, value: Config[K]) => void;
  update: (recipe: (draft: Config) => void) => void; // immer-style
  reset: () => void;
  // history через temporal или отдельный store
}
```

### UI (минимальный)

- Sidebar с пунктами (пока заглушки, кроме Overview/Status).
- Header: путь к конфигу, dirty indicator, Save / Validate / Undo / Redo.
- Validation panel (bottom или side).
- Toast notifications.
- Confirm dialogs (close with dirty, external change).

### Темы и i18n (в рамках 1.3)

- App settings store: `theme: system|dark|light`, `locale: ru|en`.
- Tailwind class-based dark mode + shadcn tokens.
- i18next (или аналог): все строки shell через ключи; locale files ru + en.
- Переключение темы и языка без reload.

### Критерии приёмки v0.1.0

- [ ] Открывается любой валидный multi-file конфиг.
- [ ] Можно изменить одно простое поле (например, `layout.gaps`), сохранить.
- [ ] После save файл валиден (`niri validate` OK).
- [ ] Автобэкап создан.
- [ ] Undo/Redo работает на уровне модели.
- [ ] При падении `niri validate` изменения не применяются.
- [ ] External change детектится.
- [ ] Theme System/Dark/Light переключается и персистится.
- [ ] Locale ru/en переключается; shell-строки не захардкожены.

## Зависимости между вехами

1.1 → 1.2 → 1.3 (последовательно).  
Параллельно можно готовить UI-компоненты-заглушки.
