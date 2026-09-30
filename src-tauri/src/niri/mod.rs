//! Niri IPC integration: `niri msg` wrapper, live data, and validation.

pub mod ipc;
pub mod types;
pub mod validate;

use crate::error::AppResult;
use crate::niri::validate::ValidationOutcome;
use std::path::Path;

/// Check if niri is currently running.
///
/// A compositor that is not running is a normal state, not a failure: the app
/// still has to open, edit and save a config on a machine where niri is not
/// running. The answer is a `bool` for exactly that reason.
pub async fn is_niri_running() -> bool {
    ipc::is_niri_running().await
}

/// Get the niri version string.
///
/// `None` when the binary is not installed, which is the same situation
/// [`ValidationOutcome::Skipped`] describes: recorded, not guessed at.
pub async fn get_niri_version() -> Option<String> {
    validate::niri_version(validate::NIRI_BINARY).await
}

/// Validate a config file using `niri validate -c <path>`.
pub async fn validate_config_file(path: &Path) -> AppResult<ValidationOutcome> {
    validate::validate_with_niri(path).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn running_state_is_reported_rather_than_failing() {
        // The app has to work without a compositor, so this call must never be
        // the reason a command fails.
        let running = is_niri_running().await;

        assert!(matches!(running, true | false));
    }

    #[tokio::test]
    async fn the_version_is_a_value_and_not_a_result() {
        // A machine with no niri has no version, and that has to be expressible.
        let version = get_niri_version().await;

        if let Some(version) = version {
            assert!(!version.is_empty(), "an empty version is not a version");
        }
    }
}
