# Контракт между бэкендом и фронтендом

Документ описывает форму, в которой данные переходят через `invoke`. Он не
выводится из кода автоматически: автоматически выводится *проверка* того, что код
ему соответствует.

## Правило одно: имена полей — kebab-case

Любое поле, которое пересекает границу, пишется так же, как niri пишет его в
`config.kdl`: `window-rules`, `spawn-at-startup`, `recent-windows`,
`prefer-no-csd`. Ни `camelCase`, ни `snake_case` на проводе не встречаются.

Причина не в стиле. `src-tauri/src/kdl/mapping.rs` берёт имена полей из самих
структур через serde и по ним узнаёт, какие узлы KDL уже разобраны, а какие
неизвестны. Поле, пришедшее в интерфейс как `window_rules`, нельзя сопоставить
обратно с узлом `window-rules`, из которого оно взято: движок начал бы считать
собственный вывод непонятым. Правило, которое держится на serde, —
`#[serde(rename_all = "kebab-case")]` на каждой структуре контракта.

Следствие для TypeScript: поля читаются в квадратных скобках.

```ts
config["window-rules"];
meta["main-path"];
```

Это неудобно и это осознанно: имя, которое видит разработчик интерфейса, совпадает
с именем в конфиге пользователя и в документации niri, поэтому по нему можно
искать.

Правило проверяется тестом, а не договорённостью:
`src-tauri/tests/contract.rs::every_field_on_the_wire_is_kebab_case` обходит
схему и падает на первом поле не в kebab-case.

## Обязательность поля

Поле необязательно на проводе тогда и только тогда, когда в Rust оно `Option` либо
имеет `#[serde(default)]`. Схема строится из тех же структур, поэтому список
обязательных полей на TypeScript тоже генерируется, а не поддерживается руками.

Исключение одно, и оно единственное: `ValidationIssue` в `src/types/config.ts` —
это `ValidationError` плюс поле `id`. Идентификатор строки в панели валидации
нужен интерфейсу, бэкенду о нём знать нечего, поэтому его нет в схеме.

## Как типы связаны и почему не разъедутся

```
src-tauri/src/schema/mod.rs   ─┐
src-tauri/src/commands.rs     ─┼─→ schemars → schema/contract.schema.json
src-tauri/src/error.rs        ─┘         │
                                          ↓  json2ts
                            src/types/generated/contract.ts
                                          ↓
                            src/types/config.ts  (реэкспорт + ValidationIssue)
```

Порядок такой:

1. `commands::Contract` — корень схемы, в котором назван весь тип, способный
   дойти до интерфейса. Типа нет в `Contract` — нет его и в схеме.
2. `cargo run --example export_contract` печатает схему в
   `src-tauri/schema/contract.schema.json`.
3. `json2ts` превращает схему в `src/types/generated/contract.ts`.
4. `pnpm gen:types` делает и то и другое.

Что мешает разъехаться:

| Что может случиться | Что это поймает |
|---|---|
| Поле переименовали в Rust, `pnpm gen:types` не запустили | `contract::committed_schema_matches_the_rust_types` — `cargo test` падает |
| Схему поправили руками | тот же тест |
| Сгенерированный TS поправили руками | `pnpm check:contract` в CI: регенерация и `git diff --exit-code` |
| Команду зарегистрировали, но интерфейс о ней не знает (или наоборот) | `contract::the_frontend_calls_only_commands_the_backend_registers` — обе стороны обязаны совпадать |
| ФFrontend вызвал команду, которой нет | `CommandName` в `src/lib/ipc.ts`: имя не из списка не компилируется |

Два рукописных файла, которые нужно синхронизировать руками, здесь не
используются: рукописный остаётся только `src/lib/ipc.ts`, и он проверяется
тестом, а не генерируется.

## Формы на проводе

### `ConfigDto` — `{ config, meta }`

Конфиг целиком и то, что о нём известно. `Config` — ровно та структура, которую
движок KDL уже умеет читать и писать; фронтенд не имеет своей модели конфига.

### `ConfigMeta` — `main-path`, `included-files`, `niri-version`

`included-files` — все файлы, участвовавшие в загрузке, включая основной, в
порядке загрузки. Метки времени изменения файла здесь нет: её знает файловый
слой, а не загрузка конфига, и она нигде в интерфейсе не читается.

### `SaveOptions` — `create-backup`, `backup-name`, `validate`

