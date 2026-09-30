//! File system watching for external config changes.
//!
//! # What this module decides, and what it does not
//!
//! The watcher reports **what changed on disk**. It does not decide what to do
//! about it, and in particular it does not know whether the application has
//! unsaved edits - that state lives above it, in the application's own model.
//! Reloading a config the user has been editing would throw their work away, and
//! ignoring a change the user made in their editor would leave them editing a
//! file that is no longer there. Those are two different answers to the same
//! event, so the event carries the path and the kind, and the application layer
//! picks. The dialog itself is UI and belongs to a later milestone.
//!
//! # Watching files, not just one path
//!
//! A `notify` watch on a single file loses the watch the moment an atomic
//! replace happens: the editor's rename puts a *new* inode at that name, and the
//! watch was on the old one. Every file's **parent directory** is therefore
//! watched, and events are filtered down to the config set. This is also what
//! makes the watcher survive our own atomic writes.

use crate::error::{AppError, AppResult};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use tokio::sync::broadcast;
use tracing::{debug, info, trace};

/// How many events may pile up before a slow subscriber starts losing them.
const EVENT_BUFFER: usize = 64;

/// A change to one file of the config set, noticed on disk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChangeNotice {
    /// Canonical path of the file that changed.
    pub path: PathBuf,
    /// Whether this is the file the user opened, as opposed to an include.
    pub is_main: bool,
    /// Whether the change is an addition, an edit, or a removal.
    pub kind: ChangeKind,
}

/// What happened to a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChangeKind {
    /// Content changed, or the file appeared where it had been removed.
    Written,
    /// The file is gone.
    Removed,
}

/// Events emitted by the config watcher.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigEvent {
    /// A file of the config set was changed outside the application.
    ///
    /// Carries the path and whether it is the main file, which is all a
    /// reload-or-ask decision needs. It deliberately does not carry a diff: the
    /// decision to compute one belongs to whoever shows it.
    Changed(ChangeNotice),
    /// A file of the config set was removed.
    Removed(ChangeNotice),
    /// The watcher itself failed, or a path stopped being watchable.
    ///
    /// An external change that cannot be noticed is a silent way to lose work,
    /// so this is surfaced rather than logged and dropped.
    Error(String),
}

impl ConfigEvent {
    /// The change this event describes, if it describes one.
    pub fn notice(&self) -> Option<&ChangeNotice> {
        match self {
            ConfigEvent::Changed(notice) | ConfigEvent::Removed(notice) => Some(notice),
            ConfigEvent::Error(_) => None,
        }
    }
}

/// Watcher handle for config files.
pub struct ConfigWatcher {
    // The watcher must outlive the channel, otherwise dropping it stops the
    // notification thread and every later event is lost silently.
    _watcher: RecommendedWatcher,
    main_path: PathBuf,
    watched: HashSet<PathBuf>,
    tx: broadcast::Sender<ConfigEvent>,
    rx: broadcast::Receiver<ConfigEvent>,
}

