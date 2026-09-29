//! Niri IPC integration: `niri msg` wrapper, live data, and validation.

pub mod ipc;
pub mod types;
pub mod validate;

use crate::error::{AppError, AppResult};

/// Check if niri is currently running.
#[allow(dead_code)]
pub async fn is_niri_running() -> AppResult<bool> {
    Err(AppError::other("Not implemented yet"))
}

/// Get the niri version string.
#[allow(dead_code)]
pub async fn get_niri_version() -> AppResult<String> {
    Err(AppError::other("Not implemented yet"))
}

/// Validate a config file using `niri validate`.
#[allow(dead_code, unused_variables)]
pub async fn validate_config_file(
    path: &std::path::Path,
) -> AppResult<Vec<crate::error::ValidationError>> {
    Err(AppError::other("Not implemented yet"))
}
