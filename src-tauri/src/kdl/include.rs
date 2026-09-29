//! Include resolution for multi-file niri configs.
//!
//! # Why the result is a set of files, not one merged document
//!
//! The first version of this module returned a single `KdlDocument` with every
//! included node spliced into it. That is the wrong shape for a configurator:
//! once the tree is flattened there is no way to know which file a node came
//! from, so saving would have to write the whole thing back to one file and
//! destroy the user's layout. `kdl-engine` is explicit about this ("never
//! flatten multi-file into one file on save"), so resolution keeps every file
//! intact and hands back the include tree alongside them. Merging happens only
//! in the read-only projection in [`crate::kdl::mapping`], where nothing is
//! ever written back.
//!
//! # Path and cycle semantics
//!
//! Follows niri 26.04:
//!
//! - `include "rel.kdl"` resolves against the directory of the file containing
//!   the directive, not against the entry point.
//! - `include "/abs.kdl"` is used as is.
//! - `include "~/x.kdl"` expands `~` to `$HOME`, only at the start of the path.
//! - `include optional=true "x.kdl"` tolerates a missing file; without
//!   `optional` a missing file is an error.
//! - Exactly one argument, and no children.
//!
//! Cycle detection compares canonicalized paths, unlike niri, which compares
//! the paths as written and so is defeated by `a/../a`.

use crate::error::{AppError, AppResult, IncludeError};
use crate::kdl::parser::parse_kdl;
use crate::kdl::source_map::SourceMap;
use crate::schema::IncludeEntry;
use kdl::{KdlDocument, KdlNode};
use std::path::{Path, PathBuf};

/// How deep an include chain may go.
///
/// niri's own limit is 10 ("includes cannot be 10 levels deep"), and it reports
/// that as an error rather than a warning. The `kdl-engine` skill says 8, which
/// was written before the limit was checked against a live system. Matching
/// niri matters more here: a config niri accepts must not be rejected by us,
/// and a config niri rejects must not be silently accepted. The entry point
/// itself is depth 0, so 10 means 10 levels of `include` below it.
pub const MAX_INCLUDE_DEPTH: usize = 10;

/// One `include` directive, as written in the file that contains it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IncludeDirective {
    /// The path exactly as the user wrote it, for round-tripping the directive.
    pub raw_path: String,
    /// Whether the directive carried `optional=true`.
    pub optional: bool,
}

/// A resolved `include`, linking the including file to the included one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IncludeEdge {
    pub from: PathBuf,
    pub to: PathBuf,
    pub directive: IncludeDirective,
}

/// The shape of a resolved config: which file was included by which, in what
/// order, and which optional includes did not resolve.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct IncludeTree {
    /// Canonical path of the entry point.
    pub main: PathBuf,
    /// Every resolved include, in resolution order.
    pub edges: Vec<IncludeEdge>,
    /// Canonical paths of all files that took part, entry point first.
    pub files: Vec<PathBuf>,
    /// Optional directives that pointed at a file which is not there.
    pub skipped: Vec<(PathBuf, IncludeDirective)>,
}

impl IncludeTree {
    /// Every file that has to be watched, backed up and offered for saving.
    pub fn all_files(&self) -> &[PathBuf] {
        &self.files
    }
}

/// One parsed file of a multi-file config.
#[derive(Debug, Clone)]
pub struct ConfigFile {
    /// Canonical path, used as the key everywhere.
    pub path: PathBuf,
    /// The path as it was reached, which may go through `..` or a symlink.
    pub requested_path: PathBuf,
    /// Text as read from disk, byte for byte.
    pub source: String,
    /// Parsed document. Mutating this is how an edit is made.
    pub doc: KdlDocument,
    /// False for the entry point, true for everything reached through an
    /// `include`.
    pub from_include: bool,
    /// Distance from the entry point.
    pub depth: usize,
}