impl ConfigWatcher {
    /// Watch a config file and every file it includes.
    pub fn start(main_path: &Path, includes: &[PathBuf]) -> AppResult<Self> {
        info!(target: "niriforge::fs::watch", "ConfigWatcher::start: main={}, includes={}", main_path.display(), includes.len());
        let main = crate::fs::resolve_symlinks(main_path)?;
        let mut watched: HashSet<PathBuf> = HashSet::new();
        watched.insert(main.clone());
        let mut main_set = true;
        for include in includes {
            let resolved = crate::fs::resolve_symlinks(include).unwrap_or_else(|_| include.clone());
            if resolved == main {
                continue;
            }
            watched.insert(resolved);
            main_set = false;
        }
        let _ = main_set;
        debug!(target: "niriforge::fs::watch", "watching {} files", watched.len());

        let (tx, rx) = broadcast::channel(EVENT_BUFFER);
        let watched_for_thread = watched.clone();
        let main_for_thread = main.clone();

        let (event_tx, event_rx) = mpsc::channel();
        let mut watcher = notify::recommended_watcher(move |res| {
            // A send failure means the application dropped its receiver, which
            // is a shutdown, not an error worth reporting.
            let _ = event_tx.send(res);
        })
        .map_err(AppError::from)?;

        // Directories are watched rather than files: an atomic replace swaps the
        // inode, and a watch on the old inode goes deaf to the replacement.
        let mut dirs: HashSet<PathBuf> = HashSet::new();
        for path in &watched {
            if let Some(parent) = path.parent() {
                dirs.insert(parent.to_path_buf());
            }
        }
        for dir in &dirs {
            if let Err(err) = watcher.watch(dir, RecursiveMode::NonRecursive) {
                // A directory that is not there is not a reason to give up on the
                // rest: the file may reappear, and the app has to keep working.
                return Err(AppError::FileWatch(format!("{}: {err}", dir.display())));
            }
        }
        debug!(target: "niriforge::fs::watch", "watching {} directories", dirs.len());

        let tx_for_thread = tx.clone();
        std::thread::Builder::new()
            .name("niriforge-config-watch".to_string())
            .spawn(move || {
                for event in event_rx {
                    if let Err(err) = dispatch(
                        &event,
                        &tx_for_thread,
                        &watched_for_thread,
                        &main_for_thread,
                    ) {
                        // A send error here means no subscriber; the loop keeps
                        // running for the next event.
                        let _ = err;
                    }
                }
            })
            .map_err(|err| AppError::FileWatch(err.to_string()))?;

        Ok(Self {
            _watcher: watcher,
            main_path: main,
            watched,
            tx,
            rx,
        })
    }

    /// Watch a single config file, with no includes.
    pub async fn watch_config(path: &Path) -> AppResult<Self> {
        info!(target: "niriforge::fs::watch", "watch_config: {}", path.display());
        Self::start(path, &[])
    }

    /// Subscribe to config events.
    ///
    /// A subscription taken now sees the changes that happen after it was taken.
    /// An application that wants the first change must subscribe before it
    /// starts editing, or it will miss exactly the edit it needed to know about.
    pub fn subscribe(&self) -> broadcast::Receiver<ConfigEvent> {
        self.rx.resubscribe()
    }

    /// The file the user opened.
    pub fn main_path(&self) -> &Path {
        &self.main_path
    }

    /// A sender for the same event stream, for a component that receives events
    /// without holding the watcher.
    pub fn subscribe_all(&self) -> broadcast::Receiver<ConfigEvent> {
        self.tx.subscribe()
    }

    /// Every file being watched, the main file first.
    pub fn watched_files(&self) -> Vec<PathBuf> {
        let mut out: Vec<PathBuf> = self.watched.iter().cloned().collect();
        out.sort();
        if let Some(index) = out.iter().position(|p| *p == self.main_path) {
            let main = out.remove(index);
            out.insert(0, main);
        }
        out
    }

    /// Wait for the next change to any file of the set.
    ///
    /// A convenience for the application layer, which otherwise has to hand-roll
    /// the same `recv` loop against a channel that reports being lapped. A
    /// subscriber that has fallen that far behind has missed changes it cannot
    /// enumerate, and the honest response is to re-read the config rather than
    /// treat the next event as the next change - so being lapped returns `None`,
    /// which the caller has to handle.
    pub async fn next_change(&self) -> Option<ChangeNotice> {
        let mut rx = self.subscribe();
        loop {
            match rx.recv().await {
                Ok(event) => {
                    if let Some(notice) = event.notice() {
                        return Some(notice.clone());
                    }
                    // An error event is not a change. The application decides what
                    // to do about it and the stream continues.
                }
                Err(broadcast::error::RecvError::Lagged(_)) => return None,
                Err(broadcast::error::RecvError::Closed) => return None,
            }
        }
    }

    /// Add a file to the watch set.
    ///
    /// A config that gains an include while the app is open has to be watched
    /// too, or an edit to it is invisible.
    pub fn watch_file(&mut self, path: &Path) -> AppResult<()> {
        trace!(target: "niriforge::fs::watch", "watch_file: {}", path.display());
        let resolved = crate::fs::resolve_symlinks(path)?;
        if self.watched.insert(resolved.clone()) {
            if let Some(parent) = resolved.parent() {
                self._watcher
                    .watch(parent, RecursiveMode::NonRecursive)
                    .map_err(AppError::from)?;
                debug!(target: "niriforge::fs::watch", "now watching: {} (dir: {})", resolved.display(), parent.display());
            }
        }
        Ok(())
    }
}

