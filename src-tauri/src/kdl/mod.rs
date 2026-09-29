//! KDL parsing, serialization, include resolution, and source-map for niri configs.
//!
//! # Load path
//!
//! ```text
//! load_config_set(path) -> KdlConfigSet   files + include tree + source map
//! to_config(&set)       -> Config         a projection, never the source of truth
//! apply_config(&mut set, &config) -> [files that changed]
//! serialize_file(&set, path) -> String   one file, byte for byte
//! ```
//!
//! Nothing here flattens a multi-file config into a single document. The typed
//! `Config` is a view for the UI; the AST in [`KdlConfigSet`] is what gets
//! written back, one file at a time.

pub mod include;
pub mod mapping;
pub mod parser;
pub mod serializer;
pub mod source_map;

use crate::error::{AppError, AppResult};
use crate::schema::Config;
use include::KdlConfigSet;
use std::path::{Path, PathBuf};

/// Read a config and everything it includes.
pub fn parse_config(main_path: &Path) -> AppResult<KdlConfigSet> {
    include::load_config_set(main_path)
}

/// Project a config set into the typed model.
pub fn to_config(set: &KdlConfigSet) -> AppResult<Config> {
    mapping::to_config(set).map_err(|e| AppError::schema_validation(e.to_string()))
}

/// Project a config set into the typed model, with a list of what did not fit.
pub fn to_config_with_report(set: &KdlConfigSet) -> AppResult<(Config, mapping::ConfigReport)> {
    mapping::to_config_with_report(set).map_err(|e| AppError::schema_validation(e.to_string()))
}

/// Write a typed model back into the AST.
///
/// Returns the files whose text actually changed, so the save path knows what to
/// back up and what to rewrite. A config that was loaded and not edited comes
/// back as an empty list, because nothing was written.
pub fn apply_config(set: &mut KdlConfigSet, config: &Config) -> AppResult<Vec<PathBuf>> {
    mapping::apply_config(set, config).map_err(|err| match err {
        mapping::ApplyError::At {
            file,
            line,
            message,
        } => AppError::schema_validation(format!("{}:{line}: {message}", file.display())),
        other => AppError::other(other.to_string()),
    })
}

/// Render one file of a config set back to text.
///
/// The output is byte-identical to what was read for any file nobody edited,
/// which is what makes "open the app and close it again" a no-op on disk. The
/// document is rendered through `Display` and never through `fmt`; see
/// [`serializer`] for why the pretty-printer is not on this path.
pub fn serialize_file(set: &KdlConfigSet, path: &Path) -> AppResult<String> {
    let file = set.file(path).ok_or_else(|| {
        AppError::other(format!("no such file in config set: {}", path.display()))
    })?;
    serializer::serialize_kdl(&file.doc)
}

/// Render every file of a config set, in resolution order.
pub fn serialize_all(set: &KdlConfigSet) -> AppResult<Vec<(PathBuf, String)>> {
    set.files
        .iter()
        .map(|f| Ok((f.path.clone(), serializer::serialize_kdl(&f.doc)?)))
        .collect()
}
