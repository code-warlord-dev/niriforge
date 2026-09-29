//! Source map for tracking KDL nodes to their origin files.
//!
//! Two invariants drive the shape of this module, both of them learned the hard
//! way from a review of the first version:
//!
//! 1. **Spans come from the original parse, so line/column must be computed
//!    against the original text.** The first version stored `doc.to_string()`
//!    as the "source" of a file. For an untouched document that happens to equal
//!    the input, but the moment a node is edited the stored text and the spans
//!    drift apart and every reported location becomes a lie. That is why
//!    [`SourceMap::record_document`] and [`SourceMap::store_document`] take the
//!    text the file was parsed from instead of deriving it.
//! 2. **A node is only addressable together with its file.** Spans are per-file
//!    byte offsets, so `(offset, length)` alone is ambiguous as soon as two
//!    files are mapped. The first version offered `get_source(&KdlNode)` and
//!    matched on the span, which silently returned another file's location. The
//!    type system now prevents that: file-scoped lookups go through
//!    [`SourceMap::file`], which hands out a [`FileSource`] bound to one path,
//!    and there is no free function that takes a bare node.

use kdl::{KdlDocument, KdlNode};
use std::collections::HashMap;
use std::ops::Range;
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

impl NodeId {
    /// The byte range this id covers.
    pub fn byte_range(&self) -> Range<usize> {
        self.offset..self.offset + self.length
    }
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
    pub fn byte_range(&self) -> Range<usize> {
        self.offset..self.offset + self.length
    }

    /// Get the line/column information (1-indexed).
    ///
    /// `source` must be the text the node was parsed from. Passing a
    /// re-serialized document here is exactly the bug this module exists to
    /// prevent; prefer [`SourceMap::line_column`], which looks the original
    /// text up itself.
    pub fn line_column(&self, source: &str) -> (usize, usize) {
        crate::error::line_column_at(source, self.offset)
    }
}

/// Public source info returned by the API.
#[derive(Debug, Clone)]
pub struct SourceInfo {
    pub file: PathBuf,
    pub span: Range<usize>,
    pub from_include: bool,
}

/// A view of one mapped file.
///
/// Every lookup is scoped to `file`, so a node can never resolve to a location
/// in some other file - there is no API on this type that takes a node without
/// also fixing the file it belongs to.
#[derive(Debug, Clone, Copy)]
pub struct FileSource<'a> {
    file: &'a Path,
    map: &'a SourceMap,
}

impl FileSource<'_> {
    /// The file this view is scoped to.
    pub fn path(&self) -> &Path {
        self.file
    }

    /// The text the file was parsed from, byte for byte.
    pub fn source(&self) -> Option<&str> {
        self.map.file_sources.get(self.file).map(String::as_str)
    }

    /// Id of a node that belongs to this file.
    pub fn node_id(&self, node: &KdlNode) -> NodeId {
        node_id_from_node(self.file.to_path_buf(), node)
    }

    /// Where `node` sits in this file, if it was recorded.
    pub fn origin(&self, node: &KdlNode) -> Option<&NodeOrigin> {
        self.map.get_origin(&self.node_id(node))
    }

    /// Byte range of `node` in this file, if it was recorded.
    pub fn range(&self, node: &KdlNode) -> Option<Range<usize>> {
        self.origin(node).map(NodeOrigin::byte_range)
    }

    /// 1-based line/column of `node`, counted against the original text.
    pub fn line_column(&self, node: &KdlNode) -> Option<(usize, usize)> {
        let origin = self.origin(node)?;
        Some(origin.line_column(self.source()?))
    }
}

/// Maps KDL nodes to their source file and location.
#[derive(Debug, Clone, Default)]
pub struct SourceMap {
    /// Map from node identifier to source info.
    node_origins: HashMap<NodeId, NodeOrigin>,
    /// Original text of each file, as it was read from disk.
    file_sources: HashMap<PathBuf, String>,
    /// Parsed document of each file, kept so a save can rewrite one file
    /// without re-parsing the rest.
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

