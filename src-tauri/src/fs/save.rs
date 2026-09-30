//! The save transaction.
//!
//! # One function, one order
//!
//! `ARCHITECTURE.md` §5 fixes the order of a save: config → AST → per-file
//! candidate → validate candidates → backup → atomic replace → optional reload →
//! update the read model. Every one of those steps has to happen, and in that
//! order, for the product promise ("editing a config never corrupts it") to hold.
//! When the steps live in the callers, one of them eventually gets skipped - by a
//! second save path, by a restore that forgot the backup, by a quick "just write
//! the file" during debugging. So they live here, in one function, and
//! [`save_config`] is the only thing in the crate that puts a staged file in
//! place.
//!
//! # What a failure leaves behind
//!
//! Nothing, on the real files. Every step that can fail before the swap happens
//! on staged copies: the candidates are siblings of their targets, the backup is
//! taken before the first rename, and the staged files are removed on every
//! failure path including the ones inside the commit loop.
//!
//! The one window that cannot be closed is *inside* the commit: each `rename` is
//! atomic, a sequence of them is not, so a failure after the first one leaves the
//! set mixed. The error that reaches the caller names how many files were already
//! replaced and which backup restores a consistent state, and the backup is
//! guaranteed to exist by then - it is taken before the first rename. The one window that

use crate::error::{AppError, AppResult};
use crate::fs::atomic::{self, FaultPoint};
use crate::fs::backup::{BackupManager, BackupMeta};
use crate::kdl::include::KdlConfigSet;
use crate::kdl::{apply_config, serialize_file};
use crate::niri::validate::{SkipReason, ValidationOutcome};
use crate::schema::Config;
use std::path::{Path, PathBuf};

/// What a save did, in enough detail for the application to update itself.
#[derive(Debug, Clone)]
pub struct SaveReport {
    /// The backup taken before the write, if anything was written.
    pub backup: Option<BackupMeta>,
    /// Files whose content on disk was replaced.
    pub written: Vec<PathBuf>,
    /// What the validation step established.
    ///
    /// Carried through rather than collapsed into a bool: a save that was not
    /// checked is a different thing from a save that was checked and is fine,
    /// and the user has to be able to tell them apart afterwards.
    pub validation: ValidationOutcome,
}

/// Everything the transaction needs that is not the config itself.
pub struct SaveContext<'a> {
    /// Where backups go. Required: a save with nowhere to put a backup is not a
    /// save this product is allowed to perform.
    pub backups: &'a BackupManager,
    /// Binary to validate with, so the tests can point at a stub.
    pub niri_binary: &'a str,
    /// Whether to run the validation gate at all.
    ///
    /// A caller may turn the gate off, and the report then says so by carrying
    /// `Skipped` - there is no way to ask for a save and be told nothing was
    /// checked.
    pub validate: bool,
    /// Comment attached to the automatic backup.
    pub comment: Option<String>,
}

impl<'a> SaveContext<'a> {
    /// The default context: real backups, the real `niri`, validation on.
    pub fn new(backups: &'a BackupManager) -> Self {
        Self {
            backups,
            niri_binary: crate::niri::validate::NIRI_BINARY,
            validate: true,
            comment: None,
        }
    }
}

