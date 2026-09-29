//! KDL parser with comment preservation and error location tracking.

use crate::error::{AppError, AppResult};
use kdl::{KdlDocument, KdlNode};
use std::path::Path;

/// Parse a KDL file into a document.
#[allow(dead_code, unused_variables)]
pub fn parse_file(path: &Path) -> AppResult<KdlDocument> {
    Err(AppError::other("Not implemented yet"))
}

/// Parse a KDL string into a document.
#[allow(dead_code, unused_variables)]
pub fn parse_str(content: &str) -> AppResult<KdlDocument> {
    Err(AppError::other("Not implemented yet"))
}

/// Extract a typed value from a KDL node with location info.
#[allow(dead_code, unused_variables)]
pub fn node_get_value<T>(node: &KdlNode, key: &str) -> AppResult<Option<T>>
where
    T: for<'de> serde::Deserialize<'de>,
{
    Err(AppError::other("Not implemented yet"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parser_module_exists() {
        assert!(true);
    }
}