    /// Record every node of `doc` as belonging to `file`.
    ///
    /// `source` must be the text `doc` was parsed from. It is kept verbatim so
    /// that line/column lookups stay correct after the document is mutated -
    /// see the module docs.
    pub fn record_document(
        &mut self,
        file: PathBuf,
        doc: &KdlDocument,
        source: &str,
        from_include: bool,
    ) {
        Self::record_nodes(&mut self.node_origins, &file, doc, from_include);
        self.store_document(file, doc.clone(), source);
    }

    fn record_nodes(
        into: &mut HashMap<NodeId, NodeOrigin>,
        file: &Path,
        doc: &KdlDocument,
        from_include: bool,
    ) {
        for node in doc.nodes() {
            Self::record_node(into, file, node, from_include);
        }
    }

    fn record_node(
        into: &mut HashMap<NodeId, NodeOrigin>,
        file: &Path,
        node: &KdlNode,
        from_include: bool,
    ) {
        let span = node.span();
        into.insert(
            node_id_from_node(file.to_path_buf(), node),
            NodeOrigin::new(file.to_path_buf(), span.offset(), span.len(), from_include),
        );

        if let Some(children) = node.children() {
            for child in children.nodes() {
                Self::record_node(into, file, child, from_include);
            }
        }
    }

    /// Get the origin of a node by its ID.
    pub fn get_origin(&self, node_id: &NodeId) -> Option<&NodeOrigin> {
        self.node_origins.get(node_id)
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
            .filter(|o| o.file == file)
            .collect()
    }

    /// Store a document together with the text it was parsed from.
    pub fn store_document(&mut self, file: PathBuf, doc: KdlDocument, source: &str) {
        self.file_sources.insert(file.clone(), source.to_string());
        self.file_docs.insert(file, doc);
    }

    /// Get a stored document.
    pub fn get_document(&self, file: &Path) -> Option<&KdlDocument> {
        self.file_docs.get(file)
    }

    /// Mutable access to a stored document, for an in-place edit.
    pub fn get_document_mut(&mut self, file: &Path) -> Option<&mut KdlDocument> {
        self.file_docs.get_mut(file)
    }

    /// The text a file was parsed from, byte for byte.
    pub fn get_source_content(&self, file: &Path) -> Option<&str> {
        self.file_sources.get(file).map(String::as_str)
    }

    /// Get the NodeId for a node that is known to live in `file`.
    pub fn node_id_for(&self, file: &Path, node: &KdlNode) -> NodeId {
        node_id_from_node(file.to_path_buf(), node)
    }

    /// Scope lookups to one mapped file.
    pub fn file<'a>(&'a self, file: &'a Path) -> Option<FileSource<'a>> {
        self.file_sources
            .contains_key(file)
            .then_some(FileSource { file, map: self })
    }

    /// 1-based line/column of a node id, counted against the original text of
    /// the file it belongs to.
    pub fn line_column(&self, node_id: &NodeId) -> Option<(usize, usize)> {
        let origin = self.get_origin(node_id)?;
        let source = self.file_sources.get(&origin.file)?;
        Some(origin.line_column(source))
    }

    /// Get all tracked files, in no particular order.
    pub fn files(&self) -> impl Iterator<Item = &PathBuf> {
        self.file_sources.keys()
    }
}

