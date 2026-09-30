//! End-to-end save against a real multi-file config.
//!
//! The unit tests in `fs/` use a stub `niri`, which is what makes them
//! deterministic. This file is the other half: it runs the real binary, against a
//! copy of a real multi-file config, and skips when that binary is not installed -
//! skipping, not failing, because a machine without niri is a normal place to run
//! the suite, and a test that fails there would only teach people to ignore it.
//!
//! Nothing here writes to a real user config. Every path is inside a temp
//! directory, and the fixture is a copy of `testdata/`.

use niriforge_lib::fs::atomic;
use niriforge_lib::fs::backup::BackupManager;
use niriforge_lib::fs::save::{save_config, SaveContext};
use niriforge_lib::fs::watch::ConfigWatcher;
use niriforge_lib::kdl;
use niriforge_lib::niri::validate::ValidationOutcome;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tempfile::TempDir;

const TESTDATA: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/testdata");

/// The real binary, or `None` when it is not installed.
fn real_niri() -> Option<PathBuf> {
    let path = std::path::Path::new("/usr/bin/niri");
    if path.is_file() {
        Some(path.to_path_buf())
    } else {
        // Fall back to whatever is on PATH.
        let output = std::process::Command::new("sh")
            .arg("-c")
            .arg("command -v niri")
            .output()
            .ok()?;
        let found = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if found.is_empty() {
            None
        } else {
            Some(PathBuf::from(found))
        }
    }
}

/// A temp copy of a fixture, so the test never touches `testdata/` itself.
fn copy_fixture(name: &str) -> Option<(TempDir, PathBuf)> {
    let source = Path::new(TESTDATA).join(name);
    if !source.is_dir() {
        return None;
    }
    let dir = TempDir::new().ok()?;
    let copy = dir.path().join(name);
    copy_tree(&source, &copy)?;
    Some((dir, copy))
}

fn copy_tree(from: &Path, to: &Path) -> Option<()> {
    std::fs::create_dir_all(to).ok()?;
    for entry in std::fs::read_dir(from).ok()?.flatten() {
        let from = entry.path();
        let to = to.join(entry.file_name());
        if from.is_dir() {
            copy_tree(&from, &to)?;
        } else {
            std::fs::copy(&from, &to).ok()?;
        }
    }
    Some(())
}

fn names_in(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| e.file_name().display().to_string())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

/// The whole config set, as bytes, for a before/after comparison.
fn snapshot(set: &kdl::include::KdlConfigSet) -> Vec<(PathBuf, Vec<u8>)> {
    set.paths()
        .into_iter()
        .map(|path| {
            let content = std::fs::read(&path).unwrap_or_default();
            (path, content)
        })
        .collect()
}

