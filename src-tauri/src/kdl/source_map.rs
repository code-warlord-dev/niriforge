//! Source map for tracking KDL nodes to their origin files.

use kdl::{KdlDocument, KdlNode};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Unique identifier for a KDL node based on its source location.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct NodeId {
    /// Path to the source file.
    pub file: PathBuf,
    /// Byte offset in the file.
    pub offset: usize,
    /// Length of the node span.
    pub length: usize,
}

/// Origin information for a node.
#[derive(Debug, Clone)]
pub struct NodeOrigin {
    pub file: PathBuf,
    pub offset: usize,
    pub length: usize,
    /// Whether this node came from an include (vs main file).
    pub from_include: bool,
}

impl NodeOrigin {
    pub fn new(file: PathBuf, offset: usize, length: usize, from_include: bool) -> Self {
        Self {
            file,
            offset,
            length,
            from_include,
        }
    }

    /// Get the byte range of this node in the source file.
    pub fn byte_range(&self) -> std::ops::Range<usize> {
        self.offset..self.offset + self.length
    }

    /// Get the line/column information (1-indexed).
    pub fn line_column(&self, source: &str) -> (usize, usize) {
        crate::error::line_column_at(source, self.offset)
    }
}

/// Public source info returned by the API.
#[derive(Debug, Clone)]
pub struct SourceInfo {
    pub file: PathBuf,
    pub span: std::ops::Range<usize>,
    pub from_include: bool,
}

/// Maps KDL nodes to their source file and location.
#[derive(Debug, Clone, Default)]
pub struct SourceMap {
    /// Map from node identifier to source info.
    node_origins: HashMap<NodeId, NodeOrigin>,
    /// Map from file path to its source content (for line/column calculation).
    file_sources: HashMap<PathBuf, String>,
    /// Map from file path to its document (for reference).
    file_docs: HashMap<PathBuf, KdlDocument>,
}

impl SourceMap {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record the origin of a node.
    pub fn record(&mut self, node_id: NodeId, origin: NodeOrigin) {
        self.node_origins.insert(node_id, origin);
    }

    /// Record multiple nodes from a document with the same file source.
    pub fn record_document(&mut self, file: PathBuf, doc: &KdlDocument, from_include: bool) {
        let source = doc.to_string();
        self.file_sources.insert(file.clone(), source);
        self.file_docs.insert(file.clone(), doc.clone());

        for node in doc.nodes() {
            self.record_node(file.clone(), node, from_include);
        }
    }

    fn record_node(&mut self, file: PathBuf, node: &KdlNode, from_include: bool) {
        let span = node.span();
        let node_id = NodeId {
            file: file.clone(),
            offset: span.offset(),
            length: span.len(),
        };
        let origin = NodeOrigin::new(file.clone(), span.offset(), span.len(), from_include);
        self.node_origins.insert(node_id, origin);

        // Recursively record children
        if let Some(children) = node.children() {
            for child in children.nodes() {
                self.record_node(file.clone(), child, from_include);
            }
        }
    }

    /// Get the origin of a node by its ID.
    pub fn get_origin(&self, node_id: &NodeId) -> Option<&NodeOrigin> {
        self.node_origins.get(node_id)
    }

    /// Get source info for a node (public API).
    ///
    /// Caveat: a bare node carries no file identity, so the match is made on
    /// offset/length alone. Once two files are mapped, a node can therefore
    /// resolve to the wrong file. Prefer [`SourceMap::get_source_by_id`] with an
    /// id built by [`SourceMap::node_id_for`] whenever the file is known.
    pub fn get_source(&self, node: &KdlNode) -> Option<SourceInfo> {
        let span = node.span();
        // Nodes are not addressable across calls, so the span is the only key
        // available here. See the caveat above.
        for (id, origin) in &self.node_origins {
            if id.offset == span.offset() && id.length == span.len() {
                return Some(SourceInfo {
                    file: origin.file.clone(),
                    span: origin.byte_range(),
                    from_include: origin.from_include,
                });
            }
        }
        None
    }

    /// Get source info by explicit node ID.
    pub fn get_source_by_id(&self, node_id: &NodeId) -> Option<SourceInfo> {
        self.node_origins.get(node_id).map(|origin| SourceInfo {
            file: origin.file.clone(),
            span: origin.byte_range(),
            from_include: origin.from_include,
        })
    }

    /// Get all nodes originating from a specific file.
    pub fn nodes_from_file(&self, file: &Path) -> Vec<&NodeOrigin> {
        self.node_origins
            .values()
            .filter(|o| o.file == *file)
            .collect()
    }

    /// Store a document for a file.
    pub fn store_document(&mut self, file: PathBuf, doc: KdlDocument) {
        let source = doc.to_string();
        self.file_sources.insert(file.clone(), source);
        self.file_docs.insert(file, doc);
    }