/// Save a config: the only path that changes a file on disk.
///
/// The order is fixed and each step is a precondition for the next:
///
/// 1. the typed model is written into the AST, which yields the files that
///    actually changed;
/// 2. each changed file is rendered and staged as a **candidate** in its own
///    directory - same directory, so the later rename is atomic and so niri
///    resolves the candidate's `include` directives against the user's real
///    includes;
/// 3. the candidates are validated. A rejection removes every candidate and
///    returns; no real file is touched;
/// 4. the **whole** config set is backed up, not just the changed files;
/// 5. the candidates are renamed over their targets;
/// 6. the read model is updated to what is now on disk.
///
/// An unchanged config short-circuits at step 1: nothing is staged, no backup is
/// taken, and no file is written, because there is nothing to protect.
pub async fn save_config(
    set: &mut KdlConfigSet,
    config: &Config,
    ctx: &SaveContext<'_>,
) -> AppResult<SaveReport> {
    let changed = apply_config(set, config)?;
    if changed.is_empty() {
        // Nothing was edited. Taking a backup here would fill the user's backup
        // list with copies of a file nobody changed, and the rotation would
        // push out the ones that record real edits.
        return Ok(SaveReport {
            backup: None,
            written: Vec::new(),
            validation: ValidationOutcome::Valid,
        });
    }

    let set_files = set.paths();
    let candidates = stage_candidates(set, &changed)?;
    let staged = Candidates::new(candidates);

    let validation = validate_candidates(&changed, &staged, ctx).await?;
    if let ValidationOutcome::Invalid(errors) = &validation {
        // `staged` drops here, so nothing is left in the config directory and
        // nothing on disk was touched.
        return Err(AppError::niri_validate(errors.clone()));
    }

    let backup = take_backup(ctx, &set_files).await?;

    let mut written = Vec::new();
    for candidate in staged.iter_in_commit_order() {
        if !candidate
            .needs_writing()
            .map_err(|err| AppError::Io(format!("{}: {err}", candidate.target.display())))?
        {
            // Staged only so that the validation gate could see the whole set.
            // The bytes are identical to what is on disk, so replacing the file
            // would be a no-op that still swaps the inode - which shows up as a
            // modification to the user, in their editor and to anything else
            // watching. Leave it alone.
            continue;
        }
        if let Err(err) = atomic::commit_staged(&candidate.path, &candidate.target) {
            // The candidates that have not been committed are removed by `staged`
            // on the way out. What *has* been committed cannot be undone here:
            // a sequence of renames has no cross-file atomicity. Say so, and name
            // the backup that gets the user back to a consistent set, rather than
            // reporting a plain write failure that hides the mixed state.
            return Err(AppError::AtomicWrite(format!(
                "{}: {err}; {} file(s) were already replaced and the config set is \
                 now mixed - restore backup {} to get back to a consistent state",
                candidate.target.display(),
                written.len(),
                backup.as_ref().map(|b| b.id.as_str()).unwrap_or("none"),
            )));
        }
        written.push(candidate.target.clone());
    }

    // The guard drops here and removes whatever is still staged: a candidate that
    // was skipped because its target already matched, and - harmlessly - the ones
    // just committed, since a name that no longer exists is a successful remove.
    // Nothing has to remember to disarm it, and there is no path out of this
    // function that can leave a staged file in the user's config directory.

    update_read_model(set, &written)?;
    Ok(SaveReport {
        backup,
        written,
        validation,
    })
}

/// Restore a backup: the same discipline, in the other direction.
///
/// It goes through [`BackupManager::restore_backup`], which backs up the state it
/// is about to replace, so a restore is reversible. It is a separate function
/// rather than a flag on [`save_config`] because the two write different things
/// from different sources, and a caller that has to choose also has a chance to
/// choose wrongly.
pub async fn restore_backup(backups: &BackupManager, id: &str) -> AppResult<BackupMeta> {
    backups.restore_backup(id).await
}

/// Stage every changed file, plus the main file.
///
/// The main file is staged even when it did not change textually. niri resolves
/// `include` directives relative to the file it is given, so validating a
/// *changed include* on its own would validate a fragment rather than the config
/// the user is about to get. Validating the staged main file is what makes the
/// check cover the set as niri will read it.
fn stage_candidates(set: &KdlConfigSet, changed: &[PathBuf]) -> AppResult<Vec<StagedCandidate>> {
    let main = set.main_path.clone();
    let mut targets: Vec<PathBuf> = changed.to_vec();
    if !targets.contains(&main) {
        targets.push(main);
    }

    let mut out = Vec::with_capacity(targets.len());
    for target in targets {
        let text = serialize_file(set, &target)?;
        let depth = set
            .files
            .iter()
            .find(|f| f.path == target)
            .map(|f| f.depth)
            .unwrap_or(0);
        // The candidate is written next to the target under the target's own
        // name, so niri sees the includes the real file would see.
        let staged_path = atomic::stage_candidate(&target, text.as_bytes())?;
        out.push(StagedCandidate {
            target,
            path: staged_path,
            depth,
        });
    }
    Ok(out)
}

/// Validate the staged set through niri.
///
/// The main file's candidate is the entry point for the check. When the gate is
/// switched off, the outcome is `Skipped` with a reason that says so, which is
/// the same shape as "niri is not installed" - both mean the same thing to the
/// user and neither may be read as a pass.
async fn validate_candidates(
    _changed: &[PathBuf],
    staged: &Candidates,
    ctx: &SaveContext<'_>,
) -> AppResult<ValidationOutcome> {
    let Some(main) = staged.main() else {
        return Ok(ValidationOutcome::Skipped(SkipReason::NotExecutable {
            binary: ctx.niri_binary.to_string(),
            details: "the config set has no entry point to validate".to_string(),
        }));
    };
    if !ctx.validate {
        return Ok(ValidationOutcome::Skipped(SkipReason::NotExecutable {
            binary: ctx.niri_binary.to_string(),
            details: "validation was turned off for this save".to_string(),
        }));
    }
    crate::niri::validate::validate_candidate_with(ctx.niri_binary, &main.path, &main.target).await
}