#[tokio::test]
async fn a_save_against_real_niri_keeps_the_config_valid_and_leaves_no_debris() {
    let Some(niri) = real_niri() else {
        eprintln!("skipping: niri is not installed");
        return;
    };
    let Some((dir, config_dir)) = copy_fixture("multi-file") else {
        eprintln!("skipping: the multi-file fixture is missing");
        return;
    };
    let main = config_dir.join("config.kdl");
    let niri = niri.display().to_string();

    let mut set = kdl::parse_config(&main).expect("the fixture parses");
    let files_before = set.paths();
    assert!(
        files_before.len() >= 4,
        "the fixture is meant to be multi-file, got {:?}",
        files_before
    );

    // The unedited config has to be valid, or the rest of the test proves nothing.
    let baseline = niriforge_lib::niri::validate_config_file(&main)
        .await
        .expect("niri validate should run");
    assert_eq!(
        baseline,
        ValidationOutcome::Valid,
        "the fixture has to start out valid"
    );

    let mut config = kdl::to_config(&set).expect("the fixture maps to a config");
    config.layout.get_or_insert_with(Default::default).gaps = Some(17);
    let backups = BackupManager::with_dir(dir.path().join("backups")).expect("manager");
    let ctx = SaveContext {
        backups: &backups,
        niri_binary: &niri,
        validate: true,
        comment: Some("integration check".to_string()),
    };

    let report = save_config(&mut set, &config, &ctx)
        .await
        .expect("the save should succeed");

    // 1. niri accepts what was written.
    let after = niriforge_lib::niri::validate_config_file(&main)
        .await
        .expect("niri validate should run");
    assert_eq!(
        after,
        ValidationOutcome::Valid,
        "the saved config must be valid"
    );
    assert_eq!(
        report.validation,
        ValidationOutcome::Valid,
        "the transaction has to say it checked"
    );

    // 2. The change is on disk, and only in the file it belongs to.
    let layout_file = files_before
        .iter()
        .find(|p| {
            std::fs::read_to_string(p)
                .unwrap_or_default()
                .contains("gaps")
        })
        .expect("the fixture has a gaps setting somewhere");
    assert!(
        std::fs::read_to_string(layout_file)
            .unwrap_or_default()
            .contains("gaps 17"),
        "the change has to be on disk in {}",
        layout_file.display()
    );

    // 3. A backup exists and holds the *whole* set, with the pre-save content.
    let backup = report.backup.expect("a successful save is backed up");
    assert_eq!(
        backup.files.len(),
        files_before.len(),
        "the backup has to cover the whole config set"
    );
    for path in &files_before {
        let relative = path
            .strip_prefix(config_dir.parent().expect("the set has a parent"))
            .expect("the file is under the fixture root");
        let stored = backup.dir.join("files").join(
            relative
                .strip_prefix(config_dir.file_name().expect("the fixture has a name"))
                .unwrap_or(relative),
        );
        assert!(
            stored.is_file(),
            "the backup is missing {} (expected {})",
            path.display(),
            stored.display()
        );
    }
    assert!(
        !std::fs::read_to_string(
            backup.dir.join("files").join(
                Path::new(config_dir.file_name().expect("name"))
                    .join("includes")
                    .join("layout.kdl")
            )
        )
        .unwrap_or_default()
        .contains("gaps 17"),
        "the backup has to hold the pre-save text, not the saved one"
    );

    // 4. Nothing was left behind: no staged candidate, no temporary file.
    for dir_to_check in &files_before {
        let parent = dir_to_check.parent().expect("a file has a parent");
        let leftovers: Vec<String> = names_in(parent)
            .into_iter()
            .filter(|n| n.contains("niriforge"))
            .collect();
        assert!(
            leftovers.is_empty(),
            "left staged files in {}: {leftovers:?}",
            parent.display()
        );
    }

    // 5. The in-memory set still matches the disk, so the next save is not a
    //    surprise.
    for path in &files_before {
        let on_disk = std::fs::read(path).expect("read");
        let in_model = set
            .file(path)
            .map(|f| f.source.clone().into_bytes())
            .unwrap_or_default();
        assert_eq!(
            in_model,
            on_disk,
            "{} has drifted from the read model",
            path.display()
        );
    }
}

