# NiriForge

[![version v0.1.7](https://img.shields.io/github/v/tag/code-warlord-dev/niriforge?label=version&sort=semver)](https://github.com/code-warlord-dev/niriforge/tags)
[![CI](https://github.com/code-warlord-dev/niriforge/actions/workflows/ci.yml/badge.svg)](https://github.com/code-warlord-dev/niriforge/actions/workflows/ci.yml)
[![coverage 82.62%](https://img.shields.io/badge/coverage-82.62%25-4c1.svg)](docs/guides/DEVELOPMENT.md#покрытие-кода)
[![Rust edition 2021](https://img.shields.io/badge/Rust-2021-000?style=flat&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?style=flat&logo=tauri&logoColor=white)](https://tauri.app/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

GUI configuration tool for the [niri](https://github.com/niri-wm/niri) Wayland compositor.

Built with **Rust**, **Tauri 2**, **React**, and **TypeScript**.

Not a fork of NiriMod. New codebase: typed config model, atomic saves, KDL round-trip, optional IPC, and a desktop-oriented UI.

## Goals

- Cover the main niri config sections in a structured UI
- Safe writes: validate when possible, atomic replace, backups, keep unknown nodes and comments where the engine allows
- Multi-file configs with `include`
- Optional live data via `niri msg` (outputs, etc.)
- Themes: system / dark / light
- UI languages through 1.0: Russian and English

## Docs

| Doc | Description |
|-----|-------------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layout of the app |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Roadmap |
| [docs/VERSIONING.md](docs/VERSIONING.md) | Version policy |
| [docs/SCHEMA-OVERVIEW.md](docs/SCHEMA-OVERVIEW.md) | Config section coverage |
| [docs/CONTRACT.md](docs/CONTRACT.md) | Backend/frontend wire contract |
| [docs/guides/](docs/guides/) | Development and safety notes |
| [docs/design-reference/DESIGN-SYSTEM.md](docs/design-reference/DESIGN-SYSTEM.md) | UI tokens |

## Stack

**Backend:** Tauri 2, kdl, serde, thiserror, notify, tokio  
**Frontend:** React, TypeScript, Zustand, Vite, Tailwind, shadcn-style components

## Development

```bash
pnpm install
pnpm tauri dev
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch and PR expectations.

## License

MIT

NiriForge is independent and not affiliated with the niri authors or NiriMod.