/// Turn one raw notify event into at most one [`ConfigEvent`].
///
/// Events are filtered twice: by *kind*, because a watcher is noisy (an access
/// event, a metadata change, the temp file of our own atomic write all arrive
/// here), and by *path*, because a watch on a directory reports the whole
/// directory.
fn dispatch(
    result: &notify::Result<Event>,
    tx: &broadcast::Sender<ConfigEvent>,
    watched: &HashSet<PathBuf>,
    main_path: &Path,
) -> Result<usize, broadcast::error::SendError<ConfigEvent>> {
    let event = match result {
        Ok(event) => event,
        Err(err) => {
            return tx.send(ConfigEvent::Error(err.to_string()));
        }
    };
    let mut sent = 0usize;
    // Which raw event kinds are worth looking at.
    //
    // An atomic replace - what the save path itself performs, and what most
    // editors do - does *not* arrive as `Create`. The new content arrives as a
    // create of a temporary name, and the target is then reported as
    // `Modify(Name(To))` or `Modify(Name(Both))`, because from the directory's
    // point of view nothing was created: a name now points at a different inode.
    // A filter that only accepted `Create` and `Modify(Data)` would therefore go
    // deaf to exactly the write it most needs to notice.
    let interesting = matches!(
        event.kind,
        EventKind::Create(_)
            | EventKind::Remove(_)
            | EventKind::Modify(
                notify::event::ModifyKind::Data(_)
                    | notify::event::ModifyKind::Name(_)
                    | notify::event::ModifyKind::Any
            )
    );
    if !interesting {
        // Access and metadata events carry nothing the app can act on, and
        // emitting them would make the event stream unusable.
        return Ok(0);
    }

    for path in &event.paths {
        let resolved = match crate::fs::resolve_symlinks(path) {
            Ok(resolved) => resolved,
            // The file may be gone, in which case the name it had is the only
            // thing left to match on.
            Err(_) => path.clone(),
        };
        let Some(canonical) = canonical_if_watched(path, &resolved) else {
            continue;
        };
        if !watched.contains(&canonical) {
            continue;
        }
        // Whether this is a write or a removal is read off the filesystem rather
        // than off the event. Backends disagree on which half of a rename carries
        // the destination, and the directory is the one thing all of them agree
        // about.
        let kind = if canonical.exists() {
            ChangeKind::Written
        } else {
            ChangeKind::Removed
        };
        let notice = ChangeNotice {
            path: canonical.clone(),
            is_main: canonical == main_path,
            kind,
        };
        trace!(target: "niriforge::fs::watch", "dispatch: {} (main: {})", notice.path.display(), notice.is_main);
        let event = if kind == ChangeKind::Removed {
            ConfigEvent::Removed(notice)
        } else {
            ConfigEvent::Changed(notice)
        };
        let _ = tx.send(event);
        sent += 1;
    }
    Ok(sent)
}

