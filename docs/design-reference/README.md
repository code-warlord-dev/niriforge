# Design reference

## Documents

| File | Purpose |
|------|---------|
| [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md) | **Canonical** design system (tokens, type, component language, feedback rules) |
| [STITCH-DESIGN-SYSTEM.md](./STITCH-DESIGN-SYSTEM.md) | Raw export from Stitch (historical); prefer DESIGN-SYSTEM.md |
| `stitch-screens/*.png` | Visual density reference only |

## Product rules

1. **No demo/sample data feature** in the real application.
2. Empty state = open real `~/.config/niri/config.kdl` (or chosen path).
3. Validation / save feedback = toasts + status (green success, red failure).
4. Themes: System / Dark / Light. i18n until 1.0: **ru + en** only.

When implementing UI, follow **DESIGN-SYSTEM.md**. Treat Stitch screenshots as layout inspiration; strip any “demo data” chrome from those images conceptually.
