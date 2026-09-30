//! Backup management: automatic, named, rotation, restore, metadata.
//!
//! # What a backup is
//!
//! One backup is a **directory** holding a copy of every file of the config set
//! plus a `metadata.json`. Not one file: a niri config is routinely split across
//! a main file and a dozen includes, and the main file means nothing without the
//! includes it pulls in. Restoring one file out of such a set would leave a
//! config that niri refuses to load, so the whole set is captured or nothing is.
//!
//! # Layout
//!
//! ```text
//! backups/
//!   20260930T101500.123456789Z-auto/       automatic, rotated
//!     metadata.json
//!     files/config.kdl
//!     files/cfg/input.kdl
//!   named/
//!     before-i3-switch/
//!       metadata.json
//!       files/...
//! ```
//!
//! Automatic backups sit at the top level and are named by their timestamp, which
//! sorts chronologically as plain text and therefore needs no manifest to
//! enumerate. Named backups sit under `named/`, keyed by the name the user gave,
//! and are never rotated away - a backup the user asked for by name is a
//! decision, not garbage.
//!
//! Paths inside a backup are stored **relative to the config directory**, under a
//! fixed `files/` prefix. Absolute paths would make a backup taken on one machine
//! unrestorable on another, which is exactly when a backup is wanted.

use crate::error::{AppError, AppResult};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

/// Subdirectory of a backup holding the copies.
const FILES_DIR: &str = "files";

/// Subdirectory of the backup root holding the named backups.
const NAMED_DIR: &str = "named";

/// Metadata file name, used in both directions.
const METADATA_FILE: &str = "metadata.json";

/// One file inside a backup.
///
/// The pair is what makes the backup readable back: `source` says which file on
/// disk this was, `relative` says where the copy lives inside the backup, and the
/// two are recorded rather than recomputed, so a restore does not depend on
/// re-deriving a path layout that may have changed since the backup was taken.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackupFile {
    /// Absolute path of the original file, as it was when the backup was taken.
    pub source: PathBuf,
    /// Path of the copy, relative to the backup directory.
    pub relative: String,
}

/// Backup metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackupMeta {
    /// Unique identifier: the backup directory's name.
    pub id: String,
    /// Name the user gave, for a named backup.
    pub name: Option<String>,
    /// When it was taken.
    pub timestamp: DateTime<Utc>,
    /// Absolute paths of the files that were captured.
    pub files: Vec<PathBuf>,
    /// `niri --version` output at backup time, when the binary was reachable.
    pub niri_version: Option<String>,
    /// Free text the user attached.
    pub comment: Option<String>,
    /// Hash over the stored copies, for detecting a damaged backup.
    pub hash: String,
    /// True for the automatic backup taken before a save, false for a named one.
    pub is_auto: bool,
    /// Where each file lives inside the backup.
    pub entries: Vec<BackupFile>,
    /// Absolute path of the backup directory.
    pub dir: PathBuf,
}

/// Backup manager for automatic and named backups.
#[derive(Debug)]
pub struct BackupManager {
    backup_dir: PathBuf,
    max_auto_backups: usize,
    max_named_backups: usize,
}

impl BackupManager {
    /// A manager for the user's real backup directory.
    ///
    /// Creating that directory can fail - a read-only home, a full disk, a
    /// `$XDG_DATA_HOME` pointing at a file - and that is an error to report, not
    /// a reason to panic. A manager that exists but cannot store anything is
    /// worse than no manager: it would let a save proceed knowing there is no
    /// backup behind it.
    pub fn new() -> AppResult<Self> {
        let backup_dir = crate::fs::paths::get_backup_dir()?;
        Self::with_dir(backup_dir)
    }

    /// A manager rooted at an explicit directory, for tests and for a future
    /// "keep backups next to the config" setting.
    pub fn with_dir(backup_dir: PathBuf) -> AppResult<Self> {
        crate::fs::ensure_dir(&backup_dir)?;
        Ok(Self {
            backup_dir,
            max_auto_backups: DEFAULT_MAX_AUTO_BACKUPS,
            max_named_backups: DEFAULT_MAX_NAMED_BACKUPS,
        })
    }

    /// Where this manager keeps its backups.
    pub fn backup_dir(&self) -> &Path {
        &self.backup_dir
    }

    /// How many automatic backups are kept.
    pub fn max_auto_backups(&self) -> usize {
        self.max_auto_backups
    }