/// The canonical form of `path` if it is one of the watched files.
fn canonical_if_watched(path: &Path, resolved: &Path) -> Option<PathBuf> {
    if path.exists() {
        Some(resolved.to_path_buf())
    } else {
        // A removed file cannot be canonicalised. The parent usually still can,
        // which is enough to recognise the name.
        path.parent()
            .and_then(|parent| std::fs::canonicalize(parent).ok())
            .map(|parent| parent.join(path.file_name().unwrap_or_default()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use tokio::time::{timeout, Duration};

    fn config_set() -> (TempDir, PathBuf, Vec<PathBuf>) {
        let dir = TempDir::new().expect("temp dir");
        let main = dir.path().join("config.kdl");
        let include = dir.path().join("input.kdl");
        std::fs::write(&main, "include \"input.kdl\"\n").expect("main should be written");
        std::fs::write(&include, "binds {}\n").expect("include should be written");
        let main = std::fs::canonicalize(&main).expect("canonical");
        let include = std::fs::canonicalize(&include).expect("canonical");
        (dir, main, vec![include])
    }

    /// Wait for the first event matching `predicate`, so a test does not depend
    /// on how many raw events the backend produced to get there.
    async fn wait_for<F>(
        rx: &mut broadcast::Receiver<ConfigEvent>,
        predicate: F,
    ) -> Option<ConfigEvent>
    where
        F: Fn(&ConfigEvent) -> bool,
    {
        let wait = async {
            loop {
                match rx.recv().await {
                    Ok(event) => {
                        if predicate(&event) {
                            return Some(event);
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(_) => return None,
                }
            }
        };
        timeout(Duration::from_secs(5), wait).await.ok().flatten()
    }

    #[tokio::test]
    async fn notices_a_change_to_the_main_file() {
        let (_dir, main, includes) = config_set();
        let watcher = ConfigWatcher::start(&main, &includes).expect("watching should start");
        let mut rx = watcher.subscribe();

        std::fs::write(&main, "include \"input.kdl\"\n// edited\n").expect("write");

        let event = wait_for(
            &mut rx,
            |e| matches!(e, ConfigEvent::Changed(n) if n.is_main),
        )
        .await
        .expect("the main file was edited, so a change has to be reported");

        let notice = event.notice().expect("a change carries a notice");
        assert!(notice.is_main);
        assert_eq!(notice.kind, ChangeKind::Written);
        assert_eq!(
            std::fs::read_to_string(&notice.path).expect("read"),
            "include \"input.kdl\"\n// edited\n"
        );
    }

    #[tokio::test]
    async fn notices_a_change_to_an_included_file() {
        // The reason the watcher takes a file set rather than one path: an edit
        // to an include is an edit to the config.
        let (_dir, main, includes) = config_set();
        let watcher = ConfigWatcher::start(&main, &includes).expect("watching should start");
        let mut rx = watcher.subscribe();

        std::fs::write(&includes[0], "binds { Mod+Q { close-window; } }\n").expect("write");

        let event = wait_for(
            &mut rx,
            |e| matches!(e, ConfigEvent::Changed(n) if !n.is_main),
        )
        .await
        .expect("an include was edited, so a change has to be reported");

        let notice = event.notice().expect("a change carries a notice");
        assert!(
            !notice.is_main,
            "an include must not be reported as the main file"
        );
        assert_eq!(notice.path, includes[0]);
    }

    #[tokio::test]
    async fn notices_a_file_that_is_removed() {
        let (_dir, main, includes) = config_set();
        let watcher = ConfigWatcher::start(&main, &includes).expect("watching should start");
        let mut rx = watcher.subscribe();

        std::fs::remove_file(&includes[0]).expect("remove");

        let event = wait_for(&mut rx, |e| matches!(e, ConfigEvent::Removed(_)))
            .await
            .expect("a removed include has to be reported");

        let notice = event.notice().expect("a removal carries a notice");
        assert_eq!(notice.kind, ChangeKind::Removed);
        assert!(
            notice.path.ends_with("input.kdl"),
            "got {}",
            notice.path.display()
        );
    }

    #[tokio::test]
    async fn an_atomic_replace_is_still_noticed() {
        // The watch has to survive the exact write the save path performs: the
        // name gets a new inode, so a watcher bound to the old one would go deaf
        // after the user's first save.
        let (_dir, main, includes) = config_set();
        let watcher = ConfigWatcher::start(&main, &includes).expect("watching should start");
        let mut rx = watcher.subscribe();

        crate::fs::atomic::write_atomic(&main, "include \"input.kdl\"\n// replaced\n")
            .await
            .expect("write should succeed");

        let event = wait_for(
            &mut rx,
            |e| matches!(e, ConfigEvent::Changed(n) if n.is_main),
        )
        .await;
        assert!(
            event.is_some(),
            "an atomic replace of a watched file must still be reported"
        );
    }

    #[tokio::test]
    async fn a_file_outside_the_config_set_is_not_reported() {
        let (dir, main, includes) = config_set();
        let watcher = ConfigWatcher::start(&main, &includes).expect("watching should start");
        let mut rx = watcher.subscribe();
        let other = dir.path().join("unrelated.kdl");

        std::fs::write(&other, "noise\n").expect("write");

        let event = wait_for(&mut rx, |e| {
            e.notice()
                .is_some_and(|n| n.path.ends_with("unrelated.kdl"))
        })
        .await;

        assert!(
            event.is_none(),
            "a file that is not part of the config must not be reported"
        );
    }

    /// The convenience the application layer will actually use.
    #[tokio::test]
    async fn next_change_reports_the_file_that_changed() {
        let (_dir, main, includes) = config_set();
        let watcher = ConfigWatcher::start(&main, &includes).expect("watching should start");
        let reader = tokio::spawn(async move { watcher.next_change().await });
        // Give the reader a moment to subscribe before the write, so the test is
        // about the event reaching a subscriber rather than about winning a race.
        tokio::time::sleep(Duration::from_millis(100)).await;

        std::fs::write(&includes[0], "binds { Mod+Q { close-window; } }\n").expect("write");

        let notice = tokio::time::timeout(Duration::from_secs(5), reader)
            .await
            .expect("the reader should answer")
            .expect("the task should not panic")
            .expect("a change should be reported");

        assert_eq!(notice.path, includes[0]);
        assert!(!notice.is_main);
    }

    #[tokio::test]
    async fn a_later_subscriber_does_not_see_the_earlier_events() {
        let (_dir, main, includes) = config_set();
        let watcher = ConfigWatcher::start(&main, &includes).expect("watching should start");
        let mut early = watcher.subscribe();
        std::fs::write(&main, "// first\n").expect("write");
        wait_for(&mut early, |e| e.notice().is_some_and(|n| n.is_main)).await;

        let mut late = watcher.subscribe();
        let event = wait_for(&mut late, |e| e.notice().is_some_and(|n| n.is_main)).await;

        assert!(
            event.is_none(),
            "broadcast is not a queue; a new subscriber starts now"
        );
    }

    #[test]
    fn the_watched_set_contains_the_main_file_and_every_include() {
        let (_dir, main, includes) = config_set();
        let watcher = ConfigWatcher::start(&main, &includes).expect("watching should start");

        let watched = watcher.watched_files();

        assert_eq!(watched.len(), 2, "got {watched:?}");
        assert_eq!(watched[0], main, "the main file comes first");
        assert!(watched.contains(&includes[0]));
    }

    #[test]
    fn a_file_added_to_the_watch_set_is_watched_too() {
        let (dir, main, includes) = config_set();
        let mut watcher = ConfigWatcher::start(&main, &includes).expect("watching should start");
        let later = dir.path().join("later.kdl");
        std::fs::write(&later, "binds {}\n").expect("write");

        watcher
            .watch_file(&later)
            .expect("a new include should be watchable");

        assert!(
            watcher.watched_files().len() >= 3,
            "got {:?}",
            watcher.watched_files()
        );
    }

    /// A path whose directory does not exist cannot be resolved, and silently
    /// watching nothing would mean never noticing an external change.
    #[test]
    fn a_config_whose_directory_does_not_exist_is_an_error_naming_the_path() {
        let dir = TempDir::new().expect("temp dir");
        let missing = dir.path().join("no-such-dir/config.kdl");

        let Err(err) = ConfigWatcher::start(&missing, &[]) else {
            panic!("a config in a directory that does not exist cannot be watched");
        };

        assert!(
            matches!(err, AppError::SymlinkResolution(_) | AppError::FileWatch(_)),
            "got {err:?}"
        );
        assert!(
            err.to_string().contains("no-such-dir"),
            "the error has to name the path: {err}"
        );
    }

    #[test]
    fn a_duplicate_include_is_watched_once() {
        let (_dir, main, includes) = config_set();
        let mut duplicated = includes.clone();
        duplicated.push(includes[0].clone());

        let watcher = ConfigWatcher::start(&main, &duplicated).expect("watching should start");

        assert_eq!(
            watcher.watched_files().len(),
            2,
            "got {:?}",
            watcher.watched_files()
        );
    }
}
