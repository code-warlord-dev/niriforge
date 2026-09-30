//! Path resolution for niri config and NiriForge data.

use crate::error::{AppError, AppResult};
use dirs;
use shellexpand;
use std::path::PathBuf;
use tracing::{debug, trace};

/// Get the niri config directory (~/.config/niri or $XDG_CONFIG_HOME/niri).
pub fn get_niri_config_dir() -> AppResult<PathBuf> {
    trace!(target: "niriforge::fs::paths", "get_niri_config_dir called");
    let config_home = dirs::config_dir()
        .ok_or_else(|| AppError::other("Could not determine config directory"))?;
    let path = config_home.join("niri");
    debug!(target: "niriforge::fs::paths", "niri config dir: {}", path.display());
    Ok(path)
}

/// Get the main niri config file path with proper priority:
/// 1. $XDG_CONFIG_HOME/niri/config.kdl (or ~/.config/niri/config.kdl)
/// 2. $HOME/.config/niri/config.kdl (fallback)
/// 3. /etc/niri/config.kdl (system fallback)
pub fn get_niri_config_path() -> AppResult<PathBuf> {
    trace!(target: "niriforge::fs::paths", "get_niri_config_path called");
    // Priority 1: $XDG_CONFIG_HOME/niri/config.kdl (dirs::config_dir() handles XDG_CONFIG_HOME)
    if let Some(config_dir) = dirs::config_dir() {
        let path = config_dir.join("niri").join("config.kdl");
        let normalized = normalize_path(path)?;
        debug!(target: "niriforge::fs::paths", "config path (priority 1): {}", normalized.display());
        return Ok(normalized);
    }

    // Priority 2: $HOME/.config/niri/config.kdl
    if let Some(home) = dirs::home_dir() {
        let path = home.join(".config").join("niri").join("config.kdl");
        let normalized = normalize_path(path)?;
        debug!(target: "niriforge::fs::paths", "config path (priority 2): {}", normalized.display());
        return Ok(normalized);
    }

    // Priority 3: /etc/niri/config.kdl (system fallback)
    let path = PathBuf::from("/etc/niri/config.kdl");
    let normalized = normalize_path(path)?;
    debug!(target: "niriforge::fs::paths", "config path (priority 3): {}", normalized.display());
    Ok(normalized)
}

/// Normalize a path by expanding tilde and resolving symlinks if the file exists.
/// If the file doesn't exist, return the path with tilde expanded but without canonicalization.
pub fn normalize_path(path: PathBuf) -> AppResult<PathBuf> {
    trace!(target: "niriforge::fs::paths", "normalize_path called with: {}", path.display());
    // Expand tilde if present
    let expanded = shellexpand::tilde(&path.to_string_lossy()).into_owned();
    let path = PathBuf::from(expanded);

    // Try to canonicalize (resolve symlinks) if the file exists
    // If it doesn't exist, return the expanded path as-is
    let canonicalized = std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
    debug!(target: "niriforge::fs::paths", "normalized path: {}", canonicalized.display());
    Ok(canonicalized)
}

/// Get the NiriForge app data directory (~/.local/share/niriforge or $XDG_DATA_HOME/niriforge).
pub fn get_app_data_dir() -> AppResult<PathBuf> {
    trace!(target: "niriforge::fs::paths", "get_app_data_dir called");
    let data_home =
        dirs::data_dir().ok_or_else(|| AppError::other("Could not determine data directory"))?;
    let path = data_home.join("niriforge");
    debug!(target: "niriforge::fs::paths", "app data dir: {}", path.display());
    Ok(path)
}

/// Get the NiriForge backup directory.
pub fn get_backup_dir() -> AppResult<PathBuf> {
    trace!(target: "niriforge::fs::paths", "get_backup_dir called");
    let path = get_app_data_dir()?.join("backups");
    debug!(target: "niriforge::fs::paths", "backup dir: {}", path.display());
    Ok(path)
}

/// Get the NiriForge settings file path.
pub fn get_settings_path() -> AppResult<PathBuf> {
    trace!(target: "niriforge::fs::paths", "get_settings_path called");
    let path = get_app_data_dir()?.join("settings.json");
    debug!(target: "niriforge::fs::paths", "settings path: {}", path.display());
    Ok(path)
}

/// Get the NiriForge profiles directory.
pub fn get_profiles_dir() -> AppResult<PathBuf> {
    trace!(target: "niriforge::fs::paths", "get_profiles_dir called");
    let path = get_app_data_dir()?.join("profiles");
    debug!(target: "niriforge::fs::paths", "profiles dir: {}", path.display());
    Ok(path)
}

/// Ensure all NiriForge directories exist.
pub fn ensure_app_dirs() -> AppResult<()> {
    trace!(target: "niriforge::fs::paths", "ensure_app_dirs called");
    let data_dir = get_app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    debug!(target: "niriforge::fs::paths", "ensured app data dir: {}", data_dir.display());

    let backup_dir = get_backup_dir()?;
    std::fs::create_dir_all(&backup_dir)?;
    debug!(target: "niriforge::fs::paths", "ensured backup dir: {}", backup_dir.display());

    let profiles_dir = get_profiles_dir()?;
    std::fs::create_dir_all(&profiles_dir)?;
    debug!(target: "niriforge::fs::paths", "ensured profiles dir: {}", profiles_dir.display());

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

    /// get_niri_config_path resolves to the user config directory with proper priority
    #[test]
    fn config_path_uses_user_config_directory() {
        let path = get_niri_config_path().expect("config path is derivable");

        // Path should end with config.kdl
        assert_eq!(
            path.file_name().and_then(|n| n.to_str()),
            Some("config.kdl"),
            "config path must end with config.kdl, got: {}",
            path.display()
        );

        // Path should be absolute (tilde expanded)
        assert!(
            path.is_absolute(),
            "config path must be absolute (tilde expanded), got: {}",
            path.display()
        );

        // Path should contain "niri" directory
        let path_str = path.to_string_lossy();
        assert!(
            path_str.contains("niri"),
            "config path must contain 'niri' directory, got: {}",
            path.display()
        );

        // Priority 1: Should be under config_dir (XDG_CONFIG_HOME or ~/.config)
        if let Some(config_dir) = dirs::config_dir() {
            let expected_prefix = config_dir.join("niri");
            assert!(
                path.starts_with(&expected_prefix),
                "config path should be under XDG_CONFIG_HOME/niri (priority 1), got: {}",
                path.display()
            );
        }
        // If config_dir is not available, it falls back to home/.config/niri or /etc/niri
        else if let Some(home) = dirs::home_dir() {
            let expected_prefix = home.join(".config").join("niri");
            assert!(
                path.starts_with(&expected_prefix),
                "config path should be under $HOME/.config/niri (priority 2), got: {}",
                path.display()
            );
        } else {
            // System fallback
            assert!(
                path.starts_with("/etc/niri"),
                "config path should be under /etc/niri (priority 3), got: {}",
                path.display()
            );
        }
    }

    /// normalize_path expands tilde and canonicalizes existing files
    #[test]
    fn normalize_path_expands_tilde() {
        // Use a path with tilde
        let path = PathBuf::from("~/test/path");
        let normalized = normalize_path(path).expect("normalize_path should succeed");

        // Should not contain tilde
        let path_str = normalized.to_string_lossy();
        assert!(
            !path_str.starts_with("~"),
            "tilde should be expanded, got: {}",
            normalized.display()
        );
        // Should be absolute
        assert!(
            normalized.is_absolute(),
            "normalized path should be absolute, got: {}",
            normalized.display()
        );
    }
}