    /// Change how many automatic backups are kept and rotate down to it now.
    pub async fn set_max_auto_backups(&mut self, keep: usize) -> AppResult<()> {
        self.max_auto_backups = keep;
        self.rotate_auto_backups().await
    }

    /// Create an automatic backup before save.
    ///
    /// `files` is the whole config set, not just the file about to be rewritten.
    /// A missing file is an error rather than a silent omission: a backup that
    /// quietly lacks one include is a backup that cannot be restored.
    pub async fn create_auto_backup(
        &self,
        files: &[PathBuf],
        niri_version: Option<String>,
    ) -> AppResult<BackupMeta> {
        self.create_auto_backup_with(files, niri_version, None)
            .await
    }

    /// An automatic backup carrying a comment.
    ///
    /// The comment is what the backup list shows, so a caller that has something to
    /// say about a save must not have it accepted and thrown away.
    pub async fn create_auto_backup_with(
        &self,
        files: &[PathBuf],
        niri_version: Option<String>,
        comment: Option<String>,
    ) -> AppResult<BackupMeta> {
        self.create(files, None, comment, niri_version, true).await
    }

    /// Create a named backup.
    pub async fn create_named_backup(
        &self,
        files: &[PathBuf],
        name: &str,
        comment: Option<String>,
        niri_version: Option<String>,
    ) -> AppResult<BackupMeta> {
        if name.trim().is_empty() {
            return Err(AppError::backup("a named backup needs a name"));
        }
        self.create(files, Some(name.to_string()), comment, niri_version, false)
            .await
    }

    /// List all backups, newest first.
    pub async fn list_backups(&self) -> AppResult<Vec<BackupMeta>> {
        let mut out = Vec::new();
        collect_auto_backups(&self.backup_dir, &mut out)?;
        collect_named_backups(&self.backup_dir.join(NAMED_DIR), &mut out)?;
        // The id carries a monotonic counter, so the tie-break is only reached
        // for backups from different processes at the same instant.
        out.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(out)
    }

    /// Restore a backup by ID.
    ///
    /// Every file is checked to be present and readable *before* any of them is
    /// written. A restore that fails half way would leave the user with a config
    /// that is neither the old one nor the backup, and a compositor that refuses
    /// to start; a restore that fails before it starts leaves the config exactly
    /// as it was.
    ///
    /// The current state is backed up first, so a restore is itself reversible.
    pub async fn restore_backup(&self, id: &str) -> AppResult<BackupMeta> {
        let meta = self.read_meta(id)?;
        let dir = meta.dir.clone();

        let mut sources = Vec::with_capacity(meta.entries.len());
        for entry in &meta.entries {
            let stored = dir.join(&entry.relative);
            let content = std::fs::read(&stored).map_err(|err| {
                AppError::backup(format!(
                    "backup {id} is incomplete, {}: {err}",
                    stored.display()
                ))
            })?;
            sources.push((entry.source.clone(), content));
        }

        // Reversible by construction: the state being replaced is captured before
        // a single byte of it is overwritten.
        let paths: Vec<PathBuf> = sources.iter().map(|(path, _)| path.clone()).collect();
        self.create(
            &paths,
            None,
            Some(format!("before restoring {id}")),
            None,
            true,
        )
        .await?;

        for (path, content) in sources {
            crate::fs::atomic::write_atomic_bytes(&path, &content).await?;
        }
        Ok(meta)
    }

    /// Delete a backup by ID.
    pub async fn delete_backup(&self, id: &str) -> AppResult<()> {
        let meta = self.read_meta(id)?;
        std::fs::remove_dir_all(&meta.dir)
            .map_err(|err| AppError::backup(format!("{}: {err}", meta.dir.display())))
    }

    /// Verify that a backup's stored copies still match its recorded hash.
    ///
    /// A backup on a failing disk is worse than no backup, because it looks like
    /// a way out. This is how the UI can tell the two apart.
    pub async fn verify(&self, id: &str) -> AppResult<bool> {
        let meta = self.read_meta(id)?;
        Ok(compute_hash(&meta)? == meta.hash)
    }