/// A whole niri config: the entry point, every file it pulls in, and the tree
/// that connects them.
#[derive(Debug, Clone)]
pub struct KdlConfigSet {
    /// The file the user opened. Kept separate from `files` because every other
    /// file is only reachable relative to it.
    pub main: ConfigFile,
    /// All files, entry point first, in resolution order.
    pub files: Vec<ConfigFile>,
    /// Include structure of the set.
    pub includes: IncludeTree,
    /// Where every node came from.
    pub source_map: SourceMap,
}

impl KdlConfigSet {
    /// Look a file up by canonical path.
    pub fn file(&self, path: &Path) -> Option<&ConfigFile> {
        self.files.iter().find(|f| f.path == path)
    }

    /// Mutable access to a file, for an in-place edit.
    pub fn file_mut(&mut self, path: &Path) -> Option<&mut ConfigFile> {
        self.files.iter_mut().find(|f| f.path == path)
    }

    /// Every file path, for the watcher, the backup manager and the save path.
    pub fn paths(&self) -> Vec<PathBuf> {
        self.files.iter().map(|f| f.path.clone()).collect()
    }
}

/// Read `main_path` and every file it includes.
///
/// This is the entry point of the whole load path: the entry point is read
/// first, its includes are resolved recursively, and each file is recorded in
/// the source map against the text it was parsed from.
pub fn load_config_set(main_path: &Path) -> AppResult<KdlConfigSet> {
    let main = read_file(main_path, false, 0)?;
    let canonical = canonical_or_keep(&main.path);

    let mut set = KdlConfigSet {
        main: ConfigFile {
            path: canonical.clone(),
            ..main
        },
        files: Vec::new(),
        includes: IncludeTree {
            main: canonical.clone(),
            files: vec![canonical.clone()],
            ..IncludeTree::default()
        },
        source_map: SourceMap::new(),
    };
    set.source_map
        .record_document(canonical.clone(), &set.main.doc, &set.main.source, false);
    set.files.push(set.main.clone());

    let entry = set.main.clone();
    let mut stack = vec![canonical.clone()];
    resolve_file(&canonical, &entry, &mut set, &mut stack, 0)?;

    Ok(set)
}

fn read_file(path: &Path, from_include: bool, depth: usize) -> AppResult<ConfigFile> {
    let source = std::fs::read_to_string(path).map_err(|err| match err.kind() {
        std::io::ErrorKind::NotFound => AppError::ConfigNotFound {
            path: path.to_path_buf(),
        },
        _ => AppError::Io(format!("{}: {err}", path.display())),
    })?;
    let doc = parse_kdl(&source, path)?;
    Ok(ConfigFile {
        path: path.to_path_buf(),
        requested_path: path.to_path_buf(),
        source,
        doc,
        from_include,
        depth,
    })
}

fn canonical_or_keep(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// Resolve the includes of one already-parsed file.
fn resolve_file(
    current: &Path,
    file: &ConfigFile,
    set: &mut KdlConfigSet,
    stack: &mut Vec<PathBuf>,
    depth: usize,
) -> AppResult<()> {
    for entry in extract_includes(&file.doc)? {
        let directive = IncludeDirective {
            raw_path: entry.path.clone(),
            optional: entry.optional.unwrap_or(false),
        };
        let resolved = resolve_include_path(current, &directive.raw_path)?;
        if resolved.as_os_str().is_empty() {
            return Err(IncludeError::InvalidPath {
                path: PathBuf::from(&directive.raw_path),
                reason: "empty path".to_string(),
            }
            .into());
        }

        let canonical = match std::fs::canonicalize(&resolved) {
            Ok(path) => path,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                if directive.optional {
                    set.includes
                        .skipped
                        .push((current.to_path_buf(), directive.clone()));
                    continue;
                }
                return Err(IncludeError::NotFound {
                    path: resolved,
                    base: current.to_path_buf(),
                }
                .into());
            }
            Err(_) => return Err(IncludeError::Io { path: resolved }.into()),
        };

        if let Some(start) = stack.iter().position(|p| p == &canonical) {
            let mut cycle: Vec<PathBuf> = stack[start..].to_vec();
            cycle.push(canonical.clone());
            return Err(IncludeError::Cycle {
                path: current.to_path_buf(),
                cycle,
            }
            .into());
        }

        if depth + 1 > MAX_INCLUDE_DEPTH {
            return Err(IncludeError::DepthExceeded {
                max_depth: MAX_INCLUDE_DEPTH,
                path: canonical,
            }
            .into());
        }

        set.includes.edges.push(IncludeEdge {
            from: current.to_path_buf(),
            to: canonical.clone(),
            directive: directive.clone(),
        });

        // The same file may be included twice; niri reads it twice as well, but
        // one parsed copy is enough and keeps `files` free of duplicates that
        // would make "which copy do I edit" ambiguous.
        if set.file(&canonical).is_none() {
            let mut included = read_file(&canonical, true, depth + 1)?;
            included.requested_path = resolved;
            set.source_map.record_document(
                canonical.clone(),
                &included.doc,
                &included.source,
                true,
            );
            set.includes.files.push(canonical.clone());
            set.files.push(included.clone());

            stack.push(canonical.clone());
            resolve_file(&canonical, &included, set, stack, depth + 1)?;
            stack.pop();
        }
    }
    Ok(())
}

