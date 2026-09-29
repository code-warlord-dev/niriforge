//! File system watching for external config changes.

use crate::error::{AppError, AppResult};
use notify::{Event, RecommendedWatcher};
use std::path::Path;
use std::sync::mpsc;
use tokio::sync::broadcast;

/// Start watching a config file and its directory for changes.
#[allow(dead_code, unused_variables)]
pub async fn watch_config(path: &Path) -> AppResult<ConfigWatcher> {
    Err(AppError::other("Not implemented yet"))
}

/// Watcher handle for config files.
#[allow(dead_code)]
pub struct ConfigWatcher {
    _watcher: RecommendedWatcher,
    rx: broadcast::Receiver<ConfigEvent>,
}

/// Events emitted by the config watcher.
#[derive(Debug, Clone)]
pub enum ConfigEvent {
    /// Config file was modified.
    Modified,
    /// Config file was deleted.
    Deleted,
    /// An included file was modified.
    IncludedModified(std::path::PathBuf),
    /// Watcher error.
    Error(String),
}

#[allow(dead_code)]
impl ConfigWatcher {
    /// Subscribe to config events.
    pub fn subscribe(&self) -> broadcast::Receiver<ConfigEvent> {
        self.rx.resubscribe()
    }
}

/// Create a watcher for a set of paths.
#[allow(dead_code, unused_variables)]
fn create_watcher(
    paths: &[&Path],
) -> AppResult<(RecommendedWatcher, mpsc::Receiver<notify::Result<Event>>)> {
    Err(AppError::other("Not implemented yet"))
}