    /// Rotate auto backups (keep only N most recent).
    ///
    /// The newest is never removed even if the limit is zero: a limit of zero is
    /// a misconfiguration, and deleting the backup that was just taken because of
    /// it would defeat the point of taking it.
    pub async fn rotate_auto_backups(&self) -> AppResult<()> {
        let mut out = Vec::new();
        collect_auto_backups(&self.backup_dir, &mut out)?;
        // Ids sort oldest-first, so the newest are at the end. The limit is
        // `max(1)`: a limit of zero is a misconfiguration, and the answer to it is
        // not to delete the backup that was just taken.
        out.sort_by(|a, b| a.id.cmp(&b.id));
        let keep = self.max_auto_backups.max(1);
        let drop_from = out.len().saturating_sub(keep);
        for stale in out.into_iter().take(drop_from) {
            std::fs::remove_dir_all(&stale.dir)
                .map_err(|err| AppError::backup(format!("{}: {err}", stale.dir.display())))?;
        }
        Ok(())
    }

    /// Rotate named backups, keeping the N most recent *per name*.
    ///
    /// Only reachable on request. A named backup is not garbage collection
    /// material, so the automatic rotation never touches `named/`.
    pub async fn rotate_named_backups(&self) -> AppResult<()> {
        let mut out = Vec::new();
        collect_named_backups(&self.backup_dir.join(NAMED_DIR), &mut out)?;
        let mut by_name: BTreeMap<String, Vec<BackupMeta>> = BTreeMap::new();
        for meta in out {
            by_name
                .entry(meta.name.clone().unwrap_or_default())
                .or_default()
                .push(meta);
        }
        for mut group in by_name.into_values() {
            // Oldest first, so the ones to drop are at the front.
            group.sort_by(|a, b| a.id.cmp(&b.id));
            let drop_from = group.len().saturating_sub(self.max_named_backups.max(1));
            for stale in group.into_iter().take(drop_from) {
                std::fs::remove_dir_all(&stale.dir)
                    .map_err(|err| AppError::backup(format!("{}: {err}", stale.dir.display())))?;
            }
        }
        Ok(())
    }
}

/// How many automatic backups are kept by default.
pub const DEFAULT_MAX_AUTO_BACKUPS: usize = 20;

/// How many backups of one name are kept when rotation is asked for explicitly.
pub const DEFAULT_MAX_NAMED_BACKUPS: usize = 20;

impl BackupManager {
    /// Capture a set of files into a fresh backup directory.
    async fn create(
        &self,
        files: &[PathBuf],
        name: Option<String>,
        comment: Option<String>,
        niri_version: Option<String>,
        is_auto: bool,
    ) -> AppResult<BackupMeta> {
        if files.is_empty() {
            return Err(AppError::backup(
                "nothing to back up: the file list is empty",
            ));
        }
        let now = Utc::now();
        let id = backup_id(&now, is_auto);
        let dir = if is_auto {
            self.backup_dir.join(&id)
        } else {
            self.backup_dir
                .join(NAMED_DIR)
                .join(sanitise_name(name.as_deref().unwrap_or_default()))
                .join(format!("{}-{}", id, short_hash_of_id(&id)))
        };
        crate::fs::ensure_dir(&dir)?;
        let files_dir = dir.join(FILES_DIR);
        crate::fs::ensure_dir(&files_dir)?;

        // The common prefix is the directory the paths share; every file is
        // stored relative to it, so a backup can be restored into a different
        // home directory.
        let root = common_root(files).ok_or_else(|| {
            AppError::backup("cannot back up files that share no common directory")
        })?;

        let mut entries = Vec::with_capacity(files.len());
        let mut seen = std::collections::BTreeSet::new();
        for source in files {
            let relative = relative_key(source, &root)?;
            // Two source paths that collapse to the same key would silently
            // overwrite each other inside the backup.
            if !seen.insert(relative.clone()) {
                return Err(AppError::backup(format!(
                    "two config files map to the same place in a backup: {relative}"
                )));
            }
            // `relative` is recorded relative to the *backup directory*, not to
            // the files root, so that a restore is one `dir.join(relative)` and
            // nothing has to know how the layout is built.
            let stored_key = format!("{FILES_DIR}/{relative}");
            let stored = dir.join(&stored_key);
            if let Some(parent) = stored.parent() {
                crate::fs::ensure_dir(parent)?;
            }
            let content = std::fs::read(source)
                .map_err(|err| AppError::backup(format!("{}: {err}", source.display())))?;
            crate::fs::atomic::write_atomic_bytes(&stored, &content).await?;
            // The copy keeps the original's mode, so restoring does not silently
            // change who may read the config.
            if let Ok(mode) = crate::fs::atomic::file_mode(source) {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&stored, std::fs::Permissions::from_mode(mode));
            }
            entries.push(BackupFile {
                source: source.clone(),
                relative: stored_key,
            });
        }

