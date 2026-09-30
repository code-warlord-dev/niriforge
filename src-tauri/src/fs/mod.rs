//! File system operations: atomic write, symlink resolution, watching, backups.

pub mod atomic;
pub mod backup;
pub mod paths;
pub mod save;
pub mod watch;

use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

/// Resolve the main niri config path.
///
/// An explicit `custom_path` wins over the XDG default: it is how a user points
/// the app at a dotfiles checkout or a test fixture. The default is the XDG
/// location, which is where niri itself looks.
///
/// Both outcomes are returned as errors rather than as a fallback path. Silently
/// substituting one location for the other is how an app ends up editing a file
/// the compositor is not reading.
pub fn resolve_config_path(custom_path: Option<PathBuf>) -> AppResult<PathBuf> {
    let path = match custom_path {
        Some(path) => path,
        None => paths::get_niri_config_path()?,
    };
    if !path.exists() {
        return Err(AppError::ConfigNotFound { path });
    }
    atomic::resolve_write_target(&path)
}

/// Resolve symlinks to get the real path.
///
/// For a path that exists this is a canonicalisation. For one that does not, the
/// parent directory is canonicalised and the file name kept, so the caller learns
/// where a *new* file would really appear rather than failing.
pub fn resolve_symlinks(path: &Path) -> AppResult<PathBuf> {
    atomic::resolve_write_target(path)
}

/// Ensure a directory exists, along with the parents it needs.
///
/// An existing directory is success. A path that exists but is not a directory is
/// an error: creating files inside it would fail later, further from the cause.
pub fn ensure_dir(path: &Path) -> AppResult<()> {
    if path.is_dir() {
        return Ok(());
    }
    if path.exists() {
        return Err(AppError::Io(format!(
            "{}: exists and is not a directory",
            path.display()
        )));
    }
    std::fs::create_dir_all(path).map_err(|err| AppError::Io(format!("{}: {err}", path.display())))
}

/// Read a file as string.
pub fn read_file(path: &Path) -> AppResult<String> {
    std::fs::read_to_string(path).map_err(|err| match err.kind() {
        std::io::ErrorKind::NotFound => AppError::ConfigNotFound {
            path: path.to_path_buf(),
        },
        _ => AppError::Io(format!("{}: {err}", path.display())),
    })
}

/// Write a file atomically (temp → fsync → rename).
///
/// A thin alias for [`atomic::write_atomic`] kept at the module root because
/// every caller that wants to write a config goes through here, and having one
/// name for "replace a file without ever truncating it" makes it obvious when a
/// second one appears.
pub async fn write_file_atomic(path: &Path, content: &str) -> AppResult<()> {
    atomic::write_atomic(path, content).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;
    use tempfile::TempDir;

    fn write(path: &Path, content: &str) {
        std::fs::write(path, content).expect("fixture write should succeed");
    }

    #[test]
    fn an_explicit_path_wins_over_the_xdg_default() {
        let dir = TempDir::new().expect("temp dir");
        let custom = dir.path().join("mine.kdl");
        write(&custom, "custom\n");

        let resolved = resolve_config_path(Some(custom.clone())).expect("path should resolve");

        assert_eq!(resolved, std::fs::canonicalize(&custom).expect("canonical"));
    }

    #[test]
    fn a_missing_custom_path_is_reported_rather_than_replaced_by_the_default() {
        let dir = TempDir::new().expect("temp dir");
        let missing = dir.path().join("absent.kdl");

        let err = resolve_config_path(Some(missing.clone()))
            .expect_err("a missing file must not fall back to another location");

        assert!(
            matches!(err, AppError::ConfigNotFound { .. }),
            "got {err:?}"
        );
    }

    #[test]
    fn resolving_a_symlink_yields_the_real_file() {
        let real_dir = TempDir::new().expect("temp dir");
        let link_dir = TempDir::new().expect("temp dir");
        let real = real_dir.path().join("config.kdl");
        write(&real, "x\n");
        let link = link_dir.path().join("config.kdl");
        symlink(&real, &link).expect("symlink should be created");

        let resolved = resolve_symlinks(&link).expect("link should resolve");

        assert_eq!(resolved, std::fs::canonicalize(&real).expect("canonical"));
    }

    #[test]
    fn resolving_a_missing_file_resolves_through_its_directory() {
        let dir = TempDir::new().expect("temp dir");
        let missing = dir.path().join("not-there.kdl");

        let resolved = resolve_symlinks(&missing).expect("parent should resolve");

        assert_eq!(resolved.file_name(), missing.file_name());
        assert!(resolved.parent().is_some_and(|p| p.is_dir()));
    }

    #[test]
    fn ensure_dir_creates_the_whole_chain_and_is_idempotent() {
        let dir = TempDir::new().expect("temp dir");
        let nested = dir.path().join("a/b/c");

        ensure_dir(&nested).expect("first call should create");
        ensure_dir(&nested).expect("second call should be a no-op");

        assert!(nested.is_dir());
    }

    #[test]
    fn ensure_dir_refuses_a_path_that_is_a_file() {
        let dir = TempDir::new().expect("temp dir");
        let file = dir.path().join("not-a-dir");
        write(&file, "x");

        let err = ensure_dir(&file).expect_err("a file is not a directory");

        assert!(matches!(err, AppError::Io(_)), "got {err:?}");
    }

    #[test]
    fn read_file_reports_a_missing_file_as_a_missing_config() {
        let dir = TempDir::new().expect("temp dir");
        let missing = dir.path().join("absent.kdl");

        let err = read_file(&missing).expect_err("the file is not there");

        assert!(
            matches!(err, AppError::ConfigNotFound { .. }),
            "got {err:?}"
        );
    }

    #[tokio::test]
    async fn write_file_atomic_replaces_content() {
        let dir = TempDir::new().expect("temp dir");
        let target = dir.path().join("config.kdl");
        write(&target, "old\n");

        write_file_atomic(&target, "new\n")
            .await
            .expect("write should succeed");

        assert_eq!(std::fs::read_to_string(&target).expect("read"), "new\n");
    }
}