/// Take the pre-write backup of the whole config set.
async fn take_backup(
    ctx: &SaveContext<'_>,
    set_files: &[PathBuf],
) -> AppResult<Option<BackupMeta>> {
    let version = crate::niri::validate::niri_version(ctx.niri_binary).await;
    // The comment is what a reader of the backup list will see, so it is carried
    // through rather than accepted and dropped.
    let meta = ctx
        .backups
        .create_auto_backup_with(set_files, version, ctx.comment.clone())
        .await?;
    Ok(Some(meta))
}

/// Bring the in-memory read model in line with what is now on disk.
///
/// `ConfigFile::source` is what the source map indexes into for line numbers, so
/// leaving it pointing at the pre-save text would make every location reported
/// afterwards describe a file the user no longer has. The document is already
/// correct - `apply_config` mutated it - so only the text needs replacing.
fn update_read_model(set: &mut KdlConfigSet, written: &[PathBuf]) -> AppResult<()> {
    for path in written {
        let on_disk = std::fs::read_to_string(path)
            .map_err(|err| AppError::Io(format!("{}: {err}", path.display())))?;
        if let Some(file) = set.file_mut(path) {
            file.source = on_disk.clone();
            // Re-parse rather than trusting the string: the file is the authority
            // after a save, and a mismatch between the AST and the file on disk
            // is the failure mode this whole module exists to prevent.
            let doc = crate::kdl::parser::parse_kdl(&on_disk, path)?;
            file.doc = doc;
        }
        set.source_map.store_document(
            path.clone(),
            set.file(path).map(|f| f.doc.clone()).unwrap_or_default(),
            &on_disk,
        );
    }
    Ok(())
}

/// A staged file waiting to be put in place.
struct StagedCandidate {
    /// The real file it will replace.
    target: PathBuf,
    /// The staged copy beside it.
    path: PathBuf,
    /// Distance from the entry point in the include tree.
    depth: usize,
}

impl StagedCandidate {
    /// Whether the staged bytes differ from what is on disk.
    ///
    /// A file that is already byte-identical does not need replacing. The entry
    /// point is always staged, even when nobody edited it, so that the validation
    /// gate sees the set as niri will read it; committing it anyway would swap the
    /// inode of a file whose content did not change, which the user would see as
    /// an edit they did not make.
    ///
    /// A target that has disappeared counts as needing a write: the staged copy is
    /// then the only copy left.
    fn needs_writing(&self) -> std::io::Result<bool> {
        let staged = std::fs::read(&self.path)?;
        match std::fs::read(&self.target) {
            Ok(current) => Ok(staged != current),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(true),
            Err(err) => Err(err),
        }
    }
}

/// Owns the staged files and removes the ones that are still there.
///
/// The `Drop` impl is the guarantee: whatever returns from [`save_config`] - an
/// error from validation, an error from the backup, an error in the middle of the
/// commit loop, a panic - the staged files that have not been committed go away.
/// The only way out is [`Candidates::into_committed`], which says explicitly that
/// the staged files are now real files.
struct Candidates {
    entries: Vec<StagedCandidate>,
}

impl Candidates {
    fn new(entries: Vec<StagedCandidate>) -> Self {
        Self { entries }
    }

    /// The entry point's candidate, which is what niri validates.
    fn main(&self) -> Option<&StagedCandidate> {
        self.entries.iter().find(|c| c.depth == 0)
    }

    /// Candidates in the order they are committed.
    ///
    /// Includes first, entry point last. A crash between two renames then leaves
    /// an entry point that is older than the include it pulls in, rather than an
    /// entry point that points at content that is not there yet.
    fn iter_in_commit_order(&self) -> impl Iterator<Item = &StagedCandidate> {
        let mut ordered: Vec<&StagedCandidate> = self.entries.iter().collect();
        ordered.sort_by(|a, b| b.depth.cmp(&a.depth).then_with(|| a.target.cmp(&b.target)));
        ordered.into_iter()
    }

    /// Every candidate, in staging order.
    ///
    /// Only the tests walk the whole set. The transaction reaches candidates
    /// through [`Self::iter_in_commit_order`], so there is no way for it to pick a
    /// commit order of its own by accident.
    #[cfg(test)]
    fn iter(&self) -> impl Iterator<Item = &StagedCandidate> {
        self.entries.iter()
    }
}

impl Drop for Candidates {
    fn drop(&mut self) {
        for candidate in &self.entries {
            // Only meaningful for the ones that are still staged; a committed one
            // no longer exists under its staged name, and a missing file is
            // success.
            let _ = atomic::remove_staged(&candidate.path);
        }
    }
}

