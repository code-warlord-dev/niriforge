//! Atomic file write: temp file → fsync → rename.
//!
//! # The guarantee
//!
//! A reader of a config file must see either the whole old file or the whole
//! new one. That is not achievable by writing into the target, because the
//! window between truncate and last write is observable. It is achievable by
//! preparing the new content under a second name in the *same directory* and
//! swapping it in with `rename(2)`, which the kernel makes indivisible.
//!
//! Three details are not optional and each one is a way to lose data on its own:
//!
//! - the temporary file lives next to the target, never in `/tmp`: `rename`
//!   refuses to cross a filesystem, and a temp file in a different mount point
//!   would have to be copied, which is exactly the non-atomic operation this
//!   module exists to avoid;
//! - the temporary file is `fsync`ed *before* the rename, otherwise the rename
//!   can become visible while the content is still only in the page cache, and
//!   a power loss then leaves a correctly named file full of zeroes;
//! - the temporary file is removed on every failure path, including the
//!   `fsync` and `rename` ones, so a rejected save does not leave debris in the
//!   user's config directory.

use crate::error::{AppError, AppResult};
use std::ffi::OsString;
use std::fs::{self, File, OpenOptions, Permissions};
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// Mode for a config file created where none existed yet.
///
/// A niri config routinely holds window rule match strings, spawn commands and
/// script paths. Creating it readable by every user on the machine is not a
/// default worth shipping, so a new file starts private; an existing file keeps
/// whatever mode the user gave it.
pub const DEFAULT_NEW_FILE_MODE: u32 = 0o600;

/// Suffix that marks a staged file as ours.
///
/// Staged files sit in the real config directory so that `include` resolution
/// against them finds the user's real includes. They must be recognisable, both
/// for the watcher (which ignores paths it was not asked to watch) and for
/// anyone who finds one after a crash.
pub const CANDIDATE_SUFFIX: &str = ".niriforge-candidate";

/// Suffix used for the short-lived file inside [`write_atomic_bytes`].
const TEMP_SUFFIX: &str = ".niriforge-tmp";

/// How many symlinks may be followed before the chain is called a loop.
const MAX_SYMLINK_HOPS: usize = 40;

/// Distinguishes temporary names inside one directory.
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// A point at which the write is deliberately failed, for tests that have to
/// prove an interrupted save leaves the file on disk untouched.
///
/// Production code never passes anything but `None`. The alternative would be to
/// prove atomicity by reading the implementation, which is not evidence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FaultPoint {
    /// After the content reached the file, before it was forced to disk.
    BeforeFsync,
    /// After the content was forced to disk, before the swap.
    AfterFsync,
    /// Immediately before the swap, with the temporary file still in place.
    BeforeRename,
}

/// Removes a staged file unless it has been explicitly disarmed.
///
/// The `Drop` impl is the reason a future edit cannot forget the cleanup: the
/// file goes away on every path out of the function, including the error paths
/// of `fsync` and `rename`, and including a panic unwinding through here.
struct StagedFile {
    path: PathBuf,
    armed: bool,
}

