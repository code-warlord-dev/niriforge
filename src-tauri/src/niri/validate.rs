//! Niri config validation via `niri validate`.

use crate::error::{AppError, AppResult, ValidationError};
use std::path::Path;

/// Validate a config file using `niri validate --config <path>`.
#[allow(dead_code, unused_variables)]
pub async fn validate_with_niri(config_path: &Path) -> AppResult<Vec<ValidationError>> {
    Err(AppError::other("Not implemented yet"))
}

/// Validate a config by writing to a temp file and running `niri validate`.
#[allow(dead_code, unused_variables)]
pub async fn validate_config_content(config_content: &str) -> AppResult<Vec<ValidationError>> {
    Err(AppError::other("Not implemented yet"))
}

/// Parse niri validate output into structured errors.
#[allow(dead_code, unused_variables)]
fn parse_niri_validate_output(output: &str) -> Vec<ValidationError> {
    Vec::new()
}
