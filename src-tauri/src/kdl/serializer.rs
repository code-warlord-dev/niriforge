//! KDL serializer.
//!
//! # Why only `Display`
//!
//! Writing a user's config back out is the one operation where losing data is
//! unacceptable, so this module deliberately has no "pretty printing" path.
//! `KdlDocument::fmt` (and `fmt_no_comments`) rewrite the document in place,
//! and measuring that rewrite on real inputs shows it destroys user formatting:
//!
//! ```text
//! "\n\nfoo 1\n\n\nbar 2\n\n"          -> "foo 1\nbar 2\n"      (blank lines gone)
//! "a {\n    b 1\n        c 2\n}\n"     -> "a {\n    b 1\n    c 2\n}\n" (indent overwritten)
//! "foo 1\r\nbar 2\r\n"                -> "foo 1\nbar 2\n"      (CRLF rewritten to LF)
//! "-//slashdash comment\nfoo 1"       -> "- //slashdash comment\nfoo 1" (comment edited)
//! ```
//!
//! It also re-emits comments at a fixed indent, and internally parses the
//! leading/trailing decor with `.expect("invalid leading text")`, so unusual
//! decor panics instead of saving. That is the opposite of "preserve user
//! intent" (ARCHITECTURE §2.4, PHASE-1-CORE-ENGINE requirement 6).
//!
//! `Display` is lossless instead: every node keeps its own leading/trailing
//! decor, so `doc.to_string()` reproduces the parsed source byte for byte.
//! Reformatting, if it is ever wanted, has to be an explicit user action and
//! its own command - never a side effect of saving.

use crate::error::AppResult;
use kdl::{KdlDocument, KdlNode};
use tracing::trace;

/// Serialize a KDL document to a string, preserving the formatting it was
/// parsed with.
///
/// The result is byte-identical to the input for any document produced by
/// `crate::kdl::parser::parse_kdl`, which makes load -> save a no-op on disk.
pub fn serialize_kdl(doc: &KdlDocument) -> AppResult<String> {
    trace!(target: "niriforge::kdl::serializer", "serialize_kdl: {} nodes", doc.nodes().len());
    Ok(doc.to_string())
}

/// Serialize a single node to a string with the formatting it carries itself.
///
/// Used for surgical writes, where one node of a document is replaced and the
/// rest of the file must come out untouched.
pub fn serialize_node(node: &KdlNode) -> AppResult<String> {
    trace!(target: "niriforge::kdl::serializer", "serialize_node: {}", node.name().value());
    Ok(node.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kdl::parser::parse_kdl;
    use std::path::Path;

    fn doc(src: &str) -> KdlDocument {
        parse_kdl(src, Path::new("test.kdl")).expect("content should be valid KDL")
    }

    fn serialized(src: &str) -> String {
        serialize_kdl(&doc(src)).expect("serialization does not fail")
    }

    #[test]
    fn reproduces_input_byte_for_byte() {
        // The property the whole save path depends on: touching a config without
        // editing it must not change a single byte.
        let cases = [
            "foo 1 2 3\nbar 4 5 6",
            "\n  // leading\nfoo 1\n  // trailing\n",
            "node prop3=3 prop1=1 prop2=2 \"arg1\" \"arg2\"",
            "active \"value\"\n/-inactive \"commented out\"\n",
            "(\"mytype\")node \"value\"\n(\"other\")another 123\n",
            "output \"eDP-1\" {\n    mode \"1920x1080\"\n    scale 1.0\n}\n",
            "a {\n    b 1\n        c 2\n}\n",
            "\n\nfoo 1\n\n\nbar 2\n\n",
            "/** doc comment */\nfoo 1\n",
            "/* block\n   comment */\nfoo 1\n",
        ];
        for src in cases {
            assert_eq!(serialized(src), src, "not byte-identical: {src:?}");
        }
    }

    #[test]
    fn preserves_crlf_line_endings() {
        // Reformatting turns these into LF; a Windows-authored config would come
        // back with a whole-file diff.
        let src = "foo 1\r\nbar 2\r\n";
        assert_eq!(serialized(src), src);
    }

    #[test]
    fn preserves_comments_in_both_syntaxes() {
        let src = "// line comment\n/* block */\n/-disabled 1\nfoo 1 // trailing\n";
        let out = serialized(src);
        assert!(out.contains("// line comment"));
        assert!(out.contains("/* block */"));
        assert!(out.contains("/-disabled 1"));
        assert!(out.contains("// trailing"));
    }

    #[test]
    fn preserves_unusual_indentation() {
        let src = "a {\n        b 1\n  c 2\n}\n";
        assert_eq!(serialized(src), src);
    }

    #[test]
    fn serializing_is_idempotent() {
        let src = "// Config comment\nlayout {\n    gaps 5\n    border_width 2\n}\n";
        let once = serialized(src);
        let twice = serialize_kdl(&doc(&once)).expect("serialization does not fail");
        assert_eq!(once, twice);
    }

    #[test]
    fn output_order_is_preserved() {
        let out = serialized("third 3\nfirst 1\nsecond 2\n");
        let names: Vec<_> = out
            .lines()
            .map(|line| line.split_whitespace().next().unwrap_or_default())
            .collect();
        assert_eq!(names, vec!["third", "first", "second"]);
    }

    #[test]
    fn serializes_empty_document_as_empty_string() {
        assert_eq!(serialize_kdl(&KdlDocument::new()).unwrap_or_default(), "");
    }

    #[test]
    fn serializes_single_node() {
        let out = serialize_node(&doc("foo 1 2 3").nodes().first().expect("node").clone())
            .expect("serialization does not fail");
        assert!(out.contains("foo"));
        assert!(out.contains('1'));
        assert!(out.contains('2'));
        assert!(out.contains('3'));
    }

    #[test]
    fn serializing_a_node_keeps_its_comments() {
        let src = "// kept\nfoo 1\n";
        let out = serialize_node(&doc(src).nodes().first().expect("node").clone())
            .expect("serialization does not fail");
        assert_eq!(out, "// kept\nfoo 1\n");
    }
}
