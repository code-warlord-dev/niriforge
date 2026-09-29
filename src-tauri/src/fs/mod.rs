//! File system operations: atomic write, symlink resolution, watching, backups.

pub mod atomic;
pub mod watch;
pub mod backup;
pub mod paths;

use crate::error::{AppError, AppResult};
use std::path::PathBuf;

/// Resolve the main niri config path (following XDG and symlinks).
#[allow(dead_code, unused_variables)]
pub fn resolve_config_path(custom_path: Option<PathBuf>) -> AppResult<PathBuf> {
    Err(AppError::other("Not implemented yet"))
}

/// Resolve symlinks to get the real path.
#[allow(dead_code, unused_variables, clippy::ptr_arg)]
pub fn resolve_symlinks(path: &PathBuf) -> AppResult<PathBuf> {
    Err(AppError::other("Not implemented yet"))
}

/// Ensure a directory exists.
#[allow(dead_code, unused_variables, clippy::ptr_arg)]
pub fn ensure_dir(path: &PathBuf) -> AppResult<()> {
    Err(AppError::other("Not implemented yet"))
}

/// Read a file as string.
#[allow(dead_code, unused_variables, clippy::ptr_arg)]
pub fn read_file(path: &PathBuf) -> AppResult<String> {
    Err(AppError::other("Not implemented yet"))
}

/// Write a file atomically (temp → fsync → rename).
#[allow(dead_code, unused_variables, clippy::ptr_arg)]
pub async fn write_file_atomic(path: &PathBuf, content: &str) -> AppResult<()> {
    Err(AppError::other("Not implemented yet"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fs_module_exists() {
        assert!(true);
    }
}