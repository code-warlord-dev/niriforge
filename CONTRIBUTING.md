# Contributing

## Before you start

1. Read `docs/ARCHITECTURE.md` and `docs/ROADMAP.md`.
2. Prefer a focused change over a large mixed refactor.
3. Follow `docs/guides/DEVELOPMENT.md` and `docs/guides/SAFETY.md`.

## Workflow

1. Branch from `main`.
2. Keep commits small and imperative (`fix(ui): …`, `feat(kdl): …`).
3. Add tests where they matter (especially KDL round-trip later).
4. Open a PR against `main` and link an issue if one exists.
5. Wait for CI.

## Welcome changes

- KDL parse/serialize fidelity and comment handling
- Coverage for new niri options
- Tests against real multi-file configs
- UI work that does not skip validate/atomic save paths
- Docs and translations (ru/en)

## Avoid

- Writing the live config without validation and atomic replace
- Breaking `include` / multi-file semantics
- Unrelated refactors bundled into feature PRs
- Sample/demo config modes in the UI (empty state should open a real path only)

## Contact

GitHub issues for now.