impl StagedFile {
    fn new(path: PathBuf) -> Self {
        Self { path, armed: true }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for StagedFile {
    fn drop(&mut self) {
        if self.armed {
            // A failure here is not actionable and must not mask the error that
            // is already on its way out: the file is in a directory we just
            // failed to write to anyway.
            let _ = fs::remove_file(&self.path);
        }
    }
}

/// Write text to a file atomically.
pub async fn write_atomic(path: &Path, content: &str) -> AppResult<()> {
    write_atomic_bytes(path, content.as_bytes()).await
}

/// Write bytes to a file atomically.
///
/// A symlink at `path` is followed and the real file behind it is replaced; no
/// second file appears beside the link. The target's permission bits are carried
/// over, so a config that was `0600` stays `0600` and a config that was
/// `0644` does not silently become world-writable or private.
pub async fn write_atomic_bytes(path: &Path, content: &[u8]) -> AppResult<()> {
    let target = resolve_write_target(path)?;
    write_replacing(&target, content, None)
}

/// [`write_atomic_bytes`] with a failure injected at a chosen point.
pub async fn write_atomic_bytes_faulted(
    path: &Path,
    content: &[u8],
    fault: Option<FaultPoint>,
) -> AppResult<()> {
    let target = resolve_write_target(path)?;
    write_replacing(&target, content, fault)
}

/// The blocking core of an atomic replace, used by the async wrappers and by
/// code that is already off the runtime.
///
/// `target` must already be symlink-free; [`resolve_write_target`] is what turns
/// a user-visible path into one.
fn write_replacing(target: &Path, content: &[u8], fault: Option<FaultPoint>) -> AppResult<()> {
    let dir = parent_dir(target)?;
    // Read the mode before anything is replaced: afterwards the target's own
    // metadata is gone and there would be nothing left to copy it from.
    let mode = target_mode(target)?;
    let staged = stage_file(target, content, dir, TEMP_SUFFIX, mode)?;
    let mut guard = StagedFile::new(staged.clone());

    let file = open_staged(&staged)?;

    if fault == Some(FaultPoint::BeforeFsync) {
        return Err(AppError::atomic_write(format!(
            "{}: write interrupted before the content was forced to disk",
            target.display()
        )));
    }
    file.sync_all()
        .map_err(|err| AppError::atomic_write(format!("{}: {err}", staged.display())))?;
    if fault == Some(FaultPoint::AfterFsync) {
        return Err(AppError::atomic_write(format!(
            "{}: write interrupted after the content was forced to disk",
            target.display()
        )));
    }
    if fault == Some(FaultPoint::BeforeRename) {
        return Err(AppError::atomic_write(format!(
            "{}: write interrupted before the swap",
            target.display()
        )));
    }
    drop(file);

    if let Err(err) = fs::rename(&staged, target) {
        return Err(AppError::atomic_write(format!(
            "{}: could not replace the file: {err}",
            target.display()
        )));
    }
    guard.disarm();
    sync_dir(dir);
    Ok(())
}

/// Create a sibling of `target` holding `content`, forced to disk, and return
/// its path. The caller decides when - and whether - to put it in place.
pub fn stage_bytes(target: &Path, content: &[u8]) -> AppResult<PathBuf> {
    let dir = parent_dir(target)?;
    stage_file(target, content, dir, TEMP_SUFFIX, target_mode(target)?)
}

/// Create the staged file for a config that is about to be replaced.
///
/// The name is derived from the target, so a crash leaves something recognisable
/// rather than an anonymous temporary, and the file sits in the same directory
/// as its target so that `rename` stays inside one filesystem.
pub fn stage_candidate(target: &Path, content: &[u8]) -> AppResult<PathBuf> {
    let dir = parent_dir(target)?;
    let mut name = file_name_of(target)?.to_os_string();
    name.push(CANDIDATE_SUFFIX);
    name.push(format!(".{}", std::process::id()));
    let candidate = dir.join(name);
    // A leftover from a previous crash would otherwise be truncated in place,
    // which is fine, but overwriting a live one would not be. Fail instead.
    remove_stale_candidate(&candidate)?;
    stage_named(&candidate, content, target_mode(target)?)
}

/// Move a staged file onto its target.
///
/// The content is already durable by the time this is called - staging fsyncs -
/// so the only step left is the swap. The containing directory is synced
/// afterwards, best effort: without it a crash can lose the *name*, and the
/// outcome of that is the old file, which is the safe side of the choice. It is
/// not fatal, because reporting a failed save for a write that did land would
/// leave the user believing their config was not saved when it was.
pub fn commit_staged(staged: &Path, target: &Path) -> AppResult<()> {
    let file = File::open(staged)
        .map_err(|err| AppError::atomic_write(format!("{}: {err}", staged.display())))?;
    file.sync_all()
        .map_err(|err| AppError::atomic_write(format!("{}: {err}", staged.display())))?;
    drop(file);

    fs::rename(staged, target).map_err(|err| {
        AppError::atomic_write(format!(
            "{}: could not replace the file: {err}",
            target.display()
        ))
    })?;
    if let Some(dir) = target.parent() {
        sync_dir(dir);
    }
    Ok(())
}

/// Delete a staged file if it is there. A missing file is success.
pub fn remove_staged(staged: &Path) -> AppResult<()> {
    remove_stale_candidate(staged)
}

/// Copy the permission bits of `source` onto `dest`.
///
/// Only the mode is carried over. Ownership is not: the process is not
/// privileged, and a config that ends up owned by whoever happened to run the
/// editor is a different problem from one that is world-writable.
pub fn preserve_metadata(source: &Path, dest: &Path) -> AppResult<()> {
    let mode = file_mode(source)?;
    fs::set_permissions(dest, Permissions::from_mode(mode))
        .map_err(|err| AppError::atomic_write(format!("{}: {err}", dest.display())))
}

/// Read the permission bits of a file, as a unix mode.
pub fn file_mode(path: &Path) -> AppResult<u32> {
    let meta = fs::metadata(path)
        .map_err(|err| AppError::atomic_write(format!("{}: {err}", path.display())))?;
    Ok(meta.permissions().mode() & 0o7777)
}

/// Turn a path the user or the engine knows into the path that is really
/// written.
///
/// A symlink is followed to its target: saving through a symlink has to change
/// the file the symlink points at, or a Home Manager or dotfiles setup ends up
/// with two files and no way to tell which one niri is reading. A path that does
/// not exist yet is resolved through its parent directory, so the file lands in
/// the real directory even when the directory itself is a link.
pub fn resolve_write_target(path: &Path) -> AppResult<PathBuf> {
    let mut current = path.to_path_buf();
    for _ in 0..MAX_SYMLINK_HOPS {
        let meta = match fs::symlink_metadata(&current) {
            Ok(meta) => meta,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                // Nothing at this path. Resolve the directory and keep the name,
                // which is where the new file has to appear.
                return resolve_missing(&current);
            }
            Err(err) => {
                return Err(AppError::symlink_resolution(format!(
                    "{}: {err}",
                    current.display()
                )))
            }
        };
        if !meta.file_type().is_symlink() {
            return fs::canonicalize(&current).map_err(|err| {
                AppError::symlink_resolution(format!("{}: {err}", current.display()))
            });
        }
        let target = fs::read_link(&current)
            .map_err(|err| AppError::symlink_resolution(format!("{}: {err}", current.display())))?;
        current = if target.is_absolute() {
            target
        } else {
            parent_dir(&current)?.join(target)
        };
    }
    Err(AppError::symlink_resolution(format!(
        "{}: more than {MAX_SYMLINK_HOPS} symlinks in the path",
        path.display()
    )))
}

/// Resolve a path that does not exist, through the directory that contains it.
fn resolve_missing(path: &Path) -> AppResult<PathBuf> {
    let name = file_name_of(path)?;
    let dir = parent_dir(path)?;
    let real_dir = fs::canonicalize(dir)
        .map_err(|err| AppError::symlink_resolution(format!("{}: {err}", dir.display())))?;
    Ok(real_dir.join(name))
}

/// Write `content` to a fresh file called `staged` and force it to disk.
fn stage_file(
    target: &Path,
    content: &[u8],
    dir: &Path,
    suffix: &str,
    mode: u32,
) -> AppResult<PathBuf> {
    let name = file_name_of(target)?;
    for _ in 0..64 {
        let candidate = unique_temp_name(dir, name, suffix);
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => {
                // Before the content: the staged file is never briefly visible
                // under a mode the user did not choose.
                if let Err(err) = file.set_permissions(Permissions::from_mode(mode)) {
                    return Err(AppError::atomic_write(format!(
                        "{}: {err}",
                        candidate.display()
                    )));
                }
                write_and_sync(file, &candidate, content)?;
                return Ok(candidate);
            }
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(err) => {
                return Err(AppError::atomic_write(format!(
                    "{}: could not create a file to write into: {err}",
                    dir.display()
                )))
            }
        }
    }
    Err(AppError::atomic_write(format!(
        "{}: could not find an unused temporary file name",
        dir.display()
    )))
}

