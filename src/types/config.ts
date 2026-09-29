export interface ConfigMeta {
  path: string;
  includes: string[];
  lastModified: number;
  niriVersion?: string;
}

export interface SaveOptions {
  createBackup?: boolean;
  validateOnly?: boolean;
}

export interface SaveResult {
  success: boolean;
  backupId?: string;
  errors?: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface ValidationIssue {
  id: string;
  type: "error" | "warning";
  message: string;
  location?: {
    file: string;
    line: number;
    column: number;
  };
  code?: string;
  section?: string;
}

export interface AppError {
  code: string;
  message: string;
  location?: {
    file: string;
    line: number;
    column: number;
  };
  source?: string;
}

// Simplified config types - will be expanded in Phase 1
export interface Config {
  input?: InputConfig;
  outputs: OutputConfig[];
  binds: BindsConfig;
  layout?: LayoutConfig;
  window_rules: WindowRule[];
  layer_rules: LayerRule[];
  animations?: AnimationsConfig;
  gestures?: GesturesConfig;
  overview?: OverviewConfig;
  recent_windows?: RecentWindowsConfig;
  workspaces: NamedWorkspace[];
  spawn_at_startup: SpawnEntry[];
  environment: Record<string, string | null>;
  cursor?: CursorConfig;
  unknown: UnknownNode[];
  includes: IncludeEntry[];
}

export interface InputConfig {
  keyboard?: KeyboardConfig;
  mouse?: MouseConfig;
  touchpad?: TouchpadConfig;
}

export interface KeyboardConfig {
  repeat_rate?: number;
  repeat_delay?: number;
  xkb_options?: string[];
}

export interface MouseConfig {
  accel_profile?: "flat" | "adaptive";
  scroll_factor?: number;
  sensitivity?: number;
}

export interface TouchpadConfig {
  tap_to_click?: boolean;
  tap_and_drag?: boolean;
  drag_lock?: boolean;
  accel_profile?: "flat" | "adaptive";
  scroll_factor?: number;
  sensitivity?: number;
}

export interface OutputConfig {
  name: string;
  enabled?: boolean;
  mode?: string;
  position?: { x: number; y: number };
  scale?: number;
  transform?: "normal" | "90" | "180" | "270" | "flipped" | "flipped-90" | "flipped-180" | "flipped-270";
}

export interface BindsConfig {
  keys: KeyBind[];
  mouse?: MouseBind[];
  scroll?: ScrollBind[];
}

export interface KeyBind {
  modifiers: string[];
  key: string;
  action: string;
  modes?: string[];
}

export interface MouseBind {
  modifiers: string[];
  button: string;
  action: string;
}

export interface ScrollBind {
  modifiers: string[];
  direction: "up" | "down" | "left" | "right";
  action: string;
}

export interface LayoutConfig {
  default_width?: number;
  default_height?: number;
}

export interface WindowRule {
  match: WindowMatch;
  properties: WindowProperties;
}

export interface WindowMatch {
  app_id?: string | string[];
  title?: string | string[];
  window_role?: string | string[];
  window_type?: string | string[];
}

export interface WindowProperties {
  floating?: boolean;
  fullscreen?: boolean;
  opacity?: number;
  monitor?: string;
  workspace?: number;
  // ... more properties
}

export interface LayerRule {
  namespace: string;
  zindex?: number;
  keyboard_interactivity?: "exclusive" | "none" | "on-demand";
}

export interface AnimationsConfig {
  enabled?: boolean;
  windows?: WindowAnimationConfig;
  workspaces?: WorkspaceAnimationConfig;
  overview?: OverviewAnimationConfig;
}

export interface WindowAnimationConfig {
  open?: AnimationDef;
  close?: AnimationDef;
  move?: AnimationDef;
  resize?: AnimationDef;
}

export interface WorkspaceAnimationConfig {
  switch?: AnimationDef;
}

export interface OverviewAnimationConfig {
  open?: AnimationDef;
  close?: AnimationDef;
}

export interface AnimationDef {
  duration?: number;
  easing?: string; // cubic-bezier or spring
}

export interface GesturesConfig {
  swipe?: SwipeConfig;
  pinch?: PinchConfig;
}

export interface SwipeConfig {
  enabled?: boolean;
  threshold?: number;
  actions?: Record<string, string>;
}

export interface PinchConfig {
  enabled?: boolean;
}

export interface OverviewConfig {
  enabled?: boolean;
  filter?: "all" | "current-workspace";
}

export interface RecentWindowsConfig {
  enabled?: boolean;
  max_items?: number;
}

export interface NamedWorkspace {
  idx: number;
  name: string;
  output?: string;
}

export interface SpawnEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  working_dir?: string;
}

export interface CursorConfig {
  theme?: string;
  size?: number;
}

export interface UnknownNode {
  name: string;
  params: string[];
  children?: UnknownNode[];
  file: string;
  line: number;
  column: number;
}

export interface IncludeEntry {
  path: string;
  optional?: boolean;
}