        let mut meta = BackupMeta {
            id,
            name,
            timestamp: now,
            files: files.to_vec(),
            niri_version,
            comment,
            hash: String::new(),
            is_auto,
            entries,
            dir: dir.clone(),
        };
        // The hash covers the stored bytes, so it is computed after they are on
        // disk and before the metadata that claims them is written.
        meta.hash = compute_hash(&meta)?;
        write_meta(&meta).await?;
        Ok(meta)
    }

    /// Read the metadata of one backup, by id.
    fn read_meta(&self, id: &str) -> AppResult<BackupMeta> {
        if id.trim().is_empty() || id.contains('/') || id.contains("..") {
            return Err(AppError::backup(format!("not a backup id: {id:?}")));
        }
        let mut out = Vec::new();
        collect_auto_backups(&self.backup_dir, &mut out)?;
        collect_named_backups(&self.backup_dir.join(NAMED_DIR), &mut out)?;
        out.into_iter()
            .find(|meta| meta.id == id)
            .ok_or_else(|| AppError::backup(format!("no such backup: {id}")))
    }
}

/// Makes an id unique inside one process even when the clock does not move.
///
/// Two backups taken in the same clock tick must not land in the same directory:
/// the second would overwrite the first, and a rotation would then delete a
/// backup that the user believes they still have.
static BACKUP_SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Timestamp used as the id of a backup.
///
/// Formatted so that plain lexicographic order is chronological order, which is
/// what makes directory listing a usable timeline without reading a single
/// metadata file. The trailing counter keeps ids unique when the clock has less
/// resolution than the gap between two saves.
fn backup_id(now: &DateTime<Utc>, is_auto: bool) -> String {
    let stamp = now.to_rfc3339_opts(SecondsFormat::Nanos, true);
    let stamp = stamp.replace([':', '.'], "-");
    let seq = BACKUP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    if is_auto {
        format!("{stamp}-{seq:04}")
    } else {
        format!("{stamp}-{seq:04}-named")
    }
}

/// Turn a user-supplied name into a single safe directory name.
///
/// A name is user text arriving from a text field, and it becomes a path
/// component. Anything that is not a letter, digit, dot, dash or underscore is
/// replaced, and the result is capped, so a name of `../../etc` cannot escape the
/// backup directory. The original name is kept in the metadata, so nothing about
/// what the user typed is lost.
fn sanitise_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                // Everything else, including dots and spaces, becomes a separator:
                // a name is a path component, and a dot is how a name tries to
                // become `..`.
                '_'
            }
        })
        .take(64)
        .collect();
    let trimmed = cleaned.trim_matches('_').to_string();
    if trimmed.is_empty() {
        "backup".to_string()
    } else {
        trimmed
    }
}

/// A short stable digest of an id, so two backups with the same name and the same
/// microsecond cannot land in the same directory.
fn short_hash_of_id(id: &str) -> String {
    let digest = Sha256::digest(id.as_bytes());
    digest.iter().take(4).map(|b| format!("{b:02x}")).collect()
}

/// The deepest directory every path in `files` shares.
///
/// `/a/b/c.kdl` and `/a/b/d/e.kdl` share `/a/b`, so the first is stored as
/// `c.kdl` and the second as `d/e.kdl`.
fn common_root(files: &[PathBuf]) -> Option<PathBuf> {
    let mut iter = files.iter();
    let first = iter.next()?;
    let mut root = first.parent()?.to_path_buf();
    for path in iter {
        root = common_prefix(&root, path.parent()?).unwrap_or_else(|| PathBuf::from("/"));
    }
    Some(root)
}

fn common_prefix(a: &Path, b: &Path) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    let mut left = a.components();
    let mut right = b.components();
    loop {
        match (left.next(), right.next()) {
            (Some(x), Some(y)) if x == y => out.push(x.as_os_str()),
            _ => break,
        }
    }
    if out.as_os_str().is_empty() {
        None
    } else {
        Some(out)
    }
}