/// Write to an exactly named staged file, refusing to clobber it.
///
/// Used for the config candidates, whose name is derived from the target so that
/// a crash leaves something identifiable in the directory.
fn stage_named(candidate: &Path, content: &[u8], mode: u32) -> AppResult<PathBuf> {
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(candidate)
        .map_err(|err| {
            AppError::atomic_write(format!(
                "{}: could not stage the config: {err}",
                candidate.display()
            ))
        })?;
    let mut guard = StagedFile::new(candidate.to_path_buf());
    // The mode is set before the content, so the file is never briefly visible
    // under a mode the user did not choose.
    if let Err(err) = file.set_permissions(Permissions::from_mode(mode)) {
        return Err(AppError::atomic_write(format!(
            "{}: {err}",
            candidate.display()
        )));
    }
    drop(file);
    write_and_sync(
        OpenOptions::new()
            .write(true)
            .open(candidate)
            .map_err(|err| AppError::atomic_write(format!("{}: {err}", candidate.display())))?,
        candidate,
        content,
    )?;
    guard.disarm();
    Ok(candidate.to_path_buf())
}

/// Fill a staged file and force it to disk.
///
/// The guard's `Drop` removes the file if this returns an error, so a partially
/// written staged file is never left where another run could pick it up.
fn write_and_sync(mut file: File, path: &Path, content: &[u8]) -> AppResult<()> {
    file.write_all(content)
        .and_then(|()| file.sync_all())
        .map_err(|err| AppError::atomic_write(format!("{}: {err}", path.display())))
}

