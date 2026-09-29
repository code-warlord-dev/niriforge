# Обзор схемы конфигурации niri (NiriForge)

Документ фиксирует, какие секции должны быть полностью покрыты.

## Top-level

| Элемент | Тип | Примечание |
|---------|-----|----------|
| `input {}` | section | один |
| `output "…" {}` | section | повторяемый |
| `binds {}` | section | один |
| `layout {}` | section | один (+ overrides в output/workspace) |
| `window-rule {}` | section | повторяемый, order matters |
| `layer-rule {}` | section | повторяемый |
| `animations {}` | section | один |
| `gestures {}` | section | один |
| `overview {}` | section | один |
| `recent-windows {}` | section | один |
| `workspace "name" {}` | section | named workspaces |
| `switch-events {}` | section | один |
| `debug {}` | section | один |
| `include "…" optional?` | directive | top-level only |
| `spawn-at-startup` | list | |
| `spawn-sh-at-startup` | list | |
| `environment {}` | section | |
| `cursor {}` | section | |
| `screenshot-path` | string | |
| `prefer-no-csd` | flag | |
| `blur {}` | section | |
| `xwayland-satellite {}` | section | |
| `clipboard {}` | section | |
| `hotkey-overlay {}` | section | |
| `config-notification {}` | section | |

## Input (ключевые поля)

- keyboard.xkb (layout, variant, options, model, rules, file)
- keyboard.repeat-delay / repeat-rate
- keyboard.track-layout
- touchpad / mouse / trackpoint / ... (off, natural-scroll, accel-*, scroll-*, tap, dwt, left-handed, ...)
- focus-follows-mouse, warp-mouse-to-focus, mod-key

## Output

- off, mode, scale, transform, position, variable-refresh-rate, focus-at-startup
- background-color, backdrop-color, hot-corners, max-bpc
- layout { ... } override

## Binds

- hotkey → { action; ... }
- поддержка Wheel* и Mouse*
- cooldown-ms и другие атрибуты

## Layout

- gaps, center-focused-column, always-center-single-column, empty-workspace-above-first
- preset-column-widths, default-column-width, preset-window-heights
- focus-ring, border, shadow, tab-indicator, struts, background-color
- default-column-display

## Window / Layer rules

- match / exclude (title, app-id, is-*, at-startup, namespace, ...)
- open-*, default-*-width/height, min/max-*, border, shadow, geometry-corner-radius, clip-to-geometry, opacity, ...

## Animations

- off, slowdown
- per-animation: easing (cubic-bezier) / spring + параметры

Полный актуальный список полей всегда сверять с официальной wiki niri на момент реализации.
