//! Wrapper around `niri msg` for live data queries.

use crate::error::{AppError, AppResult};
use crate::niri::types::{OutputInfo, WindowInfo, WorkspaceInfo, LayerInfo};

/// Execute `niri msg` with given arguments and return stdout.
#[allow(dead_code, unused_variables)]
pub async fn niri_msg(args: &[&str]) -> AppResult<String> {
    Err(AppError::other("Not implemented yet"))
}

/// Get live outputs from niri.
#[allow(dead_code)]
pub async fn get_outputs() -> AppResult<Vec<OutputInfo>> {
    Err(AppError::other("Not implemented yet"))
}

/// Get live windows from niri.
#[allow(dead_code)]
pub async fn get_windows() -> AppResult<Vec<WindowInfo>> {
    Err(AppError::other("Not implemented yet"))
}

/// Get live workspaces from niri.
#[allow(dead_code)]
pub async fn get_workspaces() -> AppResult<Vec<WorkspaceInfo>> {
    Err(AppError::other("Not implemented yet"))
}

/// Get live layers from niri.
#[allow(dead_code)]
pub async fn get_layers() -> AppResult<Vec<LayerInfo>> {
    Err(AppError::other("Not implemented yet"))
}

/// Get focused window from niri.
#[allow(dead_code)]
pub async fn get_focused_window() -> AppResult<Option<WindowInfo>> {
    Err(AppError::other("Not implemented yet"))
}

/// Execute a raw niri msg command and parse JSON output.
#[allow(dead_code, unused_variables)]
async fn execute_niri_msg_json<T>(args: &[&str]) -> AppResult<T>
where
    T: for<'de> serde::Deserialize<'de>,
{
    Err(AppError::other("Not implemented yet"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ipc_module_exists() {
        assert!(true);
    }
}