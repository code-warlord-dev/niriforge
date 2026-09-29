//! Path resolution for niri config and NiriForge data.

use crate::error::{AppError, AppResult};
use dirs;
use std::path::PathBuf;

/// Get the niri config directory (~/.config/niri or $XDG_CONFIG_HOME/niri).
pub fn get_niri_config_dir() -> AppResult<PathBuf> {
    let config_home = dirs::config_dir()
        .ok_or_else(|| AppError::other("Could not determine config directory"))?;
    Ok(config_home.join("niri"))
}

/// Get the main niri config file path.
pub fn get_niri_config_path() -> AppResult<PathBuf> {
    Ok(get_niri_config_dir()?.join("config.kdl"))
}

/// Get the NiriForge app data directory (~/.local/share/niriforge or $XDG_DATA_HOME/niriforge).
pub fn get_app_data_dir() -> AppResult<PathBuf> {
    let data_home = dirs::data_dir()
        .ok_or_else(|| AppError::other("Could not determine data directory"))?;
    Ok(data_home.join("niriforge"))
}

/// Get the NiriForge backup directory.
pub fn get_backup_dir() -> AppResult<PathBuf> {
    Ok(get_app_data_dir()?.join("backups"))
}

/// Get the NiriForge settings file path.
pub fn get_settings_path() -> AppResult<PathBuf> {
    Ok(get_app_data_dir()?.join("settings.json"))
}

/// Get the NiriForge profiles directory.
pub fn get_profiles_dir() -> AppResult<PathBuf> {
    Ok(get_app_data_dir()?.join("profiles"))
}

/// Ensure all NiriForge directories exist.
pub fn ensure_app_dirs() -> AppResult<()> {
    std::fs::create_dir_all(get_app_data_dir()?)?;
    std::fs::create_dir_all(get_backup_dir()?)?;
    std::fs::create_dir_all(get_profiles_dir()?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_paths_module_exists() {
        assert!(true);
    }
}