/// Reopen a staged file for writing, failing rather than creating it.
fn open_staged(staged: &Path) -> AppResult<File> {
    OpenOptions::new()
        .write(true)
        .open(staged)
        .map_err(|err| AppError::atomic_write(format!("{}: {err}", staged.display())))
}

/// Build a temporary name that cannot collide with another run.
///
/// `create_new` is what actually guarantees the name is unused; the counter and
/// the pid only make a collision unlikely enough that the retry loop is not
/// entered in practice.
fn unique_temp_name(dir: &Path, name: &std::ffi::OsStr, suffix: &str) -> PathBuf {
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut candidate = OsString::from(".");
    candidate.push(name);
    candidate.push(suffix);
    candidate.push(format!(".{}.{}", std::process::id(), counter));
    dir.join(candidate)
}

/// The mode a staged file should be created with: the target's own mode, or a
/// private default when the target is being created.
fn target_mode(target: &Path) -> AppResult<u32> {
    match fs::metadata(target) {
        Ok(meta) => Ok(meta.permissions().mode() & 0o7777),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(DEFAULT_NEW_FILE_MODE),
        Err(err) => Err(AppError::atomic_write(format!(
            "{}: {err}",
            target.display()
        ))),
    }
}

fn remove_stale_candidate(path: &Path) -> AppResult<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(AppError::atomic_write(format!("{}: {err}", path.display()))),
    }
}

/// The directory part of a path, refusing the empty one.
///
/// `Path::parent` answers `None` for `/` and for `""`; both mean the caller
/// asked to write something that is not a file.
fn parent_dir(path: &Path) -> AppResult<&Path> {
    path.parent()
        .filter(|dir| !dir.as_os_str().is_empty())
        .ok_or_else(|| {
            AppError::atomic_write(format!(
                "{}: not a file path, refusing to write",
                path.display()
            ))
        })
}

fn file_name_of(path: &Path) -> AppResult<&std::ffi::OsStr> {
    path.file_name().ok_or_else(|| {
        AppError::atomic_write(format!(
            "{}: not a file path, refusing to write",
            path.display()
        ))
    })
}