    /// Get a stored document.
    pub fn get_document(&self, file: &Path) -> Option<&KdlDocument> {
        self.file_docs.get(file)
    }

    /// Get the source content for a file.
    pub fn get_source_content(&self, file: &Path) -> Option<&str> {
        self.file_sources.get(file).map(String::as_str)
    }

    /// Get the NodeId for a node (based on its span).
    pub fn node_id_for(&self, file: &Path, node: &KdlNode) -> NodeId {
        let span = node.span();
        NodeId {
            file: file.to_path_buf(),
            offset: span.offset(),
            length: span.len(),
        }
    }

    /// Get all tracked files.
    pub fn files(&self) -> impl Iterator<Item = &PathBuf> {
        self.file_sources.keys()
    }
}

/// Generate a node ID from a node and file.
pub fn node_id_from_node(file: PathBuf, node: &KdlNode) -> NodeId {
    let span = node.span();
    NodeId {
        file,
        offset: span.offset(),
        length: span.len(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kdl::parser::parse_kdl;
    use std::path::PathBuf;

    const SRC: &str =
        "// top\noutput \"eDP-1\" {\n    mode \"1920x1080\"\n}\nlayout {\n    gaps 10\n}\n";

    fn file() -> PathBuf {
        PathBuf::from("/test/config.kdl")
    }

    fn mapped() -> (SourceMap, KdlDocument) {
        let doc = parse_kdl(SRC, Path::new("/test/config.kdl")).expect("valid KDL");
        let mut map = SourceMap::new();
        map.record_document(file(), &doc, false);
        (map, doc)
    }

    #[test]
    fn records_every_node_including_children() {
        let (map, doc) = mapped();
        // output + mode + layout + gaps
        assert_eq!(map.nodes_from_file(&file()).len(), 4);
        assert_eq!(map.get_document(&file()), Some(&doc));
        assert!(map.get_document(Path::new("/other.kdl")).is_none());
    }

    #[test]
    fn stored_source_is_the_original_text() {
        let (map, _) = mapped();
        assert_eq!(map.get_source_content(&file()), Some(SRC));
    }

    #[test]
    fn node_ids_round_trip_to_source_spans() {
        let (map, doc) = mapped();
        let layout = doc.nodes().last().expect("layout node");
        let id = map.node_id_for(&file(), layout);

        let origin = map.get_origin(&id).expect("recorded origin");
        assert_eq!(origin.byte_range(), id.offset..id.offset + id.length);
        assert!(!origin.from_include);

        // The span has to point back at the node's own text, not at a
        // re-serialized approximation of it.
        assert_eq!(&SRC[origin.byte_range()][..6], "layout");

        let info = map.get_source_by_id(&id).expect("source info");
        assert_eq!(info.file, file());
        assert_eq!(info.span, origin.byte_range());
        assert!(!info.from_include);
    }

    #[test]
    fn child_nodes_get_their_own_spans() {
        let (map, doc) = mapped();
        let output = doc.nodes().first().expect("output node");
        let mode = output
            .children()
            .expect("children")
            .nodes()
            .first()
            .expect("mode node");
        let id = map.node_id_for(&file(), mode);
        assert!(map.get_source_by_id(&id).is_some());
        assert_eq!(&SRC[id.offset..id.offset + id.length][..4], "mode");
    }

    #[test]
    fn includes_are_flagged_in_their_origins() {
        let doc = parse_kdl(
            "binds {\n    Mod+Q { close-window; }\n}\n",
            Path::new("binds.kdl"),
        )
        .expect("valid KDL");
        let mut map = SourceMap::new();
        map.record_document(PathBuf::from("binds.kdl"), &doc, true);
        assert!(map
            .nodes_from_file(Path::new("binds.kdl"))
            .iter()
            .all(|o| o.from_include));
    }

    #[test]
    fn line_column_is_one_based() {
        let origin = NodeOrigin::new(file(), 0, 4, false);
        assert_eq!(origin.line_column(SRC), (1, 1));

        let second_line = SRC.find("output").expect("second line starts here");
        let origin = NodeOrigin::new(file(), second_line, 6, false);
        assert_eq!(origin.line_column(SRC), (2, 1));
    }

    #[test]
    fn unknown_node_has_no_source_info() {
        let (map, _) = mapped();
        let foreign = parse_kdl("elsewhere 1\n", Path::new("other.kdl")).expect("valid KDL");
        let node = foreign.nodes().first().expect("node");
        let id = map.node_id_for(&file(), node);
        assert!(map.get_source_by_id(&id).is_none());
    }

    #[test]
    fn node_id_from_node_matches_node_id_for() {
        let (_, doc) = mapped();
        let layout = doc.nodes().last().expect("layout node");
        let a = node_id_from_node(file(), layout);
        let b = SourceMap::new().node_id_for(&file(), layout);
        assert_eq!(a, b);
    }
}
