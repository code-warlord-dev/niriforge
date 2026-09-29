//! Type definitions for niri IPC responses.

use serde::{Deserialize, Serialize};

/// Output (monitor) information from niri.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputInfo {
    pub name: String,
    pub make: String,
    pub model: String,
    pub serial: String,
    pub modes: Vec<ModeInfo>,
    pub current_mode: Option<ModeInfo>,
    pub scale: f32,
    pub transform: String,
    pub position: Position,
    pub vrr: bool,
    pub focused: bool,
}

/// Display mode information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModeInfo {
    pub width: i32,
    pub height: i32,
    pub refresh_rate: f32,
    pub preferred: bool,
}

/// 2D position.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub x: i32,
    pub y: i32,
}

/// Window information from niri.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowInfo {
    pub id: u64,
    pub title: String,
    pub app_id: String,
    pub is_focused: bool,
    pub is_floating: bool,
    pub is_fullscreen: bool,
    pub is_maximized: bool,
    pub workspace_idx: Option<u32>,
    pub output_name: Option<String>,
}

/// Workspace information from niri.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceInfo {
    pub idx: u32,
    pub name: Option<String>,
    pub output: String,
    pub focused: bool,
    pub active_window_id: Option<u64>,
}

/// Layer information from niri.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayerInfo {
    pub namespace: String,
    pub anchor: String,
    pub layer: String,
    pub keyboard_interactivity: String,
    pub exclusive_zone: i32,
    pub margin: Margin,
}

/// Margin for layers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Margin {
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
    pub left: i32,
}

/// Niri version info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionInfo {
    pub version: String,
    pub commit: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_types_module_exists() {
        assert!(true);
    }
}