/// Read the `include` directives out of a document.
///
/// Only top-level nodes count: niri rejects an `include` anywhere else, so a
/// nested one is a config error rather than something to silently follow.
///
/// `optional` is the only property niri accepts. An unknown property or a
/// children block is reported as [`IncludeError::InvalidPath`] instead of being
/// ignored, because a directive that does not mean what it looks like is worse
/// than one that fails.
pub fn extract_includes(doc: &KdlDocument) -> AppResult<Vec<IncludeEntry>> {
    doc.nodes()
        .iter()
        .filter(|node| node.name().value() == "include")
        .map(directive_to_entry)
        .collect()
}

fn directive_to_entry(node: &KdlNode) -> AppResult<IncludeEntry> {
    if node.children().is_some_and(|c| !c.nodes().is_empty()) {
        return Err(IncludeError::InvalidPath {
            path: PathBuf::from(node.name().value()),
            reason: "an include cannot have a children block".to_string(),
        }
        .into());
    }

    let args: Vec<&kdl::KdlEntry> = node
        .entries()
        .iter()
        .filter(|entry| entry.name().is_none())
        .collect();
    if args.len() != 1 {
        return Err(IncludeError::InvalidPath {
            path: PathBuf::from(node.name().value()),
            reason: format!("an include takes exactly one path, found {}", args.len()),
        }
        .into());
    }

    let mut optional = None;
    for entry in node.entries() {
        let Some(name) = entry.name() else { continue };
        match name.value() {
            "optional" => {
                optional = Some(matches!(entry.value(), kdl::KdlValue::Bool(true)));
            }
            other => {
                return Err(IncludeError::InvalidPath {
                    path: PathBuf::from(other),
                    reason: format!("`{other}` is not a property of include"),
                }
                .into())
            }
        }
    }

    let raw_path = args[0]
        .value()
        .as_string()
        .ok_or_else(|| IncludeError::InvalidPath {
            path: PathBuf::from(node.name().value()),
            reason: "the path must be a string".to_string(),
        })?;

    Ok(IncludeEntry {
        path: raw_path.to_string(),
        optional,
    })
}

