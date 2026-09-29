# Карта версий и политика релизов NiriForge

## Semantic Versioning

Используем **SemVer 2.0**:

- **MAJOR** — breaking changes (несовместимые изменения schema, удаление публичных API, изменение поведения save, которое может сломать существующие workflow).
- **MINOR** — новая функциональность (новые секции, новые UI, новые commands) без breaking.
- **PATCH** — багфиксы, улучшения производительности, документация, мелкие UX-правки.

До 1.0 допускаются breaking changes в MINOR (с явной пометкой в changelog).

## Обязательный bump при каждом merge в main

**Правило проекта:** любой merge в `main` сопровождается повышением версии.

- Даже docs-only или chore → как минимум **patch**.
- Цель: сборка / состояние `main` всегда однозначно идентифицируется номером версии.
- Источники правды версии (должны совпадать): `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, git tag `vX.Y.Z`, badge в README.
- После merge: обновить CHANGELOG.md.

## Карта версий

| Версия | Кодовое имя (опционально) | Содержание | Статус |
|--------|---------------------------|------------|--------|
| 0.1.0  | Foundation                | KDL engine, safety, basic shell, load/save/validate/backup | Планируется |
| 0.2.0  | Core Sections             | Outputs, Input, Binds, Layout, Rules, Animations, Startup | Планируется |
| 0.3.0  | Full Coverage             | Все секции, IPC, profiles, search, raw sync, i18n | Планируется |
| 1.0.0  | Stable                    | Packaging, docs, polish, production-ready | Планируется |
| 1.x    | —                         | Incremental features + niri compatibility | — |

## Совместимость с niri

- NiriForge отслеживает актуальные версии niri.
- При breaking changes в niri config — выпускаем MINOR/MAJOR с migration notes.
- Валидация всегда идёт через `niri validate` текущей установленной версии.
- Schema поддерживает `since` / `deprecated` аннотации для опций.

## Changelog

Каждый релиз сопровождается `CHANGELOG.md` в формате Keep a Changelog:

- Added
- Changed
- Deprecated
- Removed
- Fixed
- Security

## Pre-releases

- `0.x.0-alpha.N` — ранние эксперименты.
- `0.x.0-beta.N` — feature-complete для фазы, но возможны баги.
- `0.x.0-rc.N` — release candidate.

## Поддерживаемые платформы (цель 1.0)

- Linux (Wayland) — основной.
- Arch / CachyOS — first-class (PKGBUILD).
- Другие distro — через AppImage.
- x86_64 и aarch64 (по возможности).

## Политика поддержки

- Последний MINOR 0.x и 1.x — bugfix.
- Security-фиксы — для всех поддерживаемых версий.
- Старые major после 1.0 — только security (решение принимается отдельно).
