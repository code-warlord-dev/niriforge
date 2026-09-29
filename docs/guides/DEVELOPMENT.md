# Руководство разработчика NiriForge

## Требования

- Rust (stable, через rustup)
- Node.js 20+ + pnpm
- Linux + Wayland (для полного тестирования)
- niri (для validate и IPC)
- Системные зависимости Tauri (webkit2gtk и т.д. — см. tauri docs)

## Быстрый старт

```bash
git clone <repo>
cd niriforge
pnpm install
pnpm tauri dev
```

## Структура команд

```bash
# Frontend
pnpm dev          # только Vite
pnpm build
pnpm lint
pnpm typecheck
pnpm test

# Backend
cd src-tauri
cargo check
cargo test
cargo clippy

# Полный
pnpm tauri dev
pnpm tauri build
```

## Соглашения

### Naming

- Rust: snake_case, типы PascalCase.
- TypeScript: camelCase, типы/компоненты PascalCase.
- Файлы компонентов: PascalCase.tsx.
- Stores: `useXxxStore`.

### Errors

- Rust: `thiserror` для domain errors, `anyhow` только на границах.
- Все команды возвращают `Result<T, AppError>`.
- Frontend показывает ошибку через toast + Validation panel.

### Commits

- Conventional Commits предпочтительно (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`).
- Один логический change = один commit.

### PR

- Связан с issue / вехой.
- CI должен быть зелёным.
- Для schema/KDL — обязательны тесты round-trip.

## Добавление новой секции niri

1. Обновить `schema` (Rust + TS types + Zod).
2. Добавить serializer/parser mapping в kdl engine.
3. Создать page + компоненты.
4. Подключить в router / sidebar.
5. Написать тесты.
6. Обновить документацию.

## Тестирование KDL

Кладём реальные конфиги в `testdata/`:
- `default.kdl`
- `multi-file/`
- `noctalia-style/`
- `with-comments.kdl`
- `unknown-blocks.kdl`

Каждый должен проходить load → save → load без семантических потерь.

## Полезные команды niri

```bash
niri validate
niri msg outputs
niri msg windows
niri msg workspaces
niri msg layers
niri msg version
```

## Design system

See [docs/design-reference/DESIGN-SYSTEM.md](../design-reference/DESIGN-SYSTEM.md) for tokens, typography, and UX feedback rules. **No demo-data UI.**