/// Turn the path of an `include` into a path on disk.
///
/// Resolution is relative to the file holding the directive, which is what
/// makes `cfg/display.kdl` able to include `panel/monitors.kdl`.
///
/// # Panics
///
/// Never. A path that cannot be turned into a string stays as it was, so the
/// caller reports it as [`IncludeError::InvalidPath`] with a path it can print.
pub fn resolve_include_path(base_file: &Path, include_path: &str) -> AppResult<PathBuf> {
    if include_path.is_empty() {
        return Ok(PathBuf::new());
    }

    // `~` expands only at the very start, and only as `~` or `~/...`. A `~` in
    // the middle is a literal character.
    if include_path == "~" || include_path.starts_with("~/") {
        let rest = include_path.trim_start_matches('~').trim_start_matches('/');
        let home = std::env::var_os("HOME").ok_or_else(|| IncludeError::InvalidPath {
            path: PathBuf::from(include_path),
            reason: "$HOME is not set".to_string(),
        })?;
        return Ok(PathBuf::from(home).join(rest));
    }

    let raw = Path::new(include_path);
    if raw.is_absolute() {
        return Ok(raw.to_path_buf());
    }

    Ok(base_file
        .parent()
        .unwrap_or_else(|| Path::new(""))
        .join(raw))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(content: &str) -> KdlDocument {
        parse_kdl(content, Path::new("test.kdl")).expect("valid KDL")
    }

    #[test]
    fn depth_limit_matches_niri() {
        assert_eq!(MAX_INCLUDE_DEPTH, 10);
    }

    #[test]
    fn extracts_plain_and_optional_directives() {
        let doc = parse("include \"a.kdl\"\ninclude optional=true \"b.kdl\"\n");
        let entries = extract_includes(&doc).expect("extract");
        let seen: Vec<(&str, Option<bool>)> = entries
            .iter()
            .map(|e| (e.path.as_str(), e.optional))
            .collect();
        assert_eq!(seen, vec![("a.kdl", None), ("b.kdl", Some(true))]);
    }

    #[test]
    fn ignores_non_include_nodes() {
        let doc = parse("include \"a.kdl\"\nlayout {\n  include \"nested.kdl\"\n}\n");
        let entries = extract_includes(&doc).expect("extract");
        assert_eq!(entries.len(), 1, "only top-level includes are followed");
    }

    #[test]
    fn rejects_include_with_children() {
        let doc = parse("include \"a.kdl\" {\n  nested true\n}\n");
        assert!(extract_includes(&doc).is_err());
    }

    #[test]
    fn rejects_include_with_zero_or_two_arguments() {
        assert!(extract_includes(&parse("include\n")).is_err());
        assert!(extract_includes(&parse("include \"a.kdl\" \"b.kdl\"\n")).is_err());
    }

    #[test]
    fn rejects_unknown_include_property() {
        let doc = parse("include weird=true \"a.kdl\"\n");
        let err = extract_includes(&doc).expect_err("should reject");
        assert!(
            err.to_string().contains("not a property of include"),
            "{err}"
        );
    }

    #[test]
    fn relative_paths_resolve_against_the_including_file() {
        let got = resolve_include_path(Path::new("/home/u/cfg/display.kdl"), "panel/monitors.kdl")
            .expect("resolve");
        assert_eq!(got, PathBuf::from("/home/u/cfg/panel/monitors.kdl"));
    }

    #[test]
    fn dot_dot_in_a_relative_include_is_kept() {
        // Normalization is left to canonicalize, which is also what the cycle
        // detector compares on.
        let got = resolve_include_path(Path::new("/home/u/cfg/display.kdl"), "../cfg/again.kdl")
            .expect("resolve");
        assert_eq!(got, PathBuf::from("/home/u/cfg/../cfg/again.kdl"));
    }

    #[test]
    fn absolute_paths_are_untouched() {
        let got = resolve_include_path(Path::new("/home/u/config.kdl"), "/etc/niri/extra.kdl")
            .expect("resolve");
        assert_eq!(got, PathBuf::from("/etc/niri/extra.kdl"));
    }

    #[test]
    fn tilde_expands_only_at_the_start() {
        let home = std::env::var("HOME").expect("HOME is set on a real system");
        let got = resolve_include_path(Path::new("/config.kdl"), "~/niri/extra.kdl").expect("res");
        assert_eq!(got, PathBuf::from(home).join("niri/extra.kdl"));

        let literal = resolve_include_path(Path::new("/config.kdl"), "/opt/~/x.kdl").expect("res");
        assert_eq!(literal, PathBuf::from("/opt/~/x.kdl"));
    }

    #[test]
    fn empty_path_is_reported_rather_than_resolved() {
        let got = resolve_include_path(Path::new("/config.kdl"), "").expect("resolve");
        assert!(got.as_os_str().is_empty());
    }
}