Все три необязательны, и все три по умолчанию — безопасные: бэкап берётся,
невалидный конфиг не пишется. Пропущенное поле — это решение, поэтому решение
приходится произносить: кто хочет иначе, говорит иначе. `validate-only` из
прежней TS-формы не существует: команда, которая только проверяет, — это
`validate_config`.

### `SaveResult` — `success`, `backup-id`, `modified-files`

Неудачное сохранение — это `Err(AppError)`, а не `success: false`. Частичного
исхода не бывает, и вызывающий, который проигнорировал ошибку, всё равно видит,
что на диске не то, что он просил. Поэтому `success` в успешном ответе всегда
`true`, а список `errors`, который был в TS-форме, убран: ошибки приходят одним
способом, а не двумя.

### `ValidationResult` — `valid`, `errors`, `warnings`

Два списка, а не один `issues`, потому что панель валидации рисует их по-разному
и считает по отдельности.

### `ValidationError` — `file`, `line`, `column`, `message`, `code`

Определение одно, в `src-tauri/src/error.rs`: его заполняет слой валидации и его
рисует интерфейс. Два определения с одним именем и разной формой означали бы, что
одно из них неверно.

`id` и `section`, которые были в TS-форме, на проводе не нужны: `id` — свойство
интерфейса (см. выше), а `section` интерфейс и так знает из того, какую секцию
открыли.

### `AppError` — `{ type, details }`

Форма adjacently tagged: `type` — вид отказа, `details` — что именно случилось.

Отдельного поля `code` нет намеренно. `type` уже машинно-читаемый
дискриминант, и он компилируемо проверяем: список тегов в `src/lib/ipc.ts`
объявлен как `Record<AppError["type"], true>`, поэтому новая вариация в Rust не
даст собраться фронтенду, пока в ней не разберутся. Второе поле с тем же
содержанием — это вторая вещь, которая может разъехаться.

`details` разный по типу у разных вариаций, поэтому во
`src/types/generated/contract.ts` `AppError` — это объединение, и
`describeAppError` в `src/lib/ipc.ts` разбирает его через `switch`. Новый
вариант без обработки — ошибка компиляции.

`SchemaError` и `ApplyError` из `kdl/mapping.rs` — внутренние типы движка, они не
сериализуются и в контракт не входят. На проводе их представляет `AppError`:
`ApplyError::At` сейчас схлопывается в `SchemaValidation(String)`, и это
известная потеря — строка с местом ошибки до интерфейса доходит только как
текст. Действующий `KdlLocation` на границу не выведен, см. «Что дальше» в
`CHANGELOG.md`.

## Команды

`src/lib/ipc.ts` — единственное место, откуда frontend зовёт бэкенд.

| Команда | Аргументы | Ответ |
|---|---|---|
| `load_config` | `path` | `ConfigDto` |
| `save_config` | `config`, `options` | `SaveResult` |
| `validate_config` | `config` | `ValidationResult` |
| `list_backups` | — | `BackupMeta[]` |
| `restore_backup` | `id` | `null` |
| `create_backup` | `name`, `comment` | `BackupMeta` |
| `delete_backup` | `id` | `null` |
| `get_config_path` | — | `string` |
| `check_niri_running` | — | `boolean` |
| `niri_msg` | `args` | `string` |
| `get_outputs` | — | `OutputInfo[]` |
| `greet` | `name` | `string` |

`get_config_path`, `check_niri_running`, `niri_msg` и `get_outputs`
зарегистрированы, но интерфейс их пока не зовёт: они нужны экранам, которые
ещё не написаны. Список команд и список регистраций обязаны совпадать, поэтому
интерфейс знает о них, просто не использует. `greet` — шаблон Tauri, его
следует удалить вместе с шаблонными файлами.

## Пути на проводе

Пути сериализуются строками, как отдаёт `serde` для `PathBuf`: `main-path`,
`included-files`, `modified-files`, `files` в `BackupMeta`. Разбор пути — дело
бэкенда; интерфейс показывает путь как есть.

## Что менять, когда меняется форма

1. Правка Rust: `src-tauri/src/schema/mod.rs`, `src-tauri/src/commands.rs`,
   `src-tauri/src/error.rs`. Тип, который должен быть виден интерфейсу, обязан
   появиться в `commands::Contract`.
2. `pnpm gen:types`.
3. Правка потребителей: `src/stores/`, `src/App.tsx`,
   `src/components/validation/`.
4. `pnpm check:contract`, `pnpm typecheck`, `pnpm lint`, `cargo test`,
   `cargo clippy -- -D warnings`.
