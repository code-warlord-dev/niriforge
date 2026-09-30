# Changelog

All notable changes to NiriForge will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.8] — 2026-09-30

FS and safety, milestone 1.2 of the phase 1 plan: the write path.

### Added

- **Atomic write.** A config is replaced by writing a temporary file in the same
  directory, `fsync`ing it, and renaming it over the target. A reader sees the old
  file or the new one, never a half-written one, and the temporary file is removed on
  every failure path. A symlinked config is written *through* to the file behind the
  link, so a dotfiles or Home Manager setup does not end up with two configs. The
  target's permission bits are carried over; a config created from nothing starts
  `0600`.
- **Backup manager.** Every successful save is preceded by a backup of the **whole**
  config set — the entry point and every include — because restoring one file out of a
  set leaves something niri will not load. Backups carry a `metadata.json` with a
  timestamp, the file list, the niri version, an optional comment and a SHA-256 over
  the stored bytes. Automatic backups are rotated to the 20 most recent; named ones
  are never rotated away. Restoring is itself reversible: the state being replaced is
  backed up first, and a backup with a file missing from it is refused before
  anything is written.
- **Compositor-side validation.** `niri validate -c <candidate>` runs against the
  staged candidate before it replaces anything, so a config niri would refuse is never
  written. Diagnostics are parsed into file, line, column and message, and a message
  that cannot be read is kept as text rather than dropped.
- **File watcher** over the entry point and every file in the include set. It reports
  what changed and leaves the decision alone: reloading a config the user is editing
  and ignoring an edit they made elsewhere are different answers, and only the
  application knows which applies.
- **The save transaction** as a single ordered function, so the safety order —
  edit → stage → validate → back up → replace → update the read model — cannot be
  skipped by a caller. A test checks that the only production code that puts a staged
  file onto a config is inside it. A file whose text did not actually change is not
  rewritten: the entry point is staged for the validation check, and replacing it
  anyway would show the user an edit they did not make.

### Fixed

- `BackupManager::default` called `.expect()` on a constructor that can fail. A backup
  directory that could not be created panicked during start-up with no message and no
  path; it is now an error the user can act on.
- The config watcher was filtered to `Create` and data-modify events, so it never
  noticed an atomic replace — which is how NiriForge itself saves, and how most editors
  save. Watching parent directories and reading the state off the filesystem fixed it.
- Two backup ids taken within the same clock tick landed in the same directory, so the
  second overwrote the first and a later rotation deleted a backup the user still
  believed they had. Ids now carry a monotonic counter.
- Automatic rotation walked the whole backup directory, which is how a named backup the
  user asked to keep could be deleted as garbage. The automatic scan is now flat, and
  named backups are only ever touched by an explicit per-name rotation.

### Changed

- The `coverage` badge is refreshed: **82.62% of Rust lines (1631/1974)**, measured at
  this release.

### Known limitations

- **A multi-file save is not atomic across files.** Each `rename` is; the sequence is
  not. A failure between two renames leaves the set mixed, and the error names the
  backup that restores a consistent state. A single-file config cannot hit this.
- **If `niri` is not installed, a save proceeds unchecked.** This is deliberate —
  editing a config for another machine is normal — but the save reports that nothing
  verified it, and that state is never presented as a pass.
- **A backup is only as good as the disk it is on.** `metadata.json` carries a hash so
  the application can tell a damaged backup from an intact one, but nothing detects bit
  rot until it is asked.
- **A restore is not validated.** It backs up the state it is about to replace first, so
  a mistaken restore can be undone, and it replaces file by file. A validation gate on
  restore was considered and left out on purpose: a gate that refuses a restore is a
  user with no way back.
- **`apply_config` still only writes fields that already have a node.** Changing
  `screenshot-path`, `prefer-no-csd`, `layout.gaps` or `blur` is what the save path
  currently carries; a field with no node in the document is not added.
