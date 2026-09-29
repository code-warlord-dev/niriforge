//! Include resolution for multi-file niri configs.

use crate::error::{AppError, AppResult};
use crate::kdl::source_map::SourceMap;
use crate::schema::IncludeEntry;
use kdl::KdlDocument;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Maximum include depth to prevent cycles.
#[allow(dead_code)]
const MAX_INCLUDE_DEPTH: usize = 8;

/// Resolve all includes in a KDL document, returning merged document and source map.
#[allow(dead_code, unused_variables)]
pub fn resolve_includes(
    main_path: &Path,
    doc: KdlDocument,
    source_map: &mut SourceMap,
) -> AppResult<KdlDocument> {
    Err(AppError::other("Not implemented yet"))
}

/// Recursively resolve includes with cycle detection.
#[allow(dead_code, unused_variables)]
fn resolve_includes_recursive(
    current_path: &Path,
    doc: KdlDocument,
    source_map: &mut SourceMap,
    visited: &mut HashSet<PathBuf>,
    depth: usize,
) -> AppResult<KdlDocument> {
    Err(AppError::other("Not implemented yet"))
}

/// Extract include entries from a document.
#[allow(dead_code, unused_variables)]
pub fn extract_includes(doc: &KdlDocument) -> Vec<IncludeEntry> {
    Vec::new()
}

/// Resolve a relative include path against a base directory.
#[allow(dead_code, unused_variables)]
pub fn resolve_include_path(base: &Path, include_path: &str) -> PathBuf {
    base.parent().unwrap_or(base).join(include_path)
}
