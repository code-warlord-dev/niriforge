# Changelog

All notable changes to NiriForge will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-alpha.1] — 2026-09-29

### Added

- **Phase 0 Scaffold**: Tauri 2 + React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui foundation
- **Backend (Rust)**:
  - Cargo workspace with `kdl`, `schemars`, `thiserror`, `notify`, `tokio`, `dirs`, `chrono`
  - Module structure: `error`, `schema`, `commands`, `kdl`, `niri`, `fs`
  - All Tauri command stubs: `load_config`, `save_config`, `validate_config`, `list_backups`, `restore_backup`, `get_config_path`, `check_niri_running`, `niri_msg`, `get_outputs`
  - Comprehensive niri config schema (`Config` + all sub-types)
- **Frontend (React/TypeScript)**:
  - Zustand stores skeleton: `configStore`, `uiStore`, `validationStore`, `backupStore`, `settingsStore`
  - i18n foundation: `i18next` + `react-i18next`, locales `ru`/`en`, language detection + persistence
  - Theme system: System / Dark / Light via `next-themes`, CSS variables, semantic tokens
  - shadcn/ui components: Button, Card, Input, Label, Separator, ScrollArea, Dialog, DropdownMenu, Tabs, Select, Switch, Tooltip, Checkbox, RadioGroup, Slider, Textarea, Combobox
  - Layout: Sidebar (collapsible, 12 pages), Header (config path, dirty indicator, save/reload, ThemeToggle)
  - Toast system, Validation panel
- **CI/CD**: GitHub Actions workflow (frontend lint/typecheck/build, backend check/clippy/test, tauri build, version check) with caching
- **Documentation**: Complete Phase 0 specs, architecture, roadmap, versioning, safety, development guides
- **Design System**: Stitch-derived tokens and component language in `docs/design-reference/DESIGN-SYSTEM.md`, visual references in `docs/design-reference/stitch-screens/`
- **UI Shell**: App shell with empty state (no demo data), Sidebar/Header/ValidationPanel/StatusBar wired, EmptyState and SectionPlaceholder components, real config path handling

### Changed

- Version synchronized: `package.json` (0.1.0-alpha.1), `Cargo.toml` (0.1.0-alpha.1), `tauri.conf.json` (0.1.0-alpha.1)

## [0.1.1] — 2026-09-29

### Added

- **UI Shell Polish P0 — 1.1 Tokens**: DESIGN-SYSTEM.md tokens → `src/index.css` (dark-first: bg `#0f1115`, sidebar `#161922`, card `#1e222d`, border `#2e3444`, primary `#3b82f6`, success `#10b981`, warning `#f59e0b`, danger `#ef4444`), Inter + JetBrains Mono, 13px base, compact density
- **UI Shell Polish P0 — 1.2 Toasts**: ToastContainer mounted in `main.tsx`, `uiStore.addToast` wired, variant colors from DESIGN-SYSTEM (success `#10b981`, warning `#f59e0b`, danger `#ef4444`, info `#3b82f6`), slide-in/fade-in animations

### Changed

- Version synchronized: `package.json` (0.1.1), `Cargo.toml` (0.1.0-alpha.1), `tauri.conf.json` (0.1.1)

## [0.1.2] — 2026-09-29

### Added

- **UI Shell Polish P0 — 1.3 Header**: path + dirty dot (warning `#f59e0b`) + Validate (always active, toast error from stub) + Save (disabled when !dirty), compact h-14, removed duplicate "NiriForge" from Sidebar

### Changed

- Version synchronized: `package.json` (0.1.2), `Cargo.toml` (0.1.0-alpha.1), `tauri.conf.json` (0.1.2)

## [0.1.3] — 2026-09-29

### Added

- **UI Shell Polish P0 — 1.4 Browse dialog**: `@tauri-apps/plugin-dialog`, кнопка "Browse…" в EmptyState → Tauri open dialog (KDL filter), i18n keys (en: "Browse…", ru: "Обзор…"), capabilities fixed

### Changed

- Version synchronized: `package.json` (0.1.3), `Cargo.toml` (0.1.0-alpha.1), `tauri.conf.json` (0.1.3)

## [Unreleased]

### Added

- Initial documentation package: architecture, roadmap, versioning, specs, and guides.

## [0.0.0] — 2026-09-29

### Added

- Project skeleton documentation (pre-code).
