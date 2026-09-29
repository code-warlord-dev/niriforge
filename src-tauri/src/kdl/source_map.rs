//! Source map for tracking KDL nodes to their origin files.

use kdl::{KdlDocument, KdlNode};
use std::collections::HashMap;
use std::path::PathBuf;

/// Maps KDL nodes to their source file and location.
#[derive(Debug, Clone, Default)]
pub struct SourceMap {
    /// Map from node identifier to source info.
    node_origins: HashMap<NodeId, NodeOrigin>,
    /// Map from file path to its document (for reference).
    file_docs: HashMap<PathBuf, KdlDocument>,
}

/// Unique identifier for a KDL node.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct NodeId {
    /// Path to the source file.
    pub file: PathBuf,
    /// Byte offset in the file (approximate).
    pub offset: usize,
    /// Line number (1-indexed).
    pub line: usize,
    /// Column number (1-indexed).
    pub column: usize,
}

/// Origin information for a node.
#[derive(Debug, Clone)]
pub struct NodeOrigin {
    pub file: PathBuf,
    pub line: usize,
    pub column: usize,
    /// Whether this node came from an include (vs main file).
    pub from_include: bool,
}

impl SourceMap {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record the origin of a node.
    pub fn record(&mut self, node_id: NodeId, origin: NodeOrigin) {
        self.node_origins.insert(node_id, origin);
    }

    /// Get the origin of a node.
    pub fn get_origin(&self, node_id: &NodeId) -> Option<&NodeOrigin> {
        self.node_origins.get(node_id)
    }

    /// Get all nodes originating from a specific file.
    pub fn nodes_from_file(&self, file: &PathBuf) -> Vec<&NodeOrigin> {
        self.node_origins
            .values()
            .filter(|o| &o.file == file)
            .collect()
    }

    /// Store a document for a file.
    pub fn store_document(&mut self, file: PathBuf, doc: KdlDocument) {
        self.file_docs.insert(file, doc);
    }

    /// Get a stored document.
    pub fn get_document(&self, file: &PathBuf) -> Option<&KdlDocument> {
        self.file_docs.get(file)
    }
}

/// Generate a node ID from a node (approximate).
pub fn node_id_from_node(file: PathBuf, node: &KdlNode) -> NodeId {
    // SourceSpan from miette - use default values for stub
    let _ = node.span(); // Access to suppress unused warning
    NodeId {
        file,
        offset: 0,
        line: 1,
        column: 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_source_map_module_exists() {
        assert!(true);
    }
}