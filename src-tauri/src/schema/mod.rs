use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct Config {
    pub input: Option<InputConfig>,
    pub outputs: Vec<OutputConfig>,
    pub binds: BindsConfig,
    pub layout: Option<LayoutConfig>,
    pub window_rules: Vec<WindowRule>,
    pub layer_rules: Vec<LayerRule>,
    pub animations: Option<AnimationsConfig>,
    pub gestures: Option<GesturesConfig>,
    pub overview: Option<OverviewConfig>,
    pub recent_windows: Option<RecentWindowsConfig>,
    pub workspaces: Vec<NamedWorkspace>,
    pub switch_events: Option<SwitchEventsConfig>,
    pub debug: Option<DebugConfig>,
    pub spawn_at_startup: Vec<SpawnEntry>,
    pub spawn_sh_at_startup: Vec<String>,
    pub environment: HashMap<String, Option<String>>,
    pub cursor: Option<CursorConfig>,
    pub screenshot_path: Option<String>,
    pub prefer_no_csd: bool,
    pub blur: Option<BlurConfig>,
    pub xwayland_satellite: Option<XwaylandSatelliteConfig>,
    pub clipboard: Option<ClipboardConfig>,
    pub hotkey_overlay: Option<HotkeyOverlayConfig>,
    pub config_notification: Option<ConfigNotificationConfig>,
    /// A `serde_json::Value` has no schema, so the frontend sees these as
    /// `unknown` and has to narrow before it reads anything. That is the point:
    /// the UI is told there is a node here it does not model, and not what it is.
    pub unknown: Vec<serde_json::Value>,
    pub includes: Vec<IncludeEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct InputConfig {
    pub keyboard: Option<KeyboardConfig>,
    pub touchpad: Option<TouchpadConfig>,
    pub mouse: Option<MouseConfig>,
    pub trackpoint: Option<TrackpointConfig>,
    pub tablet: Option<TabletConfig>,
    pub touch: Option<TouchConfig>,
    pub focus_follows_mouse: Option<bool>,
    pub warp_mouse_to_focus: Option<bool>,
    pub mod_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct KeyboardConfig {
    pub xkb: Option<XkbConfig>,
    pub repeat_delay: Option<i32>,
    pub repeat_rate: Option<i32>,
    pub track_layout: Option<String>,
    pub numlock: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct XkbConfig {
    pub layout: Option<String>,
    pub variant: Option<String>,
    pub options: Option<String>,
    pub model: Option<String>,
    pub rules: Option<String>,
    pub file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct TouchpadConfig {
    pub off: Option<bool>,
    pub natural_scroll: Option<bool>,
    pub accel_speed: Option<f32>,
    pub accel_profile: Option<String>,
    pub scroll_method: Option<String>,
    pub scroll_button: Option<String>,
    pub left_handed: Option<bool>,
    pub tap: Option<bool>,
    pub dwt: Option<bool>,
    pub dwtp: Option<bool>,
    pub drag: Option<bool>,
    pub middle_emulation: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct MouseConfig {
    pub off: Option<bool>,
    pub natural_scroll: Option<bool>,
    pub accel_speed: Option<f32>,
    pub accel_profile: Option<String>,
    pub scroll_method: Option<String>,
    pub scroll_button: Option<String>,
    pub left_handed: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct TrackpointConfig {
    pub off: Option<bool>,
    pub natural_scroll: Option<bool>,
    pub accel_speed: Option<f32>,
    pub accel_profile: Option<String>,
    pub scroll_method: Option<String>,
    pub scroll_button: Option<String>,
    pub left_handed: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct TabletConfig {
    pub off: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct TouchConfig {
    pub off: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct OutputConfig {
    pub name: String,
    pub off: Option<bool>,
    pub mode: Option<String>,
    pub scale: Option<f32>,
    pub transform: Option<String>,
    pub position: Option<Position>,
    pub variable_refresh_rate: Option<bool>,
    pub focus_at_startup: Option<bool>,
    pub background_color: Option<String>,
    pub backdrop_color: Option<String>,
    pub hot_corners: Option<HotCornersConfig>,
    pub max_bpc: Option<i32>,
    pub layout: Option<LayoutConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct Position {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct HotCornersConfig {
    pub top_left: Option<String>,
    pub top_right: Option<String>,
    pub bottom_left: Option<String>,
    pub bottom_right: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct BindsConfig {
    pub binds: Vec<BindEntry>,
    pub modes: HashMap<String, Vec<BindEntry>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub struct BindEntry {
    pub key: String,
    pub action: String,
    pub args: Option<Vec<String>>,
    pub cooldown_ms: Option<i32>,
    pub allow_when_locked: Option<bool>,
    pub allow_inhibiting: Option<bool>,
    pub overlay_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct LayoutConfig {
    pub gaps: Option<i32>,
    pub center_focused_column: Option<String>,
    pub always_center_single_column: Option<bool>,
    pub empty_workspace_above_first: Option<bool>,
    pub default_column_display: Option<String>,
    pub background_color: Option<String>,
    pub preset_column_widths: Option<Vec<i32>>,
    pub default_column_width: Option<i32>,
    pub preset_window_heights: Option<Vec<i32>>,
    pub focus_ring: Option<FocusRingConfig>,
    pub border: Option<BorderConfig>,
    pub shadow: Option<ShadowConfig>,
    pub tab_indicator: Option<TabIndicatorConfig>,
    pub struts: Option<StrutsConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct FocusRingConfig {
    pub enabled: Option<bool>,
    pub width: Option<i32>,
    pub color: Option<String>,
    pub gradient: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct BorderConfig {
    pub enabled: Option<bool>,
    pub width: Option<i32>,
    pub color: Option<String>,
    pub gradient: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct ShadowConfig {
    pub enabled: Option<bool>,
    pub softness: Option<i32>,
    pub spread: Option<i32>,
    pub offset_x: Option<i32>,
    pub offset_y: Option<i32>,
    pub color: Option<String>,
    pub draw_behind_window: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct TabIndicatorConfig {
    pub position: Option<String>,
    pub colors: Option<Vec<String>>,
    pub gaps: Option<i32>,
    pub corner_radius: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct StrutsConfig {
    pub left: Option<i32>,
    pub right: Option<i32>,
    pub top: Option<i32>,
    pub bottom: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct WindowRule {
    pub match_rules: MatchRules,
    pub exclude: Option<MatchRules>,
    pub open_floating: Option<bool>,
    pub open_fullscreen: Option<bool>,
    pub open_maximized: Option<bool>,
    pub open_centered: Option<bool>,
    pub open_tiled: Option<bool>,
    pub default_width: Option<i32>,
    pub default_height: Option<i32>,
    pub min_width: Option<i32>,
    pub min_height: Option<i32>,
    pub max_width: Option<i32>,
    pub max_height: Option<i32>,
    pub border: Option<bool>,
    pub focus_ring: Option<bool>,
    pub shadow: Option<bool>,
    pub geometry_corner_radius: Option<i32>,
    pub clip_to_geometry: Option<bool>,
    pub opacity: Option<f32>,
    pub block_out_from: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct MatchRules {
    pub title: Option<String>,
    pub app_id: Option<String>,
    pub is_active: Option<bool>,
    pub is_focused: Option<bool>,
    pub is_floating: Option<bool>,
    pub is_maximized: Option<bool>,
    pub is_fullscreen: Option<bool>,
    pub at_startup: Option<bool>,
    pub namespace: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct LayerRule {
    pub namespace: String,
    pub match_rules: MatchRules,
    pub exclude: Option<MatchRules>,
    pub anchor: Option<String>,
    pub layer: Option<String>,
    pub keyboard_interactivity: Option<String>,
    pub margin: Option<Margin>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct Margin {
    pub top: Option<i32>,
    pub right: Option<i32>,
    pub bottom: Option<i32>,
    pub left: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct AnimationsConfig {
    pub enabled: Option<bool>,
    pub slowdown: Option<f32>,
    pub window_open: Option<AnimationConfig>,
    pub window_close: Option<AnimationConfig>,
    pub window_move: Option<AnimationConfig>,
    pub window_resize: Option<AnimationConfig>,
    pub workspace_switch: Option<AnimationConfig>,
    pub column_switch: Option<AnimationConfig>,
    pub overview: Option<AnimationConfig>,
    pub overview_window: Option<AnimationConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct AnimationConfig {
    pub easing: Option<EasingConfig>,
    pub spring: Option<SpringConfig>,
    pub duration: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub struct EasingConfig {
    pub x1: f32,
    pub y1: f32,
    pub x2: f32,
    pub y2: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct SpringConfig {
    pub damping: Option<f32>,
    pub stiffness: Option<f32>,
    pub epsilon: Option<f32>,
    pub mass: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct GesturesConfig {
    pub hot_corners: Option<HotCornersConfig>,
    pub dnd_edge_view_scroll: Option<bool>,
    pub dnd_edge_workspace_switch: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct OverviewConfig {
    pub zoom: Option<f32>,
    pub backdrop_color: Option<String>,
    pub workspace_shadow: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct RecentWindowsConfig {
    pub debounce_ms: Option<i32>,
    pub open_delay_ms: Option<i32>,
    pub highlight: Option<bool>,
    pub previews: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct NamedWorkspace {
    pub name: String,
    pub open_on_output: Option<String>,
    pub layout: Option<LayoutConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct SwitchEventsConfig {
    pub lid_close: Option<Vec<SpawnEntry>>,
    pub lid_open: Option<Vec<SpawnEntry>>,
    pub tablet_mode_on: Option<Vec<SpawnEntry>>,
    pub tablet_mode_off: Option<Vec<SpawnEntry>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct SpawnEntry {
    pub command: String,
    pub args: Option<Vec<String>>,
    pub env: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct DebugConfig {
    pub preview_render: Option<bool>,
    pub disable_direct_scanout: Option<bool>,
    pub honor_xdg_activation_token: Option<bool>,
    pub dump_frames: Option<bool>,
    pub log_level: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct CursorConfig {
    pub theme: Option<String>,
    pub size: Option<i32>,
    pub hide_when_typing: Option<bool>,
    pub hide_after_inactive_ms: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct BlurConfig {
    pub enabled: Option<bool>,
    pub radius: Option<i32>,
    pub passes: Option<i32>,
    pub noise: Option<f32>,
    pub contrast: Option<f32>,
    pub brightness: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct XwaylandSatelliteConfig {
    pub enabled: Option<bool>,
    pub wm_class: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct ClipboardConfig {
    pub enabled: Option<bool>,
    pub history: Option<bool>,
    pub max_items: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct HotkeyOverlayConfig {
    pub enabled: Option<bool>,
    pub delay_ms: Option<i32>,
    pub width: Option<i32>,
    pub height: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct ConfigNotificationConfig {
    pub enabled: Option<bool>,
    pub position: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub struct IncludeEntry {
    pub path: String,
    pub optional: Option<bool>,
}