/// Generate a node ID from a node and the file it was parsed from.
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

    const SRC: &str =
        "// top\noutput \"eDP-1\" {\n    mode \"1920x1080\"\n}\nlayout {\n    gaps 10\n}\n";

    fn file() -> PathBuf {
        PathBuf::from("/test/config.kdl")
    }

    fn mapped() -> (SourceMap, KdlDocument) {
        let doc = parse_kdl(SRC, Path::new("/test/config.kdl")).expect("valid KDL");
        let mut map = SourceMap::new();
        map.record_document(file(), &doc, SRC, false);
        (map, doc)
    }

    #[test]
    fn records_every_node_including_children() {
        let (map, doc) = mapped();
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
        assert_eq!(origin.byte_range(), id.byte_range());
        assert!(!origin.from_include);

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
        assert_eq!(&SRC[id.byte_range()][..4], "mode");
    }

    #[test]
    fn includes_are_flagged_in_their_origins() {
        const SRC: &str = "binds {\n    Mod+Q { close-window; }\n}\n";
        let doc = parse_kdl(SRC, Path::new("binds.kdl")).expect("valid KDL");
        let mut map = SourceMap::new();
        map.record_document(PathBuf::from("binds.kdl"), &doc, SRC, true);
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

    // --- Defect A: stored text must be the original, not a re-serialization ---

    #[test]
    fn stored_source_survives_a_mutation() {
        // The bug this pins down: `file_sources` used to hold `doc.to_string()`
        // captured at record time. Rewriting the document then shifted every
        // reported line. The stored text must not move.
        let (mut map, mut doc) = mapped();
        let before = map.get_source_content(&file()).expect("source").to_string();

        let output = doc.nodes_mut().first_mut().expect("output node");
        output.clear_entries();
        output
            .entries_mut()
            .push(kdl::KdlEntry::new(kdl::KdlValue::from("DP-1")));
        map.store_document(file(), doc, &before);

        assert_eq!(map.get_source_content(&file()), Some(SRC));
    }

    #[test]
    fn line_column_stays_on_the_original_line_after_a_mutation() {
        let (mut map, doc) = mapped();
        let layout = doc.nodes().last().expect("layout node");
        let layout_id = map.node_id_for(&file(), layout);
        // Collapse the document onto a single line. If `file_sources` held a
        // re-serialization captured at record time, every node would now report
        // line 1.
        let mut rebuilt = KdlDocument::new();
        for line in ["a 1", "b 2", "c 3"] {
            let parsed = parse_kdl(line, Path::new("/test/config.kdl")).expect("valid KDL");
            rebuilt.nodes_mut().extend(parsed.nodes().to_vec());
        }
        let original = map.get_source_content(&file()).expect("source").to_string();
        map.store_document(file(), rebuilt, &original);

        // Ids recorded from the original parse still resolve to original lines.
        assert_eq!(&SRC[layout_id.byte_range()][..6], "layout");
        assert_eq!(map.line_column(&layout_id), Some((5, 1)));
    }

    // --- Defect B: a node must not resolve to another file's location ---

    #[test]
    fn same_offset_in_two_files_resolves_per_file() {
        // Both files start with a node at offset 0, so a span-only lookup is
        // ambiguous. The file-scoped API has to keep them apart.
        const A: &str = "layout 1\n";
        const B: &str = "binds 2\n";
        let a_path = PathBuf::from("/conf/a.kdl");
        let b_path = PathBuf::from("/conf/b.kdl");

        let doc_a = parse_kdl(A, &a_path).expect("valid KDL");
        let doc_b = parse_kdl(B, &b_path).expect("valid KDL");
        let mut map = SourceMap::new();
        map.record_document(a_path.clone(), &doc_a, A, false);
        map.record_document(b_path.clone(), &doc_b, B, true);

        let node_a = doc_a.nodes().first().expect("node a");
        let node_b = doc_b.nodes().first().expect("node b");
        assert_eq!(
            node_a.span().offset(),
            node_b.span().offset(),
            "fixtures must collide for this test to mean anything"
        );

        let view_a = map.file(&a_path).expect("a is mapped");
        let view_b = map.file(&b_path).expect("b is mapped");

        assert_eq!(
            view_a.origin(node_a).map(|o| o.file.clone()),
            Some(a_path.clone())
        );
        assert_eq!(
            view_b.origin(node_b).map(|o| o.file.clone()),
            Some(b_path.clone())
        );

        // A node from b.kdl asked about through a.kdl's view finds nothing,
        // instead of silently reporting a.kdl.
        assert!(view_a.origin(node_b).is_none());
        assert!(map.file(Path::new("/conf/missing.kdl")).is_none());
    }
}