#[tokio::test]
async fn a_change_niri_refuses_leaves_the_config_untouched() {
    let Some(niri) = real_niri() else {
        eprintln!("skipping: niri is not installed");
        return;
    };
    let Some((dir, config_dir)) = copy_fixture("multi-file") else {
        eprintln!("skipping: the multi-file fixture is missing");
        return;
    };
    let main = config_dir.join("config.kdl");
    let niri = niri.display().to_string();

    let mut set = kdl::parse_config(&main).expect("the fixture parses");
    let before = snapshot(&set);

    // A node niri does not know, written into the entry point. The typed model
    // cannot express that, so the text is put in directly - which is exactly the
    // situation the validate gate exists to catch.
    let staged = atomic::stage_candidate(&main, b"frobnicate 1\n").expect("staging should work");
    let outcome = niriforge_lib::niri::validate::validate_candidate_with(&niri, &staged, &main)
        .await
        .expect("niri validate should run");
    let _ = atomic::remove_staged(&staged);

    assert!(
        !outcome.is_valid(),
        "niri has to refuse a node it does not know: {outcome:?}"
    );
    let errors = outcome.errors();
    assert!(
        errors.iter().any(|e| e.message.contains("frobnicate")),
        "the user has to be told what niri objected to: {errors:?}"
    );
    assert!(
        errors
            .iter()
            .any(|e| e.line.is_some() && e.column.is_some()),
        "a diagnostic that carries a position has to be parsed: {errors:?}"
    );
    assert!(
        errors.iter().any(|e| e.file.is_some()),
        "at least one diagnostic has to name a file the user can open: {errors:?}"
    );
    assert!(
        !errors
            .iter()
            .filter_map(|e| e.file.as_deref())
            .any(|f| f.contains("niriforge-candidate")),
        "no diagnostic may point at a staged file: {errors:?}"
    );

    // The real file was never in play.
    assert_eq!(snapshot(&set), before, "the config must be untouched");
    assert!(
        !names_in(&config_dir)
            .iter()
            .any(|n| n.contains("niriforge")),
        "the staged candidate has to be gone"
    );

    // And a save that passes the gate still works, so the previous case did not
    // leave the tree in a state where nothing can be written.
    let mut config = kdl::to_config(&set).expect("mapping should work");
    config.layout.get_or_insert_with(Default::default).gaps = Some(17);
    let backups = BackupManager::with_dir(dir.path().join("backups")).expect("manager");
    let ctx = SaveContext {
        backups: &backups,
        niri_binary: &niri,
        validate: true,
        comment: None,
    };
    save_config(&mut set, &config, &ctx)
        .await
        .expect("a valid save should still succeed");
}

#[tokio::test]
async fn the_watcher_notices_a_change_niri_forces_through_a_save() {
    // The watcher and the save path are the two halves of the external-change
    // story: one writes, the other has to notice. Tested together because a
    // watcher that only sees `std::fs::write` would be useless in production,
    // where every write is an atomic replace.
    let Some(_niri) = real_niri() else {
        eprintln!("skipping: niri is not installed");
        return;
    };
    let Some((_dir, config_dir)) = copy_fixture("multi-file") else {
        eprintln!("skipping: the multi-file fixture is missing");
        return;
    };
    let main = config_dir.join("config.kdl");

    let mut set = kdl::parse_config(&main).expect("the fixture parses");
    let watcher = ConfigWatcher::start(&main, &set.paths()).expect("watching should start");
    assert_eq!(
        watcher.watched_files().len(),
        set.paths().len(),
        "every file of the set has to be watched"
    );

    let mut config = kdl::to_config(&set).expect("mapping should work");
    config.layout.get_or_insert_with(Default::default).gaps = Some(17);
    let backups = BackupManager::with_dir(config_dir.parent().expect("parent").join("backups"))
        .expect("manager");
    let niri = real_niri().expect("checked above").display().to_string();
    let ctx = SaveContext {
        backups: &backups,
        niri_binary: &niri,
        validate: true,
        comment: None,
    };

    // Subscribe after the save has been set up but before it happens, so the test
    // is about the notification rather than about winning a startup race.
    let mut rx = watcher.subscribe();
    save_config(&mut set, &config, &ctx)
        .await
        .expect("the save should succeed");

    let noticed = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    if let Some(notice) = event.notice() {
                        return Some(notice.clone());
                    }
                }
                Err(_) => return None,
            }
        }
    })
    .await
    .expect("the watcher should answer")
    .expect("a change should be reported");

    assert!(
        notice_is_one_of(&noticed, &set.paths()),
        "the change has to name a file of the set, got {}",
        noticed.path.display()
    );
}

/// Whether the notice names a file of the set the test opened.
fn notice_is_one_of(notice: &niriforge_lib::fs::watch::ChangeNotice, paths: &[PathBuf]) -> bool {
    paths.contains(&notice.path)
}
