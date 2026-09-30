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
    let data_home =
        dirs::data_dir().ok_or_else(|| AppError::other("Could not determine data directory"))?;
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

    /// The path getters are read straight from the environment, so these assert
    /// the *shape* - where things have to end up relative to each other - rather
    /// than an absolute path, which differs per machine and per test run.
    #[test]
    fn the_config_file_lives_in_the_config_directory() {
        let dir = get_niri_config_dir().expect("the config dir is derivable");
        let file = get_niri_config_path().expect("the config path is derivable");

        assert_eq!(file.parent(), Some(dir.as_path()));
        assert_eq!(
            file.file_name().and_then(|n| n.to_str()),
            Some("config.kdl")
        );
    }

    #[test]
    fn backups_and_profiles_live_under_the_app_data_directory() {
        let data = get_app_data_dir().expect("the data dir is derivable");
        let backups = get_backup_dir().expect("the backup dir is derivable");
        let profiles = get_profiles_dir().expect("the profiles dir is derivable");
        let settings = get_settings_path().expect("the settings path is derivable");

        assert!(
            backups.starts_with(&data),
            "{} has to be under {}",
            backups.display(),
            data.display()
        );
        assert!(
            profiles.starts_with(&data),
            "{} has to be under {}",
            profiles.display(),
            data.display()
        );
        assert!(
            settings.starts_with(&data),
            "{} has to be under {}",
            settings.display(),
            data.display()
        );
        assert_ne!(backups, profiles, "two directories must not share a name");
    }

    // `BackupManager::new` is deliberately not exercised here: it creates the
    // directory it is given, and in its default form that is the user's real data
    // directory. A test that has to clean up after itself in someone's home is a
    // test that will eventually leave something behind; the manager is covered
    // through `BackupManager::with_dir` against a temp directory instead.
}
