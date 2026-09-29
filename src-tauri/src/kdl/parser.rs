//! KDL parser with comment preservation and error location tracking.

use crate::error::{describe_kdl_error, KdlError, KdlLocation};
use kdl::{KdlDocument, KdlNode};
use std::path::Path;

/// Parse a KDL file into a document, preserving spans for source-map integration.
pub fn parse_file(path: &Path) -> Result<KdlDocument, KdlError> {
    // `read_to_string` rejects invalid UTF-8 before we ever see the bytes, so
    // anything that reaches the parser below is valid UTF-8 by construction.
    let content = std::fs::read_to_string(path).map_err(|e| KdlError::Io {
        path: path.to_path_buf(),
        details: e.to_string(),
    })?;
    parse_kdl(&content, path)
}

/// Parse a KDL string into a document, preserving spans for source-map integration.
///
/// A parse failure keeps the position reported by the parser: the returned
/// `KdlError::Parse` carries file, line, column and byte offset, because a bare
/// "expected valid value" is useless for finding a typo in a hand-written
/// config.
pub fn parse_kdl(content: &str, path: &Path) -> Result<KdlDocument, KdlError> {
    content
        .parse::<KdlDocument>()
        .map_err(|err| KdlError::Parse {
            location: KdlLocation::from_span(path, content, err.span.offset(), err.span.len()),
            message: describe_kdl_error(&err),
        })
}

/// Read a typed value from the node's own entries (positional arguments and
/// properties).
///
/// This deliberately does **not** descend into `children()`. In a niri config
/// almost every setting is a child node rather than a property:
///
/// ```kdl
/// output "eDP-1" {
///     mode "1920x1080@60"
/// }
/// ```
///
/// Here `mode` is a child of `output`, so `node_get_value(output, "mode")`
/// yields `None` while [`node_get_child_value`] returns the mode string. Use
/// this function only for entries written on the node itself, such as
/// `include optional=true "outputs.kdl"`.
pub fn node_get_value<T>(node: &KdlNode, key: &str) -> Result<Option<T>, KdlError>
where
    T: for<'de> serde::Deserialize<'de>,
{
    let Some(entry) = node.get(key) else {
        return Ok(None);
    };
    Ok(Some(value_from_json::<T>(entry.value())?))
}

/// Read a typed value from the child node named `key`, taking its first
/// argument.
///
/// This is the accessor that matches how niri configs are actually written:
/// `output { mode "..." }` stores `mode` as a child node, and the value lives in
/// that child's first positional argument. Multi-argument children such as
/// `position 0 0` are not covered here; callers needing the remaining
/// arguments should read `children().get(key).entries()` directly.
pub fn node_get_child_value<T>(node: &KdlNode, key: &str) -> Result<Option<T>, KdlError>
where
    T: for<'de> serde::Deserialize<'de>,
{
    let Some(children) = node.children() else {
        return Ok(None);
    };
    let Some(arg) = children.get_arg(key) else {
        return Ok(None);
    };
    Ok(Some(value_from_json::<T>(arg)?))
}

/// Deserialize a KDL value into `T` by way of JSON, so the same conversion
/// rules apply to every KDL scalar.
fn value_from_json<T>(value: &kdl::KdlValue) -> Result<T, KdlError>
where
    T: for<'de> serde::Deserialize<'de>,
{
    let json = kdl_value_to_json(value)?;
    serde_json::from_value(json).map_err(|e| KdlError::Deserialize {
        message: e.to_string(),
    })
}

/// Convert a KDL value to a serde_json::Value for deserialization.
fn kdl_value_to_json(value: &kdl::KdlValue) -> Result<serde_json::Value, KdlError> {
    use kdl::KdlValue;
    match value {
        KdlValue::Null => Ok(serde_json::Value::Null),
        KdlValue::Bool(b) => Ok(serde_json::Value::Bool(*b)),
        KdlValue::Base10(i) => Ok(serde_json::Value::Number((*i).into())),
        KdlValue::Base10Float(f) => serde_json::Number::from_f64(*f)
            .map(serde_json::Value::Number)
            .ok_or_else(|| KdlError::Deserialize {
                message: "Invalid float value".to_string(),
            }),
        KdlValue::Base2(i) => Ok(serde_json::Value::Number((*i).into())),
        KdlValue::Base8(i) => Ok(serde_json::Value::Number((*i).into())),
        KdlValue::Base16(i) => Ok(serde_json::Value::Number((*i).into())),
        KdlValue::String(s) => Ok(serde_json::Value::String(s.clone())),
        KdlValue::RawString(s) => Ok(serde_json::Value::String(s.clone())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::KdlError;
    use std::path::{Path, PathBuf};

    const PATH: &str = "test.kdl";

    fn parse(content: &str) -> KdlDocument {
        parse_kdl(content, Path::new(PATH)).expect("content should be valid KDL")
    }

    fn parse_err(content: &str) -> KdlError {
        parse_kdl(content, Path::new(PATH)).expect_err("content should be invalid KDL")
    }

    #[test]
    fn parses_nested_blocks_and_arguments() {
        let content = r#"
input {
    keyboard {
        xkb {
            layout "us"
        }
    }
}

output "eDP-1" {
    mode "1920x1080@60"
    scale 1.0
}

binds {
    Mod+Return { spawn "foot"; }
    Mod+Shift+Q { close-window; }
}
"#;
        let doc = parse(content);
        assert_eq!(doc.nodes().len(), 3);

        let input = doc.nodes().first().expect("input node");
        assert_eq!(input.name().value(), "input");

        let output = doc.nodes().get(1).expect("output node");
        assert_eq!(output.name().value(), "output");
        assert_eq!(output.entries().len(), 1);
        assert_eq!(output.entries()[0].value().as_string(), Some("eDP-1"));

        let binds = doc.nodes().get(2).expect("binds node");
        assert_eq!(binds.name().value(), "binds");
        assert_eq!(binds.children().map(|c| c.nodes().len()), Some(2));
    }

    #[test]
    fn rejects_bare_identifiers_as_arguments() {
        // `binds { Mod+Return spawn "foot" }` is the shape people guess, but a
        // bare word is not a value in KDL v2 and niri rejects it the same way.
        // Bind actions have to be child nodes.
        assert!(parse_kdl(
            "binds {\n    Mod+Return spawn \"foot\"\n}\n",
            Path::new(PATH)
        )
        .is_err());
        let doc = parse("binds {\n    Mod+Return { spawn \"foot\"; }\n}\n");
        let binds = doc.nodes().first().expect("binds node");
        assert_eq!(
            binds
                .children()
                .and_then(|c| c.nodes().first())
                .map(|n| n.name().value()),
            Some("Mod+Return")
        );
    }

    #[test]
    fn reports_parse_error_with_location() {
        let content = "input {\n    keyboard {\n        xkb {\n            layout \"us\"\n}\n";
        match parse_err(content) {
            KdlError::Parse { location, message } => {
                assert_eq!(location.file, PathBuf::from(PATH));
                // The parser points at the start of the unterminated children
                // block, which is on the `keyboard` line, not at EOF.
                assert_eq!(location.line, 2);
                assert_eq!(location.column, 14);
                // The location is part of the rendered message, not just a field,
                // so a bare log line is already actionable.
                assert!(location.to_string().contains("2:14"), "{location}");
                assert!(message.contains('}'), "{message}");
            }
            other => panic!("expected Parse error, got {other:?}"),
        }
    }

    #[test]
    fn parse_error_message_keeps_parser_hint() {
        // `Display` on kdl::KdlError prints only the kind; the help text is what
        // tells the user how to fix it, so it must survive.
        let KdlError::Parse { message, .. } = parse_err("foo 1.\n") else {
            panic!("expected Parse error");
        };
        assert!(message.contains("Floating point numbers"), "{message}");
    }

    #[test]
    fn parse_error_column_survives_multibyte_text() {
        // The parser reports byte offsets; the column has to be counted in
        // characters or multi-byte lines report a position past the line end.
        let content = "ünïcödé {\n  bad 1.\n}\n";
        let KdlError::Parse { location, .. } = parse_err(content) else {
            panic!("expected Parse error");
        };
        assert_eq!(location.line, 2);
        assert_eq!(location.column, 7);
    }

    #[test]
    fn parse_error_offset_points_at_the_offending_token() {
        let content = "a 1\nb 1.\n";
        let KdlError::Parse { location, .. } = parse_err(content) else {
            panic!("expected Parse error");
        };
        assert_eq!(location.line, 2);
        assert_eq!(location.column, 3);
        assert_eq!(
            &content[location.offset..location.offset + location.length],
            "1."
        );
    }

    #[test]
    fn rejects_hash_comments() {
        // `#` is not a comment in KDL v2 - it is a hard parse error, so a config
        // written with them must be rejected rather than silently accepted.
        assert!(parse_kdl("# not a comment\nfoo 1\n", Path::new(PATH)).is_err());
    }

    #[test]
    fn parses_empty_and_whitespace_only_documents() {
        assert_eq!(parse("").nodes().len(), 0);
        assert_eq!(parse("   \n\t\n  ").nodes().len(), 0);
        assert_eq!(parse("\n\n\n").nodes().len(), 0);
    }

    #[test]
    fn parses_plain_include_directives() {
        let content = "include \"outputs.kdl\"\ninclude \"keybinds.kdl\"\n";
        let doc = parse(content);
        assert_eq!(doc.nodes().len(), 2);
        assert_eq!(doc.nodes()[0].entries().len(), 1);
        assert_eq!(
            doc.nodes()[0].entries()[0].value().as_string(),
            Some("outputs.kdl")
        );
        assert_eq!(
            doc.nodes()[1].entries()[0].value().as_string(),
            Some("keybinds.kdl")
        );
    }

    #[test]
    fn parses_optional_include_as_property() {
        // niri spells this `include optional=true "..."`; a bare `optional`
        // after the path would be a second positional argument, not a flag.
        let doc = parse("include optional=true \"missing.kdl\"\n");
        let include = doc.nodes().first().expect("include node");
        assert_eq!(include.name().value(), "include");
        assert_eq!(include.entries().len(), 2);

        let optional: Option<bool> = node_get_value(include, "optional").expect("lookup");
        assert_eq!(optional, Some(true));

        // The path is positional, so it is not reachable by key.
        let path: Option<String> = node_get_value(include, "missing.kdl").expect("lookup");
        assert_eq!(path, None);
    }

    #[test]
    fn nodes_expose_spans() {
        let content = "// lead\noutput \"HDMI-1\" {\n    mode \"1920x1080\"\n}\n";
        let doc = parse(content);
        let output = doc.nodes().first().expect("output node");

        // The span has to point back at the node's own text in the source, not
        // at a re-serialized approximation of it.
        let span = output.span();
        let text = &content[span.offset()..span.offset() + span.len()];
        assert!(!span.is_empty());
        assert_eq!(&text[..6], "output");
        assert!(text.ends_with('}'), "span should cover the children block");

        let arg = output.entries().first().expect("positional argument");
        assert!(arg.span().offset() > 0);
    }

    #[test]
    fn node_get_value_reads_properties_but_not_children() {
        let content = "output \"eDP-1\" {\n    mode \"1920x1080\"\n    scale 1.5\n}\n";
        let doc = parse(content);
        let output = doc.nodes().first().expect("output node");

        // `mode` is a child node here, so the entry lookup must not pretend
        // otherwise - this is the case the doc comment warns about.
        let mode: Option<String> = node_get_value(output, "mode").expect("lookup");
        assert_eq!(mode, None);

        let mode: Option<String> = node_get_child_value(output, "mode").expect("lookup");
        assert_eq!(mode, Some("1920x1080".to_string()));

        let scale: Option<f64> = node_get_child_value(output, "scale").expect("lookup");
        assert_eq!(scale, Some(1.5));

        let missing: Option<String> = node_get_child_value(output, "nonexistent").expect("lookup");
        assert_eq!(missing, None);
    }

    #[test]
    fn node_get_child_value_on_childless_node_is_none() {
        let doc = parse("binds {\n    Mod+Return { spawn \"foot\"; }\n}\n");
        let binds = doc.nodes().first().expect("binds node");
        let mode: Option<String> = node_get_child_value(binds, "mode").expect("lookup");
        assert_eq!(mode, None);
    }

    #[test]
    fn node_get_value_rejects_type_mismatch() {
        let doc = parse("node count=7\n");
        let node = doc.nodes().first().expect("node");
        let as_text: Result<Option<String>, _> = node_get_value(node, "count");
        assert!(
            matches!(as_text, Err(KdlError::Deserialize { .. })),
            "expected a deserialize error, got {as_text:?}"
        );
    }

    #[test]
    fn values_in_every_kdl_base_map_to_numbers() {
        let doc = parse("n a=0x10 b=0o17 c=0b11 d=12 e=1.5 f=true g=null h=r\"raw\"\n");
        let node = doc.nodes().first().expect("node");

        let a: Option<i64> = node_get_value(node, "a").expect("lookup");
        assert_eq!(a, Some(16));
        let b: Option<i64> = node_get_value(node, "b").expect("lookup");
        assert_eq!(b, Some(15));
        let c: Option<i64> = node_get_value(node, "c").expect("lookup");
        assert_eq!(c, Some(3));
        let d: Option<i64> = node_get_value(node, "d").expect("lookup");
        assert_eq!(d, Some(12));
        let e: Option<f64> = node_get_value(node, "e").expect("lookup");
        assert_eq!(e, Some(1.5));
        let f: Option<bool> = node_get_value(node, "f").expect("lookup");
        assert_eq!(f, Some(true));
        let g: Option<()> = node_get_value(node, "g").expect("lookup");
        assert_eq!(g, Some(()));
        let h: Option<String> = node_get_value(node, "h").expect("lookup");
        assert_eq!(h, Some("raw".to_string()));
    }

    #[test]
    fn properties_keep_their_source_order() {
        let doc = parse("node prop3=3 prop1=1 \"arg\"\n");
        let node = doc.nodes().first().expect("node");
        let names: Vec<_> = node
            .entries()
            .iter()
            .map(|e| e.name().map(|n| n.value().to_string()))
            .collect();
        assert_eq!(
            names,
            vec![Some("prop3".to_string()), Some("prop1".to_string()), None]
        );
    }

    #[test]
    fn parse_file_maps_io_errors_to_path() {
        let path = PathBuf::from("/nonexistent/niriforge/config.kdl");
        let result = parse_file(&path);
        match result {
            Err(KdlError::Io {
                path: reported,
                details,
            }) => {
                assert_eq!(reported, path);
                assert!(!details.is_empty());
            }
            other => panic!("expected Io error, got {other:?}"),
        }
    }
}
