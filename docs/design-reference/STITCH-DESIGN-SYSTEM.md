---
name: Wayland Pro Desktop
colors:
  surface: '#111317'
  surface-dim: '#111317'
  surface-bright: '#37393e'
  surface-container-lowest: '#0c0e12'
  surface-container-low: '#1a1c20'
  surface-container: '#1e2024'
  surface-container-high: '#282a2e'
  surface-container-highest: '#333539'
  on-surface: '#e2e2e8'
  on-surface-variant: '#c2c6d6'
  inverse-surface: '#e2e2e8'
  inverse-on-surface: '#2f3035'
  outline: '#8c909f'
  outline-variant: '#424754'
  surface-tint: '#adc6ff'
  primary: '#adc6ff'
  on-primary: '#002e6a'
  primary-container: '#4d8eff'
  on-primary-container: '#00285d'
  inverse-primary: '#005ac2'
  secondary: '#7bd0ff'
  on-secondary: '#00354a'
  secondary-container: '#00a6e0'
  on-secondary-container: '#00374d'
  tertiary: '#ffb786'
  on-tertiary: '#502400'
  tertiary-container: '#df7412'
  on-tertiary-container: '#461f00'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc6ff'
  on-primary-fixed: '#001a42'
  on-primary-fixed-variant: '#004395'
  secondary-fixed: '#c4e7ff'
  secondary-fixed-dim: '#7bd0ff'
  on-secondary-fixed: '#001e2c'
  on-secondary-fixed-variant: '#004c69'
  tertiary-fixed: '#ffdcc6'
  tertiary-fixed-dim: '#ffb786'
  on-tertiary-fixed: '#311400'
  on-tertiary-fixed-variant: '#723600'
  background: '#111317'
  on-background: '#e2e2e8'
  surface-variant: '#333539'
  surface-sidebar: '#161922'
  surface-card: '#1e222d'
  surface-hover: '#282e3d'
  border-default: '#2e3444'
  border-subtle: '#232733'
  primary-hover: '#60a5fa'
  state-success: '#10b981'
  state-warning: '#f59e0b'
  state-danger: '#ef4444'
  text-primary: '#f3f4f6'
  text-secondary: '#9ca3af'
  text-muted: '#6b7280'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '700'
    lineHeight: 28px
  headline-md:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 22px
  headline-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.05em
  body-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
  code-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 14px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 0.75rem
  margin: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

# NiriForge Design System

## Brand & Product Direction
- **Product:** NiriForge — Desktop configuration GUI for the niri Wayland compositor.
- **Genre:** Desktop Settings / Control-panel / Pro-tool UI (suitable for Tauri / GTK / Wayland environment).
- **Aesthetic:** Modern, crisp, dark-mode prioritized Linux/Wayland power-user aesthetic with neutral grays, subtle borders, high information density, and precise typography.
- **Tone:** Professional, reliable, safe, clean, technical.

## Color Palette
- **Background Master:** `#0f1115` (Deep dark slate)
- **Surface / Sidebar:** `#161922` (Slightly lighter slate)
- **Surface Elevated / Cards:** `#1e222d`
- **Surface Hover / Active:** `#282e3d`
- **Border Default:** `#2e3444`
- **Border Subtle:** `#232733`
- **Primary / Accent:** `#3b82f6` (Vibrant tech blue)
- **Primary Hover:** `#60a5fa`
- **Success:** `#10b981` (Validated, saved, clean)
- **Warning:** `#f59e0b` (Dirty config, demo data active, external file change)
- **Danger / Error:** `#ef4444` (Validation failure, unsaved conflict, fatal error)
- **Text Primary:** `#f3f4f6`
- **Text Secondary:** `#9ca3af`
- **Text Muted:** `#6b7280`
- **Monospace Accent:** `#38bdf8` (KDL attributes, keys, file paths)

## Typography
- **UI Font:** Inter, system-ui, -apple-system, sans-serif
- **Monospace Font:** JetBrains Mono, Fira Code, monospace for hotkeys, paths, KDL tokens
- **Hierarchy:**
  - App Header: 15px semi-bold
  - Section Title: 20px bold
  - Subsection Title: 14px semi-bold uppercase (tracking-wider)
  - Body: 13px regular / medium
  - Labels & Badges: 11px - 12px medium
  - Monospace tags / hotkeys: 12px mono

## Component Language
- Compact native-desktop feel: 6px to 8px border radiuses, 1px crisp borders.
- Pill badges for multi-file indicators, dirty state, validation status.
- Mandatory Demo Data Banner & Clean Controls: high visibility banner with direct "Remove Demo Data / Использовать только реальный конфиг" action.
- Dual-language ready (RU / EN toggleable).
