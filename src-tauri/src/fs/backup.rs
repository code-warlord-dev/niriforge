//! Backup management: automatic, named, rotation, restore, metadata.

use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Backup metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupMeta {
    pub id: String,
    pub name: Option<String>,
    pub timestamp: DateTime<Utc>,
    pub files: Vec<PathBuf>,
    pub niri_version: Option<String>,
    pub comment: Option<String>,
    pub hash: String,
    pub is_auto: bool,
}

/// Backup manager for automatic and named backups.
#[allow(dead_code)]
pub struct BackupManager {
    backup_dir: PathBuf,
    max_auto_backups: usize,
    max_named_backups: usize,
}

impl BackupManager {
    #[allow(dead_code)]
    pub fn new() -> AppResult<Self> {
        Err(AppError::other("Not implemented yet"))
    }

    /// Create an automatic backup before save.
    #[allow(dead_code, unused_variables)]
    pub async fn create_auto_backup(&self, files: &[PathBuf]) -> AppResult<BackupMeta> {
        Err(AppError::other("Not implemented yet"))
    }

    /// Create a named/profile backup.
    #[allow(dead_code, unused_variables)]
    pub async fn create_named_backup(
        &self,
        files: &[PathBuf],
        name: &str,
        comment: Option<String>,
    ) -> AppResult<BackupMeta> {
        Err(AppError::other("Not implemented yet"))
    }

    /// List all backups (auto + named).
    #[allow(dead_code)]
    pub async fn list_backups(&self) -> AppResult<Vec<BackupMeta>> {
        Err(AppError::other("Not implemented yet"))
    }

    /// Restore a backup by ID.
    #[allow(dead_code, unused_variables)]
    pub async fn restore_backup(&self, id: &str) -> AppResult<()> {
        Err(AppError::other("Not implemented yet"))
    }

    /// Delete a backup by ID.
    #[allow(dead_code, unused_variables)]
    pub async fn delete_backup(&self, id: &str) -> AppResult<()> {
        Err(AppError::other("Not implemented yet"))
    }

    /// Rotate auto backups (keep only N most recent).
    #[allow(dead_code)]
    async fn rotate_auto_backups(&self) -> AppResult<()> {
        Err(AppError::other("Not implemented yet"))
    }

    /// Rotate named backups (keep only N per name or total).
    #[allow(dead_code)]
    async fn rotate_named_backups(&self) -> AppResult<()> {
        Err(AppError::other("Not implemented yet"))
    }

    /// Compute hash of backed up files.
    #[allow(dead_code, unused_variables)]
    async fn compute_backup_hash(files: &[PathBuf]) -> AppResult<String> {
        Err(AppError::other("Not implemented yet"))
    }
}

impl Default for BackupManager {
    fn default() -> Self {
        Self::new().expect("BackupManager::new should not fail in default")
    }
}