- The Tauri commands are still stubs. Nothing calls the save path from the UI yet, so
  the guarantees above are not yet reachable by a user.
- The watcher reports changes; there is no reload, no prompt and no diff yet.

## [0.1.7] — 2026-09-30

### Added

- **Backend coverage measurement**: a `Backend Coverage (tarpaulin)` CI job runs
  `cargo tarpaulin --engine ptrace --out Lcov --lib --tests` on `stable` and publishes
  an LCOV artifact plus a per-file table in the job summary. Coverage is reported, not
  enforced — there is no threshold.
- A `coverage` badge in the README. **Baseline figure: 72.75% of Rust lines
  (857/1178), measured at this release.** The number is maintained by hand and must be
  refreshed in the README and here at each release. It covers the Rust crate only; the
  frontend has no test suite, so nothing in this figure refers to it.

### Changed

- README badge row reduced to six badges in a fixed order: version, CI, coverage, Rust,
  Tauri, license. The Rust badge now links to rust-lang.org and the Tauri badge gained
  its logo and colour. The Linux and Wayland badges are gone — the platform they claimed
  is already stated in the prose and in `docs/VERSIONING.md`.
- `docs/guides/DEVELOPMENT.md` documents the local coverage command and drops `pnpm test`
  from the command list, since no such script exists.

## [0.1.6] — 2026-09-30

### Changed

- README badge row: added the released version, tracked to a git tag, plus Tauri, Rust edition, Linux and Wayland. The version badge follows tags because the repository has tags but no GitHub Releases yet.

## [0.1.5] — 2026-09-30

KDL engine, milestone 1.1 of the phase 1 plan.

### Added

- **Include resolver**: `KdlConfigSet` holds the entry point and every file it pulls in. Relative, absolute and `~/` paths resolve against the file that contains the directive; `optional=true` on a missing file is not an error; cycles are detected on canonicalized paths; the depth limit is 10, the same value niri uses.
- **Include tree** and a source map covering every file in the set, so any node resolves to its own file, byte span and line/column.
- **AST ↔ typed `Config`**: `parse_config` → `to_config` (with a report of unmapped nodes) and `apply_config` back onto the node tree.
- **Round-trip fixtures**: 22 KDL files under `src-tauri/testdata/` — the niri default config, comment-heavy and `/-` commented-out configs, unknown top-level blocks, and three multi-file layouts up to four levels deep, including CachyOS and Noctalia style trees. `src-tauri/testdata/README.md` describes each case.

### Fixed

- KDL module compiles again; the tests had been written against an API of the `kdl` crate that does not exist in 4.7.1.
- Parse errors carry file, line, column and byte offset.
- Serialization no longer runs through the `kdl` pretty-printer. It rewrote the user's decor: dropped blank lines, re-indented comments, normalized CRLF and panicked on unusual decor. Rendering goes through `Display` instead, and an unedited file serializes byte-for-byte.
- Source map pointed at the pre-edit line after `apply_config` touched a document, and could resolve to the wrong file when two files shared an offset.

### Known limitations

- The engine does not write files. `serialize_file` / `serialize_all` return text; the load path works end to end, saving is milestone 1.2.
- `apply_config` only writes fields that already have a node in the document: `screenshot-path`, `prefer-no-csd`, `layout.gaps` and `blur` on/off. It will not add a node that is not there.
- Consequently, acceptance item 1.3 of the phase 1 spec — change a field, save, confirm with `niri validate` — is not done yet. The `blur` toggle was checked in both directions with `niri validate`, but that is not the same as a save path.

## [0.1.4] — 2026-09-29

### Changed

- Repository now holds the full project tree: frontend sources, Tauri backend, CI workflow, documentation and design reference.
- Roadmap: UI shell polish (P0) items marked as done.

### Fixed

- Version metadata realigned across `package.json`, `Cargo.toml`, `tauri.conf.json` and `Cargo.lock`.

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