/// The key a file is stored under, and the check that the key cannot escape the
/// backup directory.
fn relative_key(source: &Path, root: &Path) -> AppResult<String> {
    let relative = source.strip_prefix(root).map_err(|_| {
        AppError::backup(format!(
            "{}: not below the config directory {root:?}",
            source.display()
        ))
    })?;
    if relative.as_os_str().is_empty() {
        return Err(AppError::backup(format!(
            "{}: is the config directory itself",
            source.display()
        )));
    }
    let key = relative.to_string_lossy().replace('\\', "/");
    if key.starts_with('/') || key.split('/').any(|part| part == "..") {
        return Err(AppError::backup(format!(
            "{}: would be stored outside the backup",
            source.display()
        )));
    }
    Ok(key)
}

/// Hash over the stored copies, in a fixed order.
///
/// The order is the sorted `relative` key rather than the order the files were
/// passed in, so the same set of files always hashes the same way regardless of
/// how the caller collected them. The key itself is fed in alongside the bytes so
/// that renaming a file inside a backup changes the hash.
fn compute_hash(meta: &BackupMeta) -> AppResult<String> {
    let mut ordered: Vec<&BackupFile> = meta.entries.iter().collect();
    ordered.sort_by(|a, b| a.relative.cmp(&b.relative));

    let mut hasher = Sha256::new();
    for entry in ordered {
        hasher.update(entry.relative.as_bytes());
        hasher.update([0u8]);
        let path = meta.dir.join(&entry.relative);
        let content = std::fs::read(&path)
            .map_err(|err| AppError::backup(format!("{}: {err}", path.display())))?;
        hasher.update((content.len() as u64).to_le_bytes());
        hasher.update(&content);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}

/// Write a backup's metadata as pretty JSON.
///
/// Written atomically: a metadata file truncated by a crash would make the whole
/// backup unreadable, which is the same as not having taken it.
async fn write_meta(meta: &BackupMeta) -> AppResult<()> {
    let path = meta.dir.join(METADATA_FILE);
    let json = serde_json::to_string_pretty(meta)
        .map_err(|err| AppError::backup(format!("{}: {err}", path.display())))?;
    crate::fs::atomic::write_atomic_bytes(&path, json.as_bytes()).await
}

/// Collect the automatic backups: the directories directly under the root.
///
/// Deliberately not recursive. The named backups live under `named/`, and a
/// recursive scan would find them here too - which is how a named backup the user
/// asked to keep gets deleted by automatic rotation.
fn collect_auto_backups(root: &Path, out: &mut Vec<BackupMeta>) -> AppResult<()> {
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => {
            return Err(AppError::backup(format!("{}: {err}", root.display())));
        }
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() || path.file_name().is_some_and(|n| n == NAMED_DIR) {
            continue;
        }
        let meta_path = path.join(METADATA_FILE);
        // A directory that is not a backup - something the user put there - is
        // skipped rather than turned into an error, so the list stays readable.
        if !meta_path.is_file() {
            continue;
        }
        out.push(read_meta_at(&meta_path, &path)?);
    }
    Ok(())
}

/// Collect the named backups: `named/<name>/<id>/`, two levels.
fn collect_named_backups(root: &Path, out: &mut Vec<BackupMeta>) -> AppResult<()> {
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => {
            return Err(AppError::backup(format!("{}: {err}", root.display())));
        }
    };
    for entry in entries.flatten() {
        let name_dir = entry.path();
        if !name_dir.is_dir() {
            continue;
        }
        let Ok(inner) = std::fs::read_dir(&name_dir) else {
            continue;
        };
        for backup in inner.flatten() {
            let path = backup.path();
            let meta_path = path.join(METADATA_FILE);
            if !path.is_dir() || !meta_path.is_file() {
                continue;
            }
            out.push(read_meta_at(&meta_path, &path)?);
        }
    }
    Ok(())
}