/// The atomic write used for a single file, exposed so a caller that has no
/// config set (a settings file, for instance) can still get the guarantee.
pub async fn write_single_file(path: &Path, content: &str) -> AppResult<()> {
    atomic::write_atomic(path, content).await
}

/// The atomic write with a failure injected, for tests that have to prove an
/// interrupted write leaves the target alone.
pub async fn write_single_file_faulted(
    path: &Path,
    content: &str,
    fault: Option<FaultPoint>,
) -> AppResult<()> {
    atomic::write_atomic_bytes_faulted(path, content.as_bytes(), fault).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fs::backup::BackupManager;
    use std::path::Path;
    use tempfile::TempDir;

    const MAIN: &str = concat!(
        "// Main config.\n",
        "include \"input.kdl\"\n",
        "layout {\n",
        "    gaps 10\n",
        "}\n",
    );
    const INPUT: &str = "binds {\n    Mod+Q { close-window; }\n}\n";

    /// A two-file config set in a temp directory, plus a backup manager in the
    /// same temp tree. Nothing here reads or writes a real user config.
    struct Fixture {
        dir: TempDir,
        main: PathBuf,
        include: PathBuf,
        backups: BackupManager,
    }

    impl Fixture {
        fn new() -> Self {
            let dir = TempDir::new().expect("temp dir");
            let cfg = dir.path().join("cfg");
            std::fs::create_dir_all(&cfg).expect("dir should be created");
            let main = cfg.join("config.kdl");
            let include = cfg.join("input.kdl");
            std::fs::write(&main, MAIN).expect("main should be written");
            std::fs::write(&include, INPUT).expect("include should be written");
            let backups = BackupManager::with_dir(dir.path().join("backups"))
                .expect("manager should be created");
            Self {
                dir,
                main,
                include,
                backups,
            }
        }

        fn load(&self) -> KdlConfigSet {
            crate::kdl::parse_config(&self.main).expect("the fixture config should parse")
        }

        /// Every file in the set, read as bytes, for a before/after comparison.
        fn snapshot(&self) -> Vec<(PathBuf, Vec<u8>)> {
            vec![
                (
                    self.main.clone(),
                    std::fs::read(&self.main).expect("main should be readable"),
                ),
                (
                    self.include.clone(),
                    std::fs::read(&self.include).expect("include should be readable"),
                ),
            ]
        }

        fn names_in_cfg_dir(&self) -> Vec<String> {
            let mut names: Vec<String> = std::fs::read_dir(self.main.parent().expect("parent"))
                .expect("read_dir")
                .map(|e| e.expect("entry").file_name().display().to_string())
                .collect();
            names.sort();
            names
        }
    }

    /// Write a stub and mark it executable in the same step, so the kernel never
    /// sees a writable executable and refuses it with "text file busy".
    fn write_stub(path: &Path, script: &str) -> String {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o755)
            .open(path)
            .expect("stub should be created");
        file.write_all(script.as_bytes())
            .expect("stub should be written");
        file.sync_all().expect("stub should be flushed");
        path.display().to_string()
    }

    /// A stub niri that accepts everything, the way a real one answers a valid
    /// config: nothing on stdout, a log line on stderr, exit 0.
    fn stub_accepting(dir: &Path) -> String {
        write_stub(
            &dir.join("niri-accept"),
            "#!/bin/sh\nprintf 'INFO niri: config is valid\\n' >&2\nexit 0\n",
        )
    }

    /// A stub niri that rejects, reproducing a real diagnostic in shape and in the
    /// fact that the position comes from the file it was handed.
    fn stub_rejecting(dir: &Path) -> String {
        write_stub(
            &dir.join("niri-reject"),
            concat!(
                "#!/bin/sh\n",
                "cat >&2 <<'DIAG'\n",
                "Error:   \u{d7} unexpected node `gaps`\n",
                "   \u{256d}\u{2500}[$3:2:5]\n",
                "DIAG\n",
                "exit 1\n",
            ),
        )
    }

    fn context<'a>(f: &'a Fixture, binary: &'a str) -> SaveContext<'a> {
        SaveContext {
            backups: &f.backups,
            niri_binary: binary,
            validate: true,
            comment: None,
        }
    }

    /// Load, change `layout.gaps`, and return the pair the save takes.
    fn edited_set(f: &Fixture, gaps: i32) -> (KdlConfigSet, Config) {
        let set = f.load();
        let mut config = crate::kdl::to_config(&set).expect("the fixture should map to a config");
        config.layout.get_or_insert_with(Default::default).gaps = Some(gaps);
        (set, config)
    }

    #[tokio::test]
    async fn a_successful_save_writes_the_change_and_takes_a_backup_first() {
        let f = Fixture::new();
        let binary = {
            let path = f.dir.path().join("niri-accept");
            std::fs::write(&path, "#!/bin/sh\nexit 0\n").expect("stub should be written");
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
                .expect("stub should be executable");
            path.display().to_string()
        };
        let (mut set, config) = edited_set(&f, 24);

        let report = save_config(&mut set, &config, &context(&f, &binary))
            .await
            .expect("the save should succeed");

        assert_eq!(report.validation, ValidationOutcome::Valid);
        assert!(report.written.contains(&f.main), "got {:?}", report.written);
        assert!(
            String::from_utf8_lossy(&std::fs::read(&f.main).expect("read")).contains("gaps 24"),
            "the change has to be on disk"
        );
        let backup = report.backup.expect("a save must be preceded by a backup");
        assert!(backup.is_auto);
        assert_eq!(
            std::fs::read_to_string(backup.dir.join("files/config.kdl")).expect("read"),
            MAIN,
            "the backup has to hold the pre-save text"
        );
    }

    #[tokio::test]
    async fn a_rejected_save_leaves_every_file_byte_identical_and_stages_nothing() {
        let f = Fixture::new();
        let binary = stub_rejecting(f.dir.path());
        let before = f.snapshot();
        let (mut set, config) = edited_set(&f, 24);

        let err = save_config(&mut set, &config, &context(&f, &binary))
            .await
            .expect_err("a rejected config must not be written");

        match &err {
            AppError::NiriValidate { errors } => {
                assert!(
                    errors.iter().any(|e| e.message.contains("unexpected node")),
                    "the user has to be told what niri objected to: {errors:?}"
                );
            }
            other => panic!("expected a validation error, got {other:?}"),
        }
        assert_eq!(f.snapshot(), before, "no byte on disk may change");
        assert_eq!(
            f.names_in_cfg_dir(),
            vec!["config.kdl".to_string(), "input.kdl".to_string()],
            "a rejected save must not leave a staged file behind"
        );
        assert!(
            f.backups.list_backups().await.expect("listing").is_empty(),
            "a save that wrote nothing must not produce a backup"
        );
    }

    #[tokio::test]
    async fn a_missing_niri_binary_does_not_block_the_save_and_is_not_called_a_pass() {
        let f = Fixture::new();
        let (mut set, config) = edited_set(&f, 24);
        let missing = f.dir.path().join("no-niri-here").display().to_string();

        let report = save_config(&mut set, &config, &context(&f, &missing))
            .await
            .expect("a missing binary must not block a save");

        assert!(
            !report.validation.is_valid(),
            "an unchecked save must not be reported as checked"
        );
        assert!(
            matches!(report.validation, ValidationOutcome::Skipped(_)),
            "got {:?}",
            report.validation
        );
        let message = report.validation.user_message().expect("a message");
        assert!(message.contains("not installed"), "{message}");
        assert!(
            String::from_utf8_lossy(&std::fs::read(&f.main).expect("read")).contains("gaps 24"),
            "the save itself must go through"
        );
        assert!(
            report.backup.is_some(),
            "the backup does not depend on niri"
        );
    }

    #[tokio::test]
    async fn the_backup_covers_the_whole_config_set_not_only_the_changed_file() {
        let f = Fixture::new();
        let binary = stub_accepting(f.dir.path());
        let (mut set, config) = edited_set(&f, 24);

        let report = save_config(&mut set, &config, &context(&f, &binary))
            .await
            .expect("the save should succeed");

        let backup = report.backup.expect("a backup");
        assert_eq!(
            backup.files.len(),
            2,
            "a multi-file config has to be captured whole"
        );
        assert_eq!(
            std::fs::read_to_string(backup.dir.join("files/input.kdl")).expect("read"),
            INPUT,
            "an unchanged include still has to be in the backup, or restoring it \
             leaves a set that niri cannot load"
        );
    }

    #[tokio::test]
    async fn an_unchanged_config_writes_nothing_and_takes_no_backup() {
        let f = Fixture::new();
        let binary = stub_accepting(f.dir.path());
        let before = f.snapshot();
        let mut set = f.load();
        let config = crate::kdl::to_config(&set).expect("mapping should work");

        let report = save_config(&mut set, &config, &context(&f, &binary))
            .await
            .expect("saving an unedited config is not an error");

        assert!(report.written.is_empty(), "got {:?}", report.written);
        assert!(
            report.backup.is_none(),
            "nothing was overwritten, so nothing to protect"
        );
        assert_eq!(f.snapshot(), before, "the files must be byte identical");
    }

    #[tokio::test]
    async fn a_second_save_backs_up_the_state_the_first_one_produced() {
        // The property that makes backups useful: the second backup has to hold
        // what the first save wrote, not what was there before the first save.
        let f = Fixture::new();
        let binary = stub_accepting(f.dir.path());
        let (mut set, first_config) = edited_set(&f, 24);
        let first = save_config(&mut set, &first_config, &context(&f, &binary))
            .await
            .expect("the first save should succeed");

        let mut config = crate::kdl::to_config(&set).expect("mapping should work");
        config.layout.get_or_insert_with(Default::default).gaps = Some(48);
        let second = save_config(&mut set, &config, &context(&f, &binary))
            .await
            .expect("the second save should succeed");

        let second_backup = second.backup.expect("a backup");
        assert_ne!(second_backup.id, first.backup.expect("a backup").id);
        assert!(
            std::fs::read_to_string(second_backup.dir.join("files/config.kdl"))
                .expect("read")
                .contains("gaps 24"),
            "the second backup must hold the state the first save left"
        );
        assert!(
            String::from_utf8_lossy(&std::fs::read(&f.main).expect("read")).contains("gaps 48")
        );
    }

    #[tokio::test]
    async fn the_read_model_ends_up_describing_what_is_on_disk() {
        // A stale `source` would make every line number reported after a save
        // point into a file the user no longer has.
        let f = Fixture::new();
        let binary = stub_accepting(f.dir.path());
        let (mut set, config) = edited_set(&f, 24);

        save_config(&mut set, &config, &context(&f, &binary))
            .await
            .expect("the save should succeed");

        let on_disk = std::fs::read_to_string(&f.main).expect("read");
        let in_model = &set.file(&f.main).expect("main file").source;
        assert_eq!(in_model, &on_disk, "the read model has to match the file");

        // And the set has to round-trip: re-reading it must give the same text.
        let reloaded = crate::kdl::serialize_file(&set, &f.main).expect("serialize should work");
        assert_eq!(reloaded, on_disk);
    }

    #[tokio::test]
    async fn an_interrupted_write_of_a_single_file_leaves_it_untouched() {
        let f = Fixture::new();
        let before = std::fs::read(&f.include).expect("read");

        let err = write_single_file_faulted(
            &f.include,
            "binds {\n    Mod+Q { quit; }\n}\n",
            Some(FaultPoint::BeforeRename),
        )
        .await
        .expect_err("the injected fault must surface");

        assert!(matches!(err, AppError::AtomicWrite(_)), "got {err:?}");
        assert_eq!(std::fs::read(&f.include).expect("read"), before);
    }

    #[tokio::test]
    async fn a_save_through_a_symlinked_config_reaches_the_real_file() {
        let dir = TempDir::new().expect("temp dir");
        let real_dir = dir.path().join("real");
        let link_dir = dir.path().join("link");
        std::fs::create_dir_all(&real_dir).expect("dir should be created");
        std::fs::create_dir_all(&link_dir).expect("dir should be created");
        let real_main = real_dir.join("config.kdl");
        let real_include = real_dir.join("input.kdl");
        std::fs::write(&real_main, MAIN).expect("main should be written");
        std::fs::write(&real_include, INPUT).expect("include should be written");
        std::os::unix::fs::symlink(&real_main, link_dir.join("config.kdl"))
            .expect("symlink should be created");
        let backups = BackupManager::with_dir(dir.path().join("backups")).expect("manager");
        let f = Fixture {
            dir: TempDir::new().expect("unused holder"),
            main: link_dir.join("config.kdl"),
            include: real_include,
            backups,
        };
        let _ = real_include;
        let binary = {
            let path = dir.path().join("niri-accept");
            std::fs::write(&path, "#!/bin/sh\nexit 0\n").expect("stub should be written");
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
                .expect("stub should be executable");
            path.display().to_string()
        };
        let mut set = crate::kdl::parse_config(&f.main).expect("the symlinked config should parse");
        let mut config = crate::kdl::to_config(&set).expect("mapping should work");
        config.layout.get_or_insert_with(Default::default).gaps = Some(24);
        let ctx = SaveContext {
            backups: &f.backups,
            niri_binary: &binary,
            validate: true,
            comment: None,
        };

        save_config(&mut set, &config, &ctx)
            .await
            .expect("the save should succeed");

        assert!(
            std::fs::read_to_string(&real_main)
                .expect("read")
                .contains("gaps 24"),
            "the file behind the symlink is the one that has to change"
        );
        let link_entries: Vec<String> = std::fs::read_dir(&link_dir)
            .expect("read_dir")
            .map(|e| e.expect("entry").file_name().display().to_string())
            .collect();
        assert_eq!(
            link_entries,
            vec!["config.kdl".to_string()],
            "no new file may appear next to the symlink"
        );
    }

    #[tokio::test]
    async fn a_failed_backup_stops_the_save_before_anything_is_written() {
        // A save that cannot be backed up must not be a save. The candidate
        // removal is what leaves the user with an untouched config.
        let f = Fixture::new();
        let binary = stub_accepting(f.dir.path());
        let before = f.snapshot();
        // Take the backup directory away after the manager was built: a manager
        // that cannot write there has to fail the save, not silently skip it.
        let (mut set, config) = edited_set(&f, 24);
        std::fs::remove_dir_all(f.backups.backup_dir()).expect("remove should work");
        std::fs::write(f.backups.backup_dir(), "not a directory").expect("write should succeed");

        let err = save_config(&mut set, &config, &context(&f, &binary))
            .await
            .expect_err("a save with nowhere to put a backup must fail");

        assert!(
            matches!(err, AppError::Backup(_) | AppError::Io(_)),
            "got {err:?}"
        );
        assert_eq!(f.snapshot(), before, "the config must be untouched");
        assert_eq!(
            f.names_in_cfg_dir(),
            vec!["config.kdl".to_string(), "input.kdl".to_string()],
            "the staged candidate must be gone"
        );
    }

    #[tokio::test]
    async fn the_includes_are_committed_before_the_entry_point() {
        // A crash between two renames should not leave an entry point that points
        // at content which is not there yet.
        let f = Fixture::new();
        let set = f.load();
        let staged = stage_candidates(&set, &[f.main.clone(), f.include.clone()])
            .expect("staging should succeed");
        let candidates = Candidates::new(staged);

        let order: Vec<PathBuf> = candidates
            .iter_in_commit_order()
            .map(|c| c.target.clone())
            .collect();

        let include_index = order.iter().position(|p| *p == f.include).expect("include");
        let main_index = order.iter().position(|p| *p == f.main).expect("main");
        assert!(
            include_index < main_index,
            "the entry point must be committed last, got {order:?}"
        );
    }

    #[tokio::test]
    async fn the_main_file_is_staged_even_when_only_an_include_changed() {
        // niri resolves includes relative to the file it is given. Validating a
        // changed include on its own would validate a fragment, not the config.
        let f = Fixture::new();
        let set = f.load();
        let staged = stage_candidates(&set, std::slice::from_ref(&f.include))
            .expect("staging should succeed");

        assert!(
            staged.iter().any(|c| c.target == f.main),
            "the entry point has to be staged for the check to mean anything"
        );
    }

    /// Staging the entry point for the validation gate must not turn into writing
    /// it. An unchanged file that gets its inode swapped looks to the user - and to
    /// their editor - like an edit somebody else made.
    /// A comment handed to the save has to reach the backup, because the backup
    /// list is where a user reads it.
    #[tokio::test]
    async fn the_save_context_comment_reaches_the_backup() {
        let f = Fixture::new();
        let binary = stub_accepting(f.dir.path());
        let (mut set, config) = edited_set(&f, 24);
        let mut ctx = context(&f, &binary);
        ctx.comment = Some("before switching to the dock".to_string());

        let report = save_config(&mut set, &config, &ctx)
            .await
            .expect("the save should succeed");

        assert_eq!(
            report.backup.expect("a backup").comment.as_deref(),
            Some("before switching to the dock"),
            "a comment that is accepted and then dropped is worse than no field"
        );
    }

    #[tokio::test]
    async fn a_file_whose_text_did_not_change_is_not_rewritten() {
        let f = Fixture::new();
        let binary = stub_accepting(f.dir.path());
        let (mut set, config) = edited_set(&f, 24);

        // The fixture keeps `gaps` in the entry point, so the entry point is the
        // file that changes and the include is the one staged only for the check.
        let report = save_config(&mut set, &config, &context(&f, &binary))
            .await
            .expect("the save should succeed");

        assert_eq!(
            report.written,
            vec![f.main.clone()],
            "only the file that actually changed may be rewritten"
        );
        assert!(
            report.written.len() < set.paths().len(),
            "the set is {} files, so writing all of them would be needless churn",
            set.paths().len()
        );
    }

    #[tokio::test]
    async fn a_file_edited_since_staging_is_still_replaced() {
        // The "is it different" check reads the target, so it has to agree with the
        // file rather than with a stale reading taken at stage time.
        let f = Fixture::new();
        let staged = stage_candidates(&f.load(), std::slice::from_ref(&f.main))
            .expect("staging should work");
        let candidates = Candidates::new(staged);
        let main = candidates
            .iter()
            .find(|c| c.target == f.main)
            .expect("the main file is staged");

        assert!(
            !main.needs_writing().expect("the check should run"),
            "a staged copy of unchanged content needs no write"
        );

        std::fs::write(&f.main, "somebody else edited this\n").expect("write");
        assert!(
            main.needs_writing().expect("the check should run"),
            "a file that changed under us must be replaced, not skipped"
        );
    }

    #[tokio::test]
    async fn a_config_set_without_an_entry_point_cannot_be_validated() {
        let f = Fixture::new();
        // Only the include is staged, so there is no depth-0 candidate for niri to
        // be pointed at. The set is contrived, and the point is that the failure
        // has to land in the one state that does not claim a check happened.
        let staged = vec![StagedCandidate {
            target: f.include.clone(),
            path: f.include.clone(),
            depth: 1,
        }];
        let candidates = Candidates::new(staged);
        let binary = stub_accepting(f.dir.path());
        let ctx = SaveContext {
            backups: &f.backups,
            niri_binary: &binary,
            validate: true,
            comment: None,
        };

        let outcome = validate_candidates(&[], &candidates, &ctx)
            .await
            .expect("the outcome must be defined");

        assert!(
            matches!(outcome, ValidationOutcome::Skipped(_)),
            "got {outcome:?}"
        );
    }

    /// The ordering claim in the module docs, checked against the source rather
    /// than against intention.
    ///
    /// `commit_staged` is what puts a staged file onto a target, so the set of
    /// places that call it *is* the set of ways a config reaches the disk. The
    /// check is that the only production call is inside [`save_config`]: a second
    /// one is a second write path, and a second write path is how a save ends up
    /// skipping validation or the backup.
    ///
    /// This is a text search over the crate's own sources, so it is a lint rather
    /// than a proof. It is here because the alternative - trusting that every
    /// future caller has read the module docs - is not a check at all.
    #[test]
    fn the_only_production_commit_is_inside_the_save_transaction() {
        let save_source = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/fs/save.rs");
        let source_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");

        let mut offenders = Vec::new();
        for file in collect_rust_files(&source_dir) {
            let text = std::fs::read_to_string(&file).expect("source should be readable");
            for (number, line) in text.lines().enumerate() {
                let code = line.split("//").next().unwrap_or(line);
                if !code.contains("commit_staged(") || code.contains("fn commit_staged") {
                    continue;
                }
                // Calls made from inside a `#[cfg(test)]` module are tests, and a
                // test is allowed to exercise the primitive directly. Everything
                // else has to go through the transaction.
                if in_test_module(&text, number) {
                    continue;
                }
                if file != save_source {
                    offenders.push(format!(
                        "{}:{}: {}",
                        file.display(),
                        number + 1,
                        code.trim()
                    ));
                }
            }
        }
        assert!(
            offenders.is_empty(),
            "a staged file can reach its target outside the save transaction:\n{}",
            offenders.join("\n")
        );
    }

    /// Whether the line at `number` sits inside a `#[cfg(test)]` module.
    fn in_test_module(text: &str, number: usize) -> bool {
        let mut in_tests = false;
        for line in text.lines().take(number) {
            let trimmed = line.trim();
            if trimmed.starts_with("#[cfg(test)]") {
                in_tests = true;
            } else if trimmed.starts_with("mod ") {
                if in_tests {
                    return true;
                }
                in_tests = false;
            }
        }
        in_tests
    }

    fn collect_rust_files(dir: &Path) -> Vec<std::path::PathBuf> {
        let mut out = Vec::new();
        walk(dir, &mut out);
        out
    }

    fn walk(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, out);
            } else if path.extension().is_some_and(|e| e == "rs") {
                out.push(path);
            }
        }
    }

    #[tokio::test]
    async fn turning_the_gate_off_is_reported_as_not_checked() {
        let f = Fixture::new();
        let binary = stub_rejecting(f.dir.path());
        let (mut set, config) = edited_set(&f, 24);
        let mut ctx = context(&f, &binary);
        ctx.validate = false;

        let report = save_config(&mut set, &config, &ctx)
            .await
            .expect("a save with the gate off is allowed to go through");

        assert!(
            matches!(report.validation, ValidationOutcome::Skipped(_)),
            "got {:?}",
            report.validation
        );
        assert!(
            String::from_utf8_lossy(&std::fs::read(&f.main).expect("read")).contains("gaps 24")
        );
    }
}