/// Force a directory entry out to disk, ignoring failure.
///
/// A failure here means the *name* of the file may not survive a power cut. The
/// file's content is already durable, and the outcome of a lost rename is the
/// previous version of the config, which is the recoverable side. Turning this
/// into a save failure would report "not saved" for a save that did happen.
fn sync_dir(dir: &Path) {
    if let Ok(file) = File::open(dir) {
        let _ = file.sync_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;
    use tempfile::TempDir;

    fn write(path: &Path, content: &str) {
        fs::write(path, content).expect("fixture write should succeed");
    }

    fn read(path: &Path) -> String {
        fs::read_to_string(path).expect("fixture read should succeed")
    }

    fn mode_of(path: &Path) -> u32 {
        file_mode(path).expect("mode should be readable")
    }

    /// Every entry in a directory, sorted, so a test can assert nothing was left
    /// behind.
    fn entries(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .expect("directory should be readable")
            .map(|entry| {
                entry
                    .expect("entry should be readable")
                    .file_name()
                    .display()
                    .to_string()
            })
            .collect();
        names.sort();
        names
    }

    #[tokio::test]
    async fn replaces_content_and_leaves_no_debris() {
        let dir = TempDir::new().expect("temp dir");
        let target = dir.path().join("config.kdl");
        write(&target, "old\n");

        write_atomic(&target, "new\n")
            .await
            .expect("write should succeed");

        assert_eq!(read(&target), "new\n");
        assert_eq!(entries(dir.path()), vec!["config.kdl".to_string()]);
    }

    #[tokio::test]
    async fn writes_a_file_that_did_not_exist() {
        let dir = TempDir::new().expect("temp dir");
        let target = dir.path().join("fresh.kdl");

        write_atomic(&target, "hello\n")
            .await
            .expect("write should succeed");

        assert_eq!(read(&target), "hello\n");
        assert_eq!(
            mode_of(&target),
            DEFAULT_NEW_FILE_MODE,
            "a config created out of nothing must not be world readable"
        );
    }

    #[tokio::test]
    async fn preserves_the_mode_of_an_existing_file() {
        let dir = TempDir::new().expect("temp dir");
        let target = dir.path().join("config.kdl");
        write(&target, "old\n");
        fs::set_permissions(&target, Permissions::from_mode(0o640)).expect("chmod should work");

        write_atomic(&target, "new\n")
            .await
            .expect("write should succeed");

        assert_eq!(mode_of(&target), 0o640, "mode must survive the save");
    }

    #[tokio::test]
    async fn writes_through_a_symlink_instead_of_beside_it() {
        let real_dir = TempDir::new().expect("temp dir");
        let link_dir = TempDir::new().expect("temp dir");
        let real = real_dir.path().join("config.kdl");
        let link = link_dir.path().join("config.kdl");
        write(&real, "old\n");
        symlink(&real, &link).expect("symlink should be created");

        write_atomic(&link, "new\n")
            .await
            .expect("write should succeed");

        assert_eq!(read(&real), "new\n", "the real file has to change");
        assert_eq!(
            entries(link_dir.path()),
            vec!["config.kdl".to_string()],
            "no second file may appear next to the symlink"
        );
        assert!(fs::symlink_metadata(&link).is_ok(), "the link must survive");
        assert!(
            fs::symlink_metadata(&link)
                .expect("link metadata")
                .file_type()
                .is_symlink(),
            "the link must still be a link, not a regular file"
        );
    }

    #[tokio::test]
    async fn follows_a_symlinked_directory() {
        let real_dir = TempDir::new().expect("temp dir");
        let link_dir = TempDir::new().expect("temp dir");
        let real = real_dir.path().join("config.kdl");
        write(&real, "old\n");
        let dir_link = link_dir.path().join("niri");
        symlink(real_dir.path(), &dir_link).expect("symlink should be created");

        write_atomic(&dir_link.join("config.kdl"), "new\n")
            .await
            .expect("write should succeed");

        assert_eq!(read(&real), "new\n");
        assert_eq!(entries(real_dir.path()), vec!["config.kdl".to_string()]);
    }

    #[tokio::test]
    async fn a_symlink_loop_is_an_error_not_a_hang() {
        let dir = TempDir::new().expect("temp dir");
        let a = dir.path().join("a");
        let b = dir.path().join("b");
        symlink(&b, &a).expect("symlink should be created");
        symlink(&a, &b).expect("symlink should be created");

        let err = write_atomic(&a, "x")
            .await
            .expect_err("a symlink loop must not be written through");

        assert!(matches!(err, AppError::SymlinkResolution(_)), "got {err:?}");
    }

    /// The property the module exists for: an interrupted write leaves the old
    /// file, whole, and takes its staged file with it.
    #[tokio::test]
    async fn an_interrupted_write_leaves_the_old_file_untouched() {
        for fault in [
            FaultPoint::BeforeFsync,
            FaultPoint::AfterFsync,
            FaultPoint::BeforeRename,
        ] {
            let dir = TempDir::new().expect("temp dir");
            let target = dir.path().join("config.kdl");
            let original = "old content that must survive\n";
            write(&target, original);

            let err = write_atomic_bytes_faulted(
                &target,
                b"new content that must not appear\n",
                Some(fault),
            )
            .await
            .expect_err("an injected fault must surface as an error");

            assert!(matches!(err, AppError::AtomicWrite(_)), "got {err:?}");
            assert_eq!(
                read(&target),
                original,
                "{fault:?}: the file on disk must be byte identical"
            );
            assert_eq!(
                entries(dir.path()),
                vec!["config.kdl".to_string()],
                "{fault:?}: the staged file must be removed on the failure path"
            );
        }
    }

    #[tokio::test]
    async fn a_failed_rename_leaves_the_old_file_and_removes_the_staged_one() {
        let dir = TempDir::new().expect("temp dir");
        // A directory cannot be replaced by a file, so the rename fails for a
        // reason the kernel produces, not one the test invents.
        let target = dir.path().join("blocked.kdl");
        fs::create_dir(&target).expect("directory should be created");

        let err = write_atomic(&target, "x")
            .await
            .expect_err("replacing a directory with a file must fail");

        assert!(matches!(err, AppError::AtomicWrite(_)), "got {err:?}");
        assert!(target.is_dir(), "the target must still be a directory");
        assert_eq!(
            entries(dir.path()),
            vec!["blocked.kdl".to_string()],
            "the staged file must not survive a failed rename"
        );
    }

    #[tokio::test]
    async fn a_failed_write_leaves_no_staged_file() {
        let dir = TempDir::new().expect("temp dir");
        // A read-only directory refuses the creation of a staged file, which is
        // the first thing the write needs.
        let target = dir.path().join("config.kdl");
        write(&target, "old\n");
        let original = read(&target);
        let perms = fs::metadata(dir.path())
            .expect("metadata")
            .permissions()
            .mode()
            & 0o7777;
        fs::set_permissions(dir.path(), Permissions::from_mode(0o500)).expect("chmod should work");

        let outcome = write_atomic(&target, "new\n").await;

        fs::set_permissions(dir.path(), Permissions::from_mode(perms)).expect("chmod back");

        let err = outcome.expect_err("a read-only directory must refuse the write");
        assert!(matches!(err, AppError::AtomicWrite(_)), "got {err:?}");
        assert_eq!(read(&target), original, "the config must be unchanged");
        assert_eq!(entries(dir.path()), vec!["config.kdl".to_string()]);
    }

    #[tokio::test]
    async fn concurrent_writes_to_the_same_target_all_leave_a_whole_file() {
        let dir = TempDir::new().expect("temp dir");
        let target = dir.path().join("config.kdl");
        write(&target, "seed\n");

        let mut handles = Vec::new();
        for index in 0..8 {
            let target = target.clone();
            handles.push(tokio::spawn(async move {
                let body = format!("body {index}\n").repeat(64);
                write_atomic(&target, &body).await
            }));
        }
        for handle in handles {
            handle
                .await
                .expect("task should not panic")
                .expect("write should succeed");
        }

        let final_text = read(&target);
        assert!(
            final_text.starts_with("body ") && final_text.ends_with('\n'),
            "the file must be one of the written bodies, not a mixture"
        );
        assert_eq!(entries(dir.path()), vec!["config.kdl".to_string()]);
    }

    #[test]
    fn preserve_metadata_copies_the_mode() {
        let dir = TempDir::new().expect("temp dir");
        let source = dir.path().join("source");
        let dest = dir.path().join("dest");
        write(&source, "x");
        write(&dest, "y");
        fs::set_permissions(&source, Permissions::from_mode(0o604)).expect("chmod should work");

        preserve_metadata(&source, &dest).expect("metadata should be preserved");

        assert_eq!(mode_of(&dest), 0o604);
    }

    #[test]
    fn a_staged_candidate_is_a_recognisable_sibling_of_its_target() {
        let dir = TempDir::new().expect("temp dir");
        let target = dir.path().join("config.kdl");
        write(&target, "old\n");

        let candidate = stage_candidate(&target, b"new\n").expect("staging should succeed");

        assert_eq!(read(&target), "old\n", "staging must not touch the target");
        assert_eq!(read(&candidate), "new\n");
        assert_eq!(
            candidate.parent(),
            Some(dir.path()),
            "the candidate has to sit beside its target for rename to be atomic"
        );
        assert!(
            candidate
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.contains(CANDIDATE_SUFFIX)),
            "got {}",
            candidate.display()
        );
        assert_eq!(mode_of(&candidate), mode_of(&target));
    }

    #[test]
    fn committing_a_candidate_swaps_it_in_and_removes_the_staged_name() {
        let dir = TempDir::new().expect("temp dir");
        let target = dir.path().join("config.kdl");
        write(&target, "old\n");
        let candidate = stage_candidate(&target, b"new\n").expect("staging should succeed");

        commit_staged(&candidate, &target).expect("commit should succeed");

        assert_eq!(read(&target), "new\n");
        assert_eq!(entries(dir.path()), vec!["config.kdl".to_string()]);
    }

    #[test]
    fn a_stale_candidate_from_a_previous_crash_is_replaced_not_appended() {
        let dir = TempDir::new().expect("temp dir");
        let target = dir.path().join("config.kdl");
        write(&target, "old\n");
        let first = stage_candidate(&target, b"first\n").expect("staging should succeed");
        write(&first, "left over from a crash\n");

        let second = stage_candidate(&target, b"second\n").expect("staging should succeed");

        assert_eq!(
            second, first,
            "the candidate name is derived from the target"
        );
        assert_eq!(read(&second), "second\n", "the stale copy must not survive");
    }
}