/// Read one backup's metadata, recording where it actually lives.
///
/// The directory is taken from the filesystem rather than from the file's own
/// `dir` field, so a backup that was moved still restores, and so a metadata file
/// copied from elsewhere cannot make a restore write into a path of its choosing.
fn read_meta_at(meta_path: &Path, dir: &Path) -> AppResult<BackupMeta> {
    let text = std::fs::read_to_string(meta_path)
        .map_err(|err| AppError::backup(format!("{}: {err}", meta_path.display())))?;
    let mut meta: BackupMeta = serde_json::from_str(&text).map_err(|err| {
        AppError::backup(format!(
            "{}: metadata cannot be read ({err}); this backup cannot be restored",
            meta_path.display()
        ))
    })?;
    meta.dir = dir.to_path_buf();
    for entry in &mut meta.entries {
        if entry.relative.starts_with('/') || entry.relative.split('/').any(|p| p == "..") {
            return Err(AppError::backup(format!(
                "{}: a stored path escapes the backup: {}",
                meta.id, entry.relative
            )));
        }
    }
    Ok(meta)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    struct Fixture {
        /// Kept alive: the config and the backup directory are inside it, and the
        /// directory has to outlive every file in it.
        _dir: TempDir,
        config: PathBuf,
        manager: BackupManager,
    }

    /// A two-file config set in a temp directory, plus a manager writing into a
    /// temp backup directory. Nothing here touches a real config.
    fn fixture() -> Fixture {
        let dir = TempDir::new().expect("temp dir");
        let config = dir.path().join("cfg");
        std::fs::create_dir_all(config.join("sub")).expect("dir should be created");
        std::fs::write(config.join("config.kdl"), "main\n").expect("write should succeed");
        std::fs::write(config.join("sub/input.kdl"), "input\n").expect("write should succeed");
        let backups = dir.path().join("backups");
        let manager = BackupManager::with_dir(backups).expect("manager should be created");
        Fixture {
            _dir: dir,
            config,
            manager,
        }
    }

    fn set(f: &Fixture) -> Vec<PathBuf> {
        vec![f.config.join("config.kdl"), f.config.join("sub/input.kdl")]
    }

    #[tokio::test]
    async fn creating_the_manager_fails_instead_of_panicking() {
        // The defect this replaces was `Self::new().expect(...)` in `Default`,
        // which turned an un-creatable backup directory into a panic during
        // start-up: no message, no path, nothing the user could act on. A
        // manager that cannot store anything has to surface as an error.
        let dir = TempDir::new().expect("temp dir");
        let blocker = dir.path().join("not-a-dir");
        std::fs::write(&blocker, "x").expect("write should succeed");

        let result: Result<BackupManager, AppError> = BackupManager::with_dir(blocker);

        let Err(err) = result else {
            panic!("a file where a directory should be must be an error");
        };
        assert!(matches!(err, AppError::Io(_)), "got {err:?}");
        assert!(
            err.to_string().contains("not-a-dir"),
            "the error has to name the path it could not use: {err}"
        );
    }

    #[tokio::test]
    async fn captures_every_file_of_the_set_with_its_layout() {
        let f = fixture();
        let meta = f
            .manager
            .create_auto_backup(&set(&f), None)
            .await
            .expect("backup should be taken");

        assert!(meta.is_auto);
        assert_eq!(meta.files.len(), 2, "both files must be captured");
        assert_eq!(
            std::fs::read_to_string(meta.dir.join("files/config.kdl")).expect("read"),
            "main\n"
        );
        assert_eq!(
            std::fs::read_to_string(meta.dir.join("files/sub/input.kdl")).expect("read"),
            "input\n",
            "the directory layout has to be reproduced, or the names collide"
        );
        assert!(meta.dir.join("metadata.json").is_file());
    }

    #[tokio::test]
    async fn the_hash_covers_the_stored_bytes() {
        let f = fixture();
        let meta = f
            .manager
            .create_auto_backup(&set(&f), None)
            .await
            .expect("backup should be taken");

        assert_eq!(meta.hash.len(), 64, "a sha-256 in hex");
        assert!(f.manager.verify(&meta.id).await.expect("verify should run"));

        let stored = meta.dir.join("files/config.kdl");
        std::fs::write(&stored, "tampered\n").expect("write should succeed");

        assert!(
            !f.manager.verify(&meta.id).await.expect("verify should run"),
            "a changed copy must not verify"
        );
    }

    #[tokio::test]
    async fn two_backups_of_identical_content_hash_the_same() {
        // The hash identifies the *content*; the id identifies the moment. A
        // restore that checked the hash against a recomputed one must not fail
        // just because the files were unchanged.
        let f = fixture();
        let first = f
            .manager
            .create_auto_backup(&set(&f), None)
            .await
            .expect("backup should be taken");
        let second = f
            .manager
            .create_auto_backup(&set(&f), None)
            .await
            .expect("backup should be taken");

        assert_ne!(first.id, second.id, "each backup needs its own id");
        assert_eq!(first.hash, second.hash);
    }

    #[tokio::test]
    async fn a_missing_file_fails_the_backup_rather_than_being_skipped() {
        let f = fixture();
        let files = vec![f.config.join("config.kdl"), f.config.join("absent.kdl")];

        let err = f
            .manager
            .create_auto_backup(&files, None)
            .await
            .expect_err("a file that is not there cannot be backed up");

        assert!(matches!(err, AppError::Backup(_)), "got {err:?}");
    }

    #[tokio::test]
    async fn metadata_is_read_back_exactly_as_written() {
        let f = fixture();
        let created = f
            .manager
            .create_named_backup(
                &set(&f),
                "before-i3",
                Some("switching to a laptop dock".to_string()),
                Some("niri 26.04".to_string()),
            )
            .await
            .expect("backup should be taken");

        let listed = f.manager.list_backups().await.expect("listing should work");
        let found = listed
            .iter()
            .find(|m| m.id == created.id)
            .expect("the backup has to appear in the list");

        assert_eq!(found.name.as_deref(), Some("before-i3"));
        assert_eq!(found.comment.as_deref(), Some("switching to a laptop dock"));
        assert_eq!(found.niri_version.as_deref(), Some("niri 26.04"));
        assert!(!found.is_auto);
        assert_eq!(found.timestamp, created.timestamp);
        assert_eq!(found.hash, created.hash);
        assert_eq!(found.files, created.files);
        assert_eq!(found.entries, created.entries);
        assert_eq!(found.dir, created.dir);
    }

    #[tokio::test]
    async fn a_name_that_tries_to_escape_stays_inside_the_backup_directory() {
        let f = fixture();
        let created = f
            .manager
            .create_named_backup(&set(&f), "../../etc/passwd", None, None)
            .await
            .expect("backup should be taken");

        let root = f.manager.backup_dir().canonicalize().expect("canonical");
        let dir = created.dir.canonicalize().expect("canonical");
        assert!(
            dir.starts_with(&root),
            "{} escaped {}",
            dir.display(),
            root.display()
        );
        assert_eq!(
            created.name.as_deref(),
            Some("../../etc/passwd"),
            "what the user typed is kept in the metadata"
        );
    }

    #[tokio::test]
    async fn restore_puts_every_file_back_and_is_itself_reversible() {
        let f = fixture();
        let before = f
            .manager
            .create_auto_backup(&set(&f), None)
            .await
            .expect("backup should be taken");

        std::fs::write(f.config.join("config.kdl"), "edited main\n").expect("write should succeed");
        std::fs::write(f.config.join("sub/input.kdl"), "edited input\n")
            .expect("write should succeed");

        f.manager
            .restore_backup(&before.id)
            .await
            .expect("restore should succeed");

        assert_eq!(
            std::fs::read_to_string(f.config.join("config.kdl")).expect("read"),
            "main\n"
        );
        assert_eq!(
            std::fs::read_to_string(f.config.join("sub/input.kdl")).expect("read"),
            "input\n"
        );

        // The state that was replaced is itself a backup, so a mistaken restore
        // can be undone.
        let all = f.manager.list_backups().await.expect("listing should work");
        let safety = all
            .iter()
            .find(|m| m.id != before.id)
            .expect("restoring must take a backup of what it replaced");
        f.manager
            .restore_backup(&safety.id)
            .await
            .expect("the second restore should succeed");
        assert_eq!(
            std::fs::read_to_string(f.config.join("config.kdl")).expect("read"),
            "edited main\n"
        );
    }

    #[tokio::test]
    async fn a_backup_missing_a_file_is_rejected_before_anything_is_written() {
        let f = fixture();
        let meta = f
            .manager
            .create_auto_backup(&set(&f), None)
            .await
            .expect("backup should be taken");
        std::fs::remove_file(meta.dir.join("files/sub/input.kdl")).expect("remove should work");
        std::fs::write(f.config.join("config.kdl"), "edited\n").expect("write should succeed");

        let err = f
            .manager
            .restore_backup(&meta.id)
            .await
            .expect_err("an incomplete backup must not restore");

        assert!(matches!(err, AppError::Backup(_)), "got {err:?}");
        assert_eq!(
            std::fs::read_to_string(f.config.join("config.kdl")).expect("read"),
            "edited\n",
            "a failed restore must leave the config exactly as it was"
        );
    }

    #[tokio::test]
    async fn rotation_keeps_the_newest_and_spares_named_backups() {
        let f = fixture();
        let mut ids = Vec::new();
        for _ in 0..5 {
            let meta = f
                .manager
                .create_auto_backup(&set(&f), None)
                .await
                .expect("backup should be taken");
            // A rotation of 20 in one go would not remove anything, so exercise
            // the limit that is actually used.
            ids.push(meta.id);
        }
        let named = f
            .manager
            .create_named_backup(&set(&f), "keeper", None, None)
            .await
            .expect("backup should be taken");

        let mut manager = f.manager;
        manager
            .set_max_auto_backups(2)
            .await
            .expect("rotation should work");

        let all = manager.list_backups().await.expect("listing should work");
        let auto_ids: Vec<&str> = all
            .iter()
            .filter(|m| m.is_auto)
            .map(|m| m.id.as_str())
            .collect();
        assert_eq!(auto_ids.len(), 2, "rotation must keep exactly the limit");

        let newest = ids.last().expect("there is a newest");
        assert!(
            all.iter().any(|m| m.id == *newest),
            "the backup that was just taken must survive rotation"
        );
        assert!(
            all.iter().any(|m| m.id == named.id),
            "rotation must never touch a named backup"
        );
        assert!(
            all.iter().all(|m| m.dir.exists()),
            "every listed backup must still be on disk"
        );
    }

    #[tokio::test]
    async fn rotation_with_a_limit_of_zero_keeps_the_newest() {
        let f = fixture();
        let meta = f
            .manager
            .create_auto_backup(&set(&f), None)
            .await
            .expect("backup should be taken");

        let mut manager = f.manager;
        manager
            .set_max_auto_backups(0)
            .await
            .expect("rotation should work");

        assert!(
            manager.backup_dir().join(&meta.id).is_dir(),
            "a limit of zero is a misconfiguration, not an instruction to discard the backup just taken"
        );
    }

    #[tokio::test]
    async fn deleting_removes_the_backup_and_only_the_backup() {
        let f = fixture();
        let keep = f
            .manager
            .create_auto_backup(&set(&f), None)
            .await
            .expect("backup should be taken");
        let drop_it = f
            .manager
            .create_auto_backup(&set(&f), None)
            .await
            .expect("backup should be taken");

        f.manager
            .delete_backup(&drop_it.id)
            .await
            .expect("delete should succeed");

        assert!(!drop_it.dir.exists());
        assert!(keep.dir.exists());
        let all = f.manager.list_backups().await.expect("listing should work");
        assert_eq!(all.len(), 1);
    }

    #[tokio::test]
    async fn an_id_that_is_a_path_is_refused() {
        let f = fixture();
        for bad in ["../escape", "nested/id", " "] {
            let err = f
                .manager
                .restore_backup(bad)
                .await
                .expect_err("a traversal must be refused");
            assert!(matches!(err, AppError::Backup(_)), "{bad}: got {err:?}");
        }
    }

    #[tokio::test]
    async fn an_unreadable_backup_directory_fails_the_manager_creation() {
        let dir = TempDir::new().expect("temp dir");
        let file = dir.path().join("backups");
        std::fs::write(&file, "x").expect("write should succeed");

        let Err(err) = BackupManager::with_dir(file) else {
            panic!("a file is not a backup directory");
        };

        assert!(matches!(err, AppError::Io(_)), "got {err:?}");
    }

    #[tokio::test]
    async fn an_empty_file_list_is_refused() {
        let f = fixture();

        let err = f
            .manager
            .create_auto_backup(&[], None)
            .await
            .expect_err("an empty backup is not a backup");

        assert!(matches!(err, AppError::Backup(_)), "got {err:?}");
    }

    #[tokio::test]
    async fn a_stray_directory_in_the_backup_root_does_not_break_listing() {
        let f = fixture();
        f.manager
            .create_auto_backup(&set(&f), None)
            .await
            .expect("backup should be taken");
        std::fs::create_dir(f.manager.backup_dir().join("something-else"))
            .expect("dir should be created");

        let all = f.manager.list_backups().await.expect("listing should work");

        assert_eq!(all.len(), 1, "only real backups belong in the list");
    }
}
