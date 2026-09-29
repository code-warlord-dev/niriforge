# Спецификация: Фаза 0 — Подготовка

## Цель

Создать рабочий скелет проекта, соглашения и CI. После этой фазы любой разработчик может клонировать репозиторий и начинать реализацию Фазы 1.

## Deliverables

1. Репозиторий с правильной структурой.
2. Tauri 2 + React + Vite + TypeScript + Tailwind + shadcn scaffold.
3. CI (lint, typecheck, unit tests, build).
4. Соглашения: naming, error handling, commit style.
5. Базовый `Config` skeleton (Rust + TS).
6. CONTRIBUTING.md, CODE_OF_CONDUCT (опционально), LICENSE (MIT).
7. Этот набор документации.

## Структура репозитория (целевая)

```
niriforge/
├── .github/workflows/
├── docs/
│   ├── ARCHITECTURE.md
│   ├── ROADMAP.md
│   ├── VERSIONING.md
│   ├── specs/
│   └── guides/
├── src/                     # Frontend
│   ├── components/
│   ├── pages/
│   ├── stores/
│   ├── hooks/
│   ├── types/
│   ├── lib/
│   └── App.tsx
├── src-tauri/               # Backend
│   ├── src/
│   │   ├── main.rs
│   │   ├── commands/
│   │   ├── kdl/
│   │   ├── schema/
│   │   ├── niri/
│   │   ├── fs/
│   │   └── error.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── public/
├── package.json
├── pnpm-lock.yaml
├── tailwind.config.js
├── tsconfig.json
├── README.md
├── LICENSE
└── CONTRIBUTING.md
```

## Технические решения (зафиксировать в Фазе 0)

| Область | Выбор | Примечание |
|---------|-------|----------|
| Package manager | pnpm | |
| UI kit | shadcn/ui + Tailwind | |
| State | Zustand + temporal (или свой history) | |
| Forms | react-hook-form + Zod | |
| Editor | Monaco (предпочтительно) или CodeMirror 6 | |
| DnD | @dnd-kit | |
| Rust error | thiserror + anyhow | |
| KDL | `kdl` crate | |
| Schema | schemars (Rust) + Zod (TS) | |
| Logging | tracing (Rust) + console (TS) | |

## Задачи

- [ ] `pnpm create tauri-app` (или manual scaffold) с React-TS.
- [ ] Настроить Tailwind + shadcn.
- [ ] Добавить Zustand, Zod, react-hook-form, dnd-kit, monaco.
- [ ] Создать `src/types/config.ts` (скелет).
- [ ] Создать `src-tauri/src/schema/mod.rs` (скелет).
- [ ] Настроить ESLint + Prettier + rustfmt + clippy.
- [ ] GitHub Actions: `ci.yml` (frontend lint/typecheck/test + cargo check/test + tauri build на ubuntu).
- [ ] Написать CONTRIBUTING.md (branching, PR, commit messages).
- [ ] Добавить `.editorconfig`, `.gitignore`, `LICENSE`.

## Критерии приёмки

- `pnpm install && pnpm tauri dev` поднимает пустое окно.
- `cargo check` и `pnpm tsc --noEmit` проходят.
- CI зелёный на main.
- Документация в `docs/` полная и актуальна.

## Риски

- Выбор Monaco vs CodeMirror — решить в этой фазе (Monaco тяжелее, но удобнее для KDL).
- Версия Tauri 2 — зафиксировать конкретный minor.
