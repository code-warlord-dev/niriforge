//! AST <-> typed `Config`.
//!
//! # The direction of authority
//!
//! The KDL tree is the source of truth and the typed `Config` is a *projection*
//! of it. Nothing that only exists in the AST is ever thrown away to make the
//! projection fit, and nothing is ever generated from scratch to fill the
//! projection back in. Two rules follow, and they are what make a load/save
//! cycle a no-op on disk:
//!
//! - [`to_config`] reads a value out of a node only when the node's shape
//!   matches the schema field. A node it cannot map stays in the AST, and shows
//!   up in [`ConfigReport::unmapped`] so the caller can say so instead of
//!   pretending the config was fully understood.
//! - [`apply_config`] edits existing nodes in place and only ever writes a value
//!   that differs from the one already there. It never adds, moves or drops a
//!   node, so comments, blank lines, indentation and `/-` comment-outs survive
//!   by construction rather than by effort.
//!
//! # Why `Config::unknown` stays `Vec<serde_json::Value>`
//!
//! ARCHITECTURE §4 sketches it as `Vec<KdlNode>`, which cannot work:
//! `Config` is `Serialize` (it is the DTO the frontend consumes) and `JsonSchema`
//! (the schema the frontend validates against), and `kdl::KdlNode` is neither.
//! Worse, a `serde_json::Value` cannot carry a span, a type annotation or a
//! `/-` comment-out, so a field of that type can only ever be a lossy view. It
//! is kept as the lossy view it can honestly be - what the UI needs in order to
//! show that a section exists - while the AST retains everything. The report
//! returned alongside the config lists the same nodes with their file and span.

use crate::kdl::include::{ConfigFile, KdlConfigSet};
use crate::kdl::source_map::NodeId;
use crate::schema::*;
use kdl::{KdlDocument, KdlNode, KdlValue};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// A KDL construct that could not be expressed in the typed schema.
///
/// These are not failures: the file is still fully preserved, the node simply
/// has no typed home and stays in the AST. They are collected so the UI can
/// warn instead of showing an empty section as if the user had cleared it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unmapped {
    /// The node as written, kept verbatim.
    pub raw: String,
    /// Where it is, so the editor can jump to it.
    pub file: PathBuf,
    pub line: usize,
    pub column: usize,
    /// Why it did not fit, in terms a user can act on.
    pub reason: &'static str,
}

impl std::fmt::Display for Unmapped {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}:{}:{}: {} (kept as-is: {})",
            self.file.display(),
            self.line,
            self.column,
            self.raw.lines().next().unwrap_or_default().trim(),
            self.reason
        )
    }
}

/// What [`to_config`] could not express, and what it refused to guess.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ConfigReport {
    /// Nodes left in the AST because the schema has no field for them.
    pub unmapped: Vec<Unmapped>,
    /// Repeated top-level nodes in the same file, which niri rejects.
    pub duplicates: Vec<Unmapped>,
    /// A section that appears in more than one file of the set. niri accepts
    /// this, so it is not an error, but only one copy takes effect and a save
    /// writes all of them - the user has to know.
    pub shadowed: Vec<Unmapped>,
}

impl ConfigReport {
    /// True when nothing was left over, no duplicate was seen and no section is
    /// split across files.
    pub fn is_clean(&self) -> bool {
        self.unmapped.is_empty() && self.duplicates.is_empty() && self.shadowed.is_empty()
    }
}

/// Something went wrong that makes the projection meaningless.
#[derive(Debug, thiserror::Error)]
pub enum SchemaError {
    #[error("{0}")]
    Message(String),
}

/// Writing a typed config back into the AST failed.
#[derive(Debug, thiserror::Error)]
pub enum ApplyError {
    #[error("{file}:{line}: {message}")]
    At {
        file: PathBuf,
        line: usize,
        message: String,
    },
    #[error("unknown file in config set: {0}")]
    UnknownFile(PathBuf),
    #[error("no field of the schema can hold {0}")]
    Unrepresentable(String),
}

/// A node of the AST together with the file it came from.
///
/// The file is part of the handle on purpose: a node has no identity without it,
/// and the save path must never write a node to the wrong file.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Located<'a> {
    pub file: &'a PathBuf,
    pub node: &'a KdlNode,
}

/// A flattened, read-only view of a config set.
///
/// Flattening is fine here and only here: this view is never written back. The
/// save path works on [`KdlConfigSet`] file by file.
pub struct MergedConfig<'a> {
    set: &'a KdlConfigSet,
    nodes: Vec<Located<'a>>,
}

impl<'a> MergedConfig<'a> {
    /// Build the view, reporting repeated top-level nodes.
    ///
    /// niri rejects a config with two `environment` nodes, so a duplicate has
    /// to be an error rather than something to merge silently. The check runs
    /// per file, because the fixtures and real configs are free to repeat a
    /// section in a second file only if niri would accept it - and it does not.
    fn build(set: &'a KdlConfigSet) -> (Self, ConfigReport) {
        let mut nodes: Vec<Located<'a>> = Vec::new();
        let mut report = ConfigReport::default();
        // Where each singleton section was first seen, as an index into `nodes`.
        // A section in two files is legal, so this is a warning rather than an
        // error - but the user has to hear about it, because only one of the two
        // survives and a save writes both.
        let mut first_seen: Vec<(&str, usize)> = Vec::new();

        for file in &set.files {
            // Reset per file, deliberately. niri parses each file on its own and
            // raises `duplicate node \`layout\`, single node expected` from
            // within a single document; a `layout` in `config.kdl` and another in
            // `cfg/layout.kdl` is accepted. Treating the set as one document
            // would reject configs niri loads, such as the `noctalia-style`
            // fixture with `environment` in two files.
            let mut seen: Vec<&str> = Vec::new();
            for node in file.doc.nodes() {
                if node.name().value() == "include" {
                    continue;
                }
                let name = node.name().value();
                // Repeating a section is only an error where the schema has one
                // slot for it. `output` and `window-rule` are lists in niri, so
                // a second one is not a conflict.
                let mut shadowed = false;
                if SINGLETON_SECTIONS.contains(&name) {
                    if seen.contains(&name) {
                        report
                            .duplicates
                            .push(unmapped(set, &file.path, node, DUPLICATE));
                    } else {
                        seen.push(name);
                        let index = nodes.len();
                        match first_seen.iter().find(|(n, _)| *n == name) {
                            Some((_, earlier)) => {
                                report.shadowed.push(unmapped(
                                    set,
                                    nodes[*earlier].file,
                                    nodes[*earlier].node,
                                    SHADOWED,
                                ));
                                shadowed = true;
                            }
                            None => first_seen.push((name, index)),
                        }
                    }
                }
                if shadowed {
                    report
                        .shadowed
                        .push(unmapped(set, &file.path, node, SHADOWED));
                }
                nodes.push(Located {
                    file: &file.path,
                    node,
                });
            }
        }

        (Self { set, nodes }, report)
    }

    /// The config set this view was built from.
    pub fn set(&self) -> &'a KdlConfigSet {
        self.set
    }

    /// Every top-level node of every file, entry point first.
    pub fn nodes(&self) -> &[Located<'a>] {
        &self.nodes
    }

    /// Top-level nodes called `name`, in file order.
    pub fn nodes_named(&self, name: &str) -> std::vec::IntoIter<Located<'a>> {
        self.nodes
            .iter()
            .copied()
            .filter(move |n| n.node.name().value() == name)
            .collect::<Vec<_>>()
            .into_iter()
    }

    /// The first top-level node called `name`.
    pub fn first(&self, name: &str) -> Option<Located<'a>> {
        self.nodes_named(name).next()
    }

    /// The single argument of a node that stands for a value.
    pub fn arg(node: &KdlNode) -> Option<String> {
        node.entries()
            .iter()
            .find(|e| e.name().is_none())
            .and_then(|e| e.value().as_string().map(str::to_string))
    }

    /// Every positional argument of a node.
    pub fn args(node: &KdlNode) -> Vec<String> {
        node.entries()
            .iter()
            .filter(|e| e.name().is_none())
            .filter_map(|e| e.value().as_string().map(str::to_string))
            .collect()
    }

    /// The children of a node, paired with their name.
    pub fn children(node: &KdlNode) -> impl Iterator<Item = (&KdlNode, &str)> {
        node.children()
            .into_iter()
            .flat_map(|c| c.nodes().iter().map(move |n| (n, n.name().value())))
    }

    /// The value a child carries: an argument, a property, or `true` for a
    /// bare flag node.
    ///
    /// A node with no argument is a flag: niri writes `natural-scroll` and
    /// `/-drag-lock` rather than `natural-scroll true`, and both have to read
    /// back as the boolean they mean.
    pub fn scalar(node: &KdlNode) -> Option<Value> {
        if let Some(children) = node.children() {
            if !children.nodes().is_empty() {
                return None;
            }
        }
        match node.entries().iter().find(|e| e.name().is_none()) {
            Some(entry) => kdl_value_to_json(entry.value()),
            None if node.entries().is_empty() => Some(Value::Bool(true)),
            None => {
                // A node that only carries properties, such as
                // `position x=0 y=0`, reads as an object.
                let mut map = Map::new();
                for entry in node.entries() {
                    let Some(name) = entry.name() else { continue };
                    map.insert(name.value().to_string(), kdl_value_to_json(entry.value())?);
                }
                if map.is_empty() {
                    Some(Value::Bool(true))
                } else {
                    Some(Value::Object(map))
                }
            }
        }
    }
}

/// Top-level sections the schema models as a single value.
///
/// Everything else top-level is a list in niri (`output`, `window-rule`,
/// `layer-rule`, `workspace`, `spawn-at-startup`, ...), so a second one is more
/// configuration, not a conflict.
const SINGLETON_SECTIONS: &[&str] = &[
    "input",
    "binds",
    "layout",
    "animations",
    "gestures",
    "overview",
    "recent-windows",
    "switch-events",
    "debug",
    "cursor",
    "screenshot-path",
    "prefer-no-csd",
    "blur",
    "xwayland-satellite",
    "clipboard",
    "hotkey-overlay",
    "config-notification",
    "environment",
];

const DUPLICATE: &str = "a section may appear only once";
const NO_SHAPE: &str = "no schema field has this shape";
const NO_FIELD: &str = "not a field of the schema struct";
const SHADOWED: &str =
    "this section is in more than one file; niri loads them all, a save writes all of them";

/// Convert a `kdl` value into JSON, keeping the distinction niri cares about.
///
/// A raw string (`r"^[Ss]team$"`) is a string, not a pattern; nothing is
/// unescaped, because the AST keeps the value verbatim for the save path.
pub fn kdl_value_to_json(value: &KdlValue) -> Option<Value> {
    Some(match value {
        KdlValue::Null => Value::Null,
        KdlValue::Bool(b) => Value::Bool(*b),
        KdlValue::Base10(i) => serde_json::to_value(i).ok()?,
        KdlValue::Base2(i) => serde_json::to_value(*i).ok()?,
        KdlValue::Base8(i) => serde_json::to_value(*i).ok()?,
        KdlValue::Base16(i) => serde_json::to_value(*i).ok()?,
        KdlValue::Base10Float(f) => serde_json::Number::from_f64(*f)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        KdlValue::String(s) | KdlValue::RawString(s) => Value::String(s.clone()),
    })
}

/// Project a config set into the typed model, plus what did not fit.
///
/// The returned [`Config`] is a view: sections the schema cannot describe stay
/// in the AST and are listed in [`ConfigReport::unmapped`]. Use
/// [`to_config`] when the report is not interesting and an error is enough.
pub fn to_config_with_report(set: &KdlConfigSet) -> Result<(Config, ConfigReport), SchemaError> {
    let (merged, mut report) = MergedConfig::build(set);
    if !report.duplicates.is_empty() {
        return Err(SchemaError::Message(
            report
                .duplicates
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("; "),
        ));
    }

    // A malformed `include` was already rejected while the set was loaded, so
    // this cannot fail here; if it ever does, the directives are part of the
    // config and swallowing the error would hide that.
    let includes = crate::kdl::include::extract_includes(&set.main().doc)
        .map_err(|e| SchemaError::Message(e.to_string()))?;

    let mut config = Config {
        includes,
        ..Config::default()
    };

    config.input = section(&merged, set, "input", &mut report, input_from_kdl);
    config.layout = section(&merged, set, "layout", &mut report, layout_from_kdl);
    config.animations = section(&merged, set, "animations", &mut report, animations_from_kdl);
    config.gestures = section(&merged, set, "gestures", &mut report, gestures_from_kdl);
    config.overview = section(&merged, set, "overview", &mut report, overview_from_kdl);
    config.recent_windows = section(
        &merged,
        set,
        "recent-windows",
        &mut report,
        recent_windows_from_kdl,
    );
    config.switch_events = section(
        &merged,
        set,
        "switch-events",
        &mut report,
        switch_events_from_kdl,
    );
    config.debug = section(&merged, set, "debug", &mut report, debug_from_kdl);
    config.cursor = section(&merged, set, "cursor", &mut report, cursor_from_kdl);
    config.blur = section(&merged, set, "blur", &mut report, blur_from_kdl);
    config.xwayland_satellite = section(
        &merged,
        set,
        "xwayland-satellite",
        &mut report,
        xwayland_satellite_from_kdl,
    );
    config.clipboard = section(&merged, set, "clipboard", &mut report, clipboard_from_kdl);
    config.hotkey_overlay = section(
        &merged,
        set,
        "hotkey-overlay",
        &mut report,
        hotkey_overlay_from_kdl,
    );
    config.config_notification = section(
        &merged,
        set,
        "config-notification",
        &mut report,
        config_notification_from_kdl,
    );

    config.screenshot_path = merged
        .first("screenshot-path")
        .and_then(|l| MergedConfig::arg(l.node));
    config.prefer_no_csd = merged
        .first("prefer-no-csd")
        .is_some_and(|l| MergedConfig::scalar(l.node) == Some(Value::Bool(true)));

    config.outputs = collect(&merged, set, &mut report, "output", output_from_kdl);
    config.window_rules = collect(
        &merged,
        set,
        &mut report,
        "window-rule",
        window_rule_from_kdl,
    );
    config.layer_rules = collect(&merged, set, &mut report, "layer-rule", layer_rule_from_kdl);
    config.workspaces = collect(&merged, set, &mut report, "workspace", workspace_from_kdl);
    config.spawn_at_startup = collect(
        &merged,
        set,
        &mut report,
        "spawn-at-startup",
        spawn_entry_from_arg,
    );
    config.spawn_sh_at_startup = merged
        .nodes_named("spawn-sh-at-startup")
        .filter_map(|l| MergedConfig::arg(l.node))
        .collect();
    config.environment = environment_from_kdl(&merged);

    config.binds = binds_from_kdl(&merged);
    config.unknown = unknown_as_json(&merged);
    report_unknown_children(&merged, set, &config, &mut report);

    Ok((config, report))
}

/// Project a config set into the typed model.
pub fn to_config(set: &KdlConfigSet) -> Result<Config, SchemaError> {
    to_config_with_report(set).map(|(config, _)| config)
}

/// Files whose AST was changed by [`apply_config`].
pub type ChangedFiles = Vec<PathBuf>;

/// Write a typed config back into the AST, file by file.
///
/// Returns the files that actually changed, which is what the backup manager and
/// the atomic write have to be pointed at: a save that touched two of the ten
/// files in a config must not rewrite the other eight.
pub fn apply_config(set: &mut KdlConfigSet, config: &Config) -> Result<ChangedFiles, ApplyError> {
    let mut changed = Vec::new();
    for file in &mut set.files {
        let before = file.source.clone();
        apply_to_file(file, config)?;
        if file.doc.to_string() == before {
            continue;
        }
        // The source map keeps its own copy of every document, so an edit made
        // here would otherwise leave `get_document` handing out the pre-edit
        // tree to whatever asks next. The stored *text* stays the original:
        // spans recorded at parse time still index into it, and that is what
        // keeps a reported line number pointing at the line the user wrote.
        set.source_map
            .store_document(file.path.clone(), file.doc.clone(), &file.source);
        changed.push(file.path.clone());
    }
    Ok(changed)
}

/// Apply the top-level fields that have a node shape.
///
/// Only nodes that already exist are touched. Adding a node would mean picking
/// an indentation and a position for it, and a config that grows a new section
/// on save is a surprise the user cannot explain.
fn apply_to_file(file: &mut ConfigFile, config: &Config) -> Result<(), ApplyError> {
    if let Some(path) = &config.screenshot_path {
        if let Some(node) = find_top(&mut file.doc, "screenshot-path") {
            set_single_arg(node, Value::String(path.clone()))?;
        }
    }
    // `prefer_no_csd` is a plain bool, so both values have to be writable. A
    // bare `prefer-no-csd` already means true and is left alone; false has to
    // be spelled out, because there is no other way to say it.
    if let Some(node) = find_top(&mut file.doc, "prefer-no-csd") {
        set_bool_arg(node, config.prefer_no_csd)?;
    }
    if let Some(gaps) = config.layout.as_ref().and_then(|l| l.gaps) {
        if let Some(node) = child_of_top(&mut file.doc, "layout", "gaps") {
            set_single_arg(node, Value::from(gaps))?;
        }
    }
    if let Some(enabled) = config.blur.as_ref().and_then(|b| b.enabled) {
        if let Some(children) = children_of_top(&mut file.doc, "blur") {
            set_on_off(children, enabled);
        }
    }
    Ok(())
}

/// Write a toggle the way niri spells one.
///
/// niri has no boolean argument for these settings. `blur { on false }` is a
/// file it refuses to load - `Error: unexpected argument` - so the only way to
/// turn the setting off is to rename the node to `off`, not to give `on` a
/// value. Both spellings are bare nodes with no entries.
///
/// Returns whether the document was touched, so the caller can tell a no-op from
/// a missing node. A file that carries neither spelling has nothing to write to
/// and is left as it is.
fn set_on_off(children: &mut KdlDocument, value: bool) -> bool {
    let (wanted, other) = if value { ("on", "off") } else { ("off", "on") };

    for node in children.nodes_mut() {
        if node.name().value() == wanted {
            if node.entries().is_empty() {
                return false;
            }
            node.clear_entries();
            return true;
        }
    }
    for node in children.nodes_mut() {
        if node.name().value() == other {
            node.set_name(kdl::KdlIdentifier::from(wanted));
            node.clear_entries();
            return true;
        }
    }
    false
}

/// Write a boolean niri does accept as an argument, such as `prefer-no-csd false`.
fn set_bool_arg(node: &mut KdlNode, value: bool) -> Result<(), ApplyError> {
    if MergedConfig::scalar(node) == Some(Value::Bool(value)) {
        return Ok(());
    }
    set_single_arg(node, Value::Bool(value))
}

fn find_top<'a>(doc: &'a mut KdlDocument, name: &str) -> Option<&'a mut KdlNode> {
    doc.nodes_mut()
        .iter_mut()
        .find(|n| n.name().value() == name)
}

fn children_of_top<'a>(doc: &'a mut KdlDocument, parent: &str) -> Option<&'a mut KdlDocument> {
    children_of(find_top(doc, parent)?)
}

fn children_of(node: &mut KdlNode) -> Option<&mut KdlDocument> {
    node.children_mut().as_mut()
}

fn child_of_top<'a>(
    doc: &'a mut KdlDocument,
    parent: &str,
    child: &str,
) -> Option<&'a mut KdlNode> {
    children_of_top(doc, parent)?
        .nodes_mut()
        .iter_mut()
        .find(|n| n.name().value() == child)
}

/// Write a scalar into a node, but only when it differs from what is there.
///
/// The comparison is against the value the node already carries, which is what
/// makes load -> save a byte-for-byte no-op: a value that survived the round
/// trip through the typed model compares equal and is never re-emitted, so its
/// original spelling (`Base10` vs `Base16`, a string vs a raw string) is kept.
fn set_single_arg(node: &mut KdlNode, value: Value) -> Result<(), ApplyError> {
    let new = json_to_kdl(&value)
        .ok_or_else(|| ApplyError::Unrepresentable(format!("{value} is not a KDL scalar")))?;
    if node
        .entries()
        .iter()
        .any(|e| e.name().is_none() && same_scalar(e.value(), &new))
    {
        return Ok(());
    }
    if let Some(entry) = node.entries_mut().iter_mut().find(|e| e.name().is_none()) {
        *entry = kdl::KdlEntry::new(new);
        return Ok(());
    }
    node.entries_mut().push(kdl::KdlEntry::new(new));
    Ok(())
}

/// Whether two KDL scalars mean the same thing.
///
/// `KdlValue`'s own equality is by variant, so `Base16(16)` and `Base10(16)`
/// are different to it. They are not different to a user, and rewriting
/// `gaps 0x10` as `gaps 16` on every save is a diff nobody asked for. Every
/// integer base KDL accepts spells the same number, so they compare as one.
fn same_scalar(left: &KdlValue, right: &KdlValue) -> bool {
    match (number_of(left), number_of(right)) {
        (Some(a), Some(b)) => a == b,
        _ => left == right,
    }
}

fn number_of(value: &KdlValue) -> Option<i128> {
    Some(match value {
        KdlValue::Base2(i) | KdlValue::Base8(i) | KdlValue::Base16(i) | KdlValue::Base10(i) => {
            *i as i128
        }
        _ => return None,
    })
}

/// JSON back to a `kdl` value, for the few fields the typed model owns.
///
/// Only scalars have a KDL spelling. A compound value has no single-argument
/// form, and turning one into a string is how a config ends up holding
/// `{"a":1}` in a field the user expects to read - so it is refused here and
/// the caller decides what to do about it.
pub fn json_to_kdl(value: &Value) -> Option<KdlValue> {
    Some(match value {
        Value::Null => KdlValue::Null,
        Value::Bool(b) => KdlValue::Bool(*b),
        Value::Number(n) => n
            .as_i64()
            .map(KdlValue::Base10)
            .or_else(|| n.as_f64().map(KdlValue::Base10Float))
            .unwrap_or(KdlValue::Null),
        Value::String(s) => KdlValue::String(s.clone()),
        Value::Array(_) | Value::Object(_) => return None,
    })
}

fn section<T>(
    merged: &MergedConfig<'_>,
    set: &KdlConfigSet,
    name: &str,
    report: &mut ConfigReport,
    read: fn(&KdlNode) -> Option<T>,
) -> Option<T> {
    let located = merged.first(name)?;
    match read(located.node) {
        Some(value) => Some(value),
        None => {
            report
                .unmapped
                .push(unmapped(set, located.file, located.node, NO_SHAPE));
            None
        }
    }
}

fn collect<T>(
    merged: &MergedConfig<'_>,
    set: &KdlConfigSet,
    report: &mut ConfigReport,
    name: &str,
    read: fn(&KdlNode) -> Option<T>,
) -> Vec<T> {
    merged
        .nodes_named(name)
        .filter_map(|located| match read(located.node) {
            Some(value) => Some(value),
            None => {
                report
                    .unmapped
                    .push(unmapped(set, located.file, located.node, NO_SHAPE));
                None
            }
        })
        .collect()
}

/// List the children of a known section that its schema struct has no field for.
///
/// The field names come from the struct itself through serde, so adding a field
/// to `schema/mod.rs` is enough to stop it being reported - there is no second
/// list to keep in step. The nodes stay in the AST either way; this exists so the
/// UI can say "there is something here I do not understand" instead of quietly
/// showing an empty section.
fn report_unknown_children(
    merged: &MergedConfig<'_>,
    set: &KdlConfigSet,
    config: &Config,
    report: &mut ConfigReport,
) {
    // Each pair is the section node and the serde view of the schema struct it
    // was read into, so the field names come from the struct itself.
    let sections: Vec<(&str, Option<Located<'_>>, Option<Value>)> = vec![
        ("input", merged.first("input"), json_of(&config.input)),
        ("layout", merged.first("layout"), json_of(&config.layout)),
        ("cursor", merged.first("cursor"), json_of(&config.cursor)),
        ("blur", merged.first("blur"), json_of(&config.blur)),
        (
            "clipboard",
            merged.first("clipboard"),
            json_of(&config.clipboard),
        ),
        (
            "animations",
            merged.first("animations"),
            json_of(&config.animations),
        ),
        (
            "overview",
            merged.first("overview"),
            json_of(&config.overview),
        ),
        (
            "switch-events",
            merged.first("switch-events"),
            json_of(&config.switch_events),
        ),
        (
            "hotkey-overlay",
            merged.first("hotkey-overlay"),
            json_of(&config.hotkey_overlay),
        ),
        (
            "xwayland-satellite",
            merged.first("xwayland-satellite"),
            json_of(&config.xwayland_satellite),
        ),
    ];

    for (section, located, fields) in sections {
        let (Some(located), Some(Value::Object(fields))) = (located, fields) else {
            continue;
        };
        for (child, name) in MergedConfig::children(located.node) {
            if fields.contains_key(serde_name_of(section, name)) {
                continue;
            }
            report
                .unmapped
                .push(unmapped(set, located.file, child, NO_FIELD));
        }
    }
}

/// KDL child names that do not match the serde name of the field they feed.
///
/// niri and `schema/mod.rs` disagree in a handful of places, and comparing the
/// raw node name against the field name is what made `xcursor-size`,
/// `xcursor-theme` and `skip-at-startup` come out as "not understood" when the
/// engine reads all three. Each entry is `(section, kdl name, serde name)`.
///
/// The pair form of a boolean (`on` / `off`, or a name that means the inverse)
/// has no serde name of its own - it collapses into one `enabled` field - so
/// both spellings point at the same field here.
const RENAMED_CHILDREN: &[(&str, &str, &str)] = &[
    ("cursor", "xcursor-size", "size"),
    ("cursor", "xcursor-theme", "theme"),
    ("blur", "on", "enabled"),
    ("blur", "off", "enabled"),
    ("clipboard", "disable-primary", "enabled"),
    ("hotkey-overlay", "skip-at-startup", "enabled"),
    ("xwayland-satellite", "path", "wm-class"),
    // `off` is how niri spells "this section is disabled" in every section that
    // has an `enabled` field, not just `blur`.
    ("animations", "off", "enabled"),
    // niri calls the animation `window-movement`; the schema field is
    // `window_move`, which kebab-cases to `window-move`. Without this entry the
    // engine reads the node correctly and then reports that very node as a name
    // it does not know, which is a warning about something it just understood.
    ("animations", "window-movement", "window-move"),
];

/// The serde field name a KDL child name feeds, or the name itself.
fn serde_name_of<'a>(section: &'a str, kdl_name: &'a str) -> &'a str {
    RENAMED_CHILDREN
        .iter()
        .find(|(s, kdl, _)| *s == section && *kdl == kdl_name)
        .map_or(kdl_name, |(_, _, serde)| *serde)
}

fn json_of<T: serde::Serialize>(value: &T) -> Option<Value> {
    serde_json::to_value(value).ok()
}

fn unmapped(set: &KdlConfigSet, file: &Path, node: &KdlNode, reason: &'static str) -> Unmapped {
    let span = node.span();
    let id = NodeId {
        file: file.to_path_buf(),
        offset: span.offset(),
        length: span.len(),
    };
    let (line, column) = set.source_map.line_column(&id).unwrap_or((1, 1));
    Unmapped {
        raw: node_preview(set, file, node),
        file: file.to_path_buf(),
        line,
        column,
        reason,
    }
}

/// The text of a node as the user wrote it, without the decor around it.
///
/// `KdlNode::to_string` includes the leading decor, so a node preceded by a
/// comment previews as that comment and the report points the user at the wrong
/// line. The recorded span covers the node itself, so reading the original
/// source through it gives exactly the node and nothing else.
fn node_preview(set: &KdlConfigSet, file: &Path, node: &KdlNode) -> String {
    let span = node.span();
    match set.source_map.get_source_content(file) {
        Some(source) => source
            .get(span.offset()..span.offset() + span.len())
            .map(str::trim)
            .map(str::to_string)
            .unwrap_or_else(|| node.to_string()),
        None => node.to_string(),
    }
}

// --- sections ---------------------------------------------------------------

fn input_from_kdl(node: &KdlNode) -> Option<InputConfig> {
    Some(InputConfig {
        keyboard: child_section(node, "keyboard", keyboard_from_kdl),
        touchpad: child_section(node, "touchpad", touchpad_from_kdl),
        mouse: child_section(node, "mouse", mouse_from_kdl),
        trackpoint: child_section(node, "trackpoint", trackpoint_from_kdl),
        tablet: child_section(node, "tablet", tablet_from_kdl),
        touch: child_section(node, "touch", touch_from_kdl),
        focus_follows_mouse: flag_child(node, "focus-follows-mouse"),
        warp_mouse_to_focus: flag_child(node, "warp-mouse-to-focus"),
        mod_key: child_scalar(node, "mod-key").and_then(|v| v.as_str().map(str::to_string)),
    })
}

fn keyboard_from_kdl(node: &KdlNode) -> Option<KeyboardConfig> {
    Some(KeyboardConfig {
        xkb: child_section(node, "xkb", xkb_from_kdl),
        repeat_delay: child_int(node, "repeat-delay"),
        repeat_rate: child_int(node, "repeat-rate"),
        track_layout: child_string(node, "track-layout"),
        numlock: flag_child(node, "numlock"),
    })
}

fn xkb_from_kdl(node: &KdlNode) -> Option<XkbConfig> {
    Some(XkbConfig {
        layout: child_string(node, "layout"),
        variant: child_string(node, "variant"),
        options: child_string(node, "options"),
        model: child_string(node, "model"),
        rules: child_string(node, "rules"),
        file: child_string(node, "file"),
    })
}

fn touchpad_from_kdl(node: &KdlNode) -> Option<TouchpadConfig> {
    Some(TouchpadConfig {
        off: flag_child(node, "off"),
        natural_scroll: flag_child(node, "natural-scroll"),
        accel_speed: child_f32(node, "accel-speed"),
        accel_profile: child_string(node, "accel-profile"),
        scroll_method: child_string(node, "scroll-method"),
        scroll_button: child_string(node, "scroll-button"),
        left_handed: flag_child(node, "left-handed"),
        tap: flag_child(node, "tap"),
        dwt: flag_child(node, "dwt"),
        dwtp: flag_child(node, "dwtp"),
        drag: flag_child(node, "drag"),
        middle_emulation: flag_child(node, "middle-emulation"),
    })
}

fn mouse_from_kdl(node: &KdlNode) -> Option<MouseConfig> {
    Some(MouseConfig {
        off: flag_child(node, "off"),
        natural_scroll: flag_child(node, "natural-scroll"),
        accel_speed: child_f32(node, "accel-speed"),
        accel_profile: child_string(node, "accel-profile"),
        scroll_method: child_string(node, "scroll-method"),
        scroll_button: child_string(node, "scroll-button"),
        left_handed: flag_child(node, "left-handed"),
    })
}

fn trackpoint_from_kdl(node: &KdlNode) -> Option<TrackpointConfig> {
    Some(TrackpointConfig {
        off: flag_child(node, "off"),
        natural_scroll: flag_child(node, "natural-scroll"),
        accel_speed: child_f32(node, "accel-speed"),
        accel_profile: child_string(node, "accel-profile"),
        scroll_method: child_string(node, "scroll-method"),
        scroll_button: child_string(node, "scroll-button"),
        left_handed: flag_child(node, "left-handed"),
    })
}

fn tablet_from_kdl(node: &KdlNode) -> Option<TabletConfig> {
    Some(TabletConfig {
        off: flag_child(node, "off"),
    })
}

fn touch_from_kdl(node: &KdlNode) -> Option<TouchConfig> {
    Some(TouchConfig {
        off: flag_child(node, "off"),
    })
}

fn layout_from_kdl(node: &KdlNode) -> Option<LayoutConfig> {
    Some(LayoutConfig {
        gaps: child_int(node, "gaps"),
        center_focused_column: child_string(node, "center-focused-column"),
        always_center_single_column: flag_child(node, "always-center-single-column"),
        empty_workspace_above_first: flag_child(node, "empty-workspace-above-first"),
        default_column_display: child_string(node, "default-column-display"),
        background_color: child_string(node, "background-color"),
        // niri writes these as blocks of `proportion`/`fixed`/`proportion x=`
        // and `default-column-width` as a block, none of which is a `Vec<i32>`.
        preset_column_widths: None,
        default_column_width: None,
        preset_window_heights: None,
        focus_ring: child_section(node, "focus-ring", focus_ring_from_kdl),
        border: child_section(node, "border", border_from_kdl),
        shadow: child_section(node, "shadow", shadow_from_kdl),
        tab_indicator: child_section(node, "tab-indicator", tab_indicator_from_kdl),
        struts: child_section(node, "struts", struts_from_kdl),
    })
}

fn focus_ring_from_kdl(node: &KdlNode) -> Option<FocusRingConfig> {
    // The schema has `enabled`/`color`; niri writes `off` plus
    // `active-color`/`inactive-color`. The two do not line up, so this stays
    // None and the nodes remain in the AST.
    let _ = node;
    None
}

fn border_from_kdl(node: &KdlNode) -> Option<BorderConfig> {
    let _ = node;
    None
}

fn shadow_from_kdl(node: &KdlNode) -> Option<ShadowConfig> {
    let offset = node.children().and_then(|c| c.get("offset"));
    Some(ShadowConfig {
        enabled: flag_child(node, "on"),
        softness: child_int(node, "softness"),
        spread: child_int(node, "spread"),
        offset_x: offset.and_then(|o| int_prop(o, "x")),
        offset_y: offset.and_then(|o| int_prop(o, "y")),
        color: child_string(node, "color"),
        draw_behind_window: flag_child(node, "draw-behind-window"),
    })
}

fn tab_indicator_from_kdl(node: &KdlNode) -> Option<TabIndicatorConfig> {
    Some(TabIndicatorConfig {
        position: child_string(node, "position"),
        colors: child_strings(node, "colors"),
        gaps: child_int(node, "gaps"),
        corner_radius: child_int(node, "corner-radius"),
    })
}

fn struts_from_kdl(node: &KdlNode) -> Option<StrutsConfig> {
    Some(StrutsConfig {
        left: child_int(node, "left"),
        right: child_int(node, "right"),
        top: child_int(node, "top"),
        bottom: child_int(node, "bottom"),
    })
}

fn animations_from_kdl(node: &KdlNode) -> Option<AnimationsConfig> {
    // niri spells the animation names out in full (`window-open`,
    // `workspace-switch`); the bare `open` / `close` / `switch-workspace` names
    // match nothing in a real config. The ones niri does not have - `overview`,
    // `overview-window`, `column-switch` - stay None rather than being guessed.
    Some(AnimationsConfig {
        enabled: node.children().map(|c| !c_has_flag(c, "off")),
        slowdown: child_f32(node, "slowdown"),
        window_open: animation_child(node, "window-open"),
        window_close: animation_child(node, "window-close"),
        window_move: animation_child(node, "window-movement"),
        window_resize: animation_child(node, "window-resize"),
        workspace_switch: animation_child(node, "workspace-switch"),
        column_switch: None,
        overview: None,
        overview_window: None,
    })
}

fn animation_child(node: &KdlNode, name: &str) -> Option<AnimationConfig> {
    child_section(node, name, animation_from_kdl)
}

fn animation_from_kdl(node: &KdlNode) -> Option<AnimationConfig> {
    Some(AnimationConfig {
        easing: child_section(node, "easing", easing_from_kdl),
        spring: child_section(node, "spring", spring_from_kdl),
        duration: child_int(node, "duration-ms"),
    })
}

fn easing_from_kdl(node: &KdlNode) -> Option<EasingConfig> {
    Some(EasingConfig {
        x1: child_f32(node, "x1")?,
        y1: child_f32(node, "y1")?,
        x2: child_f32(node, "x2")?,
        y2: child_f32(node, "y2")?,
    })
}

fn spring_from_kdl(node: &KdlNode) -> Option<SpringConfig> {
    Some(SpringConfig {
        damping: child_f32(node, "damping"),
        stiffness: child_f32(node, "stiffness"),
        epsilon: child_f32(node, "epsilon"),
        mass: child_f32(node, "mass"),
    })
}

fn gestures_from_kdl(node: &KdlNode) -> Option<GesturesConfig> {
    Some(GesturesConfig {
        hot_corners: child_section(node, "hot-corners", hot_corners_from_kdl),
        dnd_edge_view_scroll: flag_child(node, "dnd-edge-view-scroll"),
        dnd_edge_workspace_switch: flag_child(node, "dnd-edge-workspace-switch"),
    })
}

fn overview_from_kdl(node: &KdlNode) -> Option<OverviewConfig> {
    Some(OverviewConfig {
        zoom: child_f32(node, "zoom"),
        backdrop_color: child_string(node, "backdrop-color"),
        // niri nests it as `workspace-shadow { softness 40 }`, the schema wants
        // a flat bool.
        workspace_shadow: None,
    })
}

fn recent_windows_from_kdl(node: &KdlNode) -> Option<RecentWindowsConfig> {
    Some(RecentWindowsConfig {
        debounce_ms: child_int(node, "debounce-ms"),
        open_delay_ms: child_int(node, "open-delay-ms"),
        highlight: flag_child(node, "highlight"),
        previews: flag_child(node, "previews"),
    })
}

fn switch_events_from_kdl(node: &KdlNode) -> Option<SwitchEventsConfig> {
    Some(SwitchEventsConfig {
        lid_close: spawns_child(node, "lid-close"),
        lid_open: spawns_child(node, "lid-open"),
        tablet_mode_on: spawns_child(node, "tablet-mode-on"),
        tablet_mode_off: spawns_child(node, "tablet-mode-off"),
    })
}

fn spawns_child(node: &KdlNode, name: &str) -> Option<Vec<SpawnEntry>> {
    let child = node.children().and_then(|c| c.get(name))?;
    let entries: Vec<SpawnEntry> = MergedConfig::children(child)
        .filter(|(n, _)| n.name().value() == "spawn")
        .filter_map(|(n, _)| spawn_from_kdl(n))
        .collect();
    (!entries.is_empty()).then_some(entries)
}

fn debug_from_kdl(node: &KdlNode) -> Option<DebugConfig> {
    Some(DebugConfig {
        preview_render: flag_child(node, "preview-render"),
        disable_direct_scanout: flag_child(node, "disable-direct-scanout"),
        honor_xdg_activation_token: flag_child(node, "honor-xdg-activation-token"),
        dump_frames: flag_child(node, "dump-frames"),
        log_level: child_string(node, "log-level"),
    })
}

fn cursor_from_kdl(node: &KdlNode) -> Option<CursorConfig> {
    // niri spells both of these with an `xcursor-` prefix; the schema uses the
    // bare names. `cursor { size 24 }` is rejected by niri as an unknown node,
    // so the prefix is the only spelling that appears in a real config.
    Some(CursorConfig {
        theme: child_string(node, "xcursor-theme"),
        size: child_int(node, "xcursor-size"),
        hide_when_typing: flag_child(node, "hide-when-typing"),
        hide_after_inactive_ms: child_int(node, "hide-after-inactive-ms"),
    })
}

fn blur_from_kdl(node: &KdlNode) -> Option<BlurConfig> {
    Some(BlurConfig {
        enabled: node.children().map(|c| !c_has_flag(c, "off")),
        radius: child_int(node, "radius"),
        passes: child_int(node, "passes"),
        noise: child_f32(node, "noise"),
        contrast: child_f32(node, "contrast"),
        brightness: child_f32(node, "brightness"),
    })
}

fn xwayland_satellite_from_kdl(node: &KdlNode) -> Option<XwaylandSatelliteConfig> {
    Some(XwaylandSatelliteConfig {
        enabled: Some(true),
        // niri calls the executable `path`, the schema calls it `wm_class`.
        wm_class: child_string(node, "path"),
    })
}

fn clipboard_from_kdl(node: &KdlNode) -> Option<ClipboardConfig> {
    Some(ClipboardConfig {
        enabled: Some(!node_has_flag(node, "disable-primary")),
        history: flag_child(node, "history"),
        max_items: child_int(node, "max-items"),
    })
}

fn hotkey_overlay_from_kdl(node: &KdlNode) -> Option<HotkeyOverlayConfig> {
    Some(HotkeyOverlayConfig {
        enabled: Some(!node_has_flag(node, "skip-at-startup")),
        delay_ms: child_int(node, "delay-ms"),
        width: child_int(node, "width"),
        height: child_int(node, "height"),
    })
}

fn config_notification_from_kdl(node: &KdlNode) -> Option<ConfigNotificationConfig> {
    Some(ConfigNotificationConfig {
        enabled: Some(true),
        position: child_string(node, "position"),
    })
}

fn hot_corners_from_kdl(node: &KdlNode) -> Option<HotCornersConfig> {
    Some(HotCornersConfig {
        top_left: child_string(node, "top-left"),
        top_right: child_string(node, "top-right"),
        bottom_left: child_string(node, "bottom-left"),
        bottom_right: child_string(node, "bottom-right"),
    })
}

fn output_from_kdl(node: &KdlNode) -> Option<OutputConfig> {
    let name = MergedConfig::arg(node)?;
    let position = node
        .children()
        .and_then(|c| c.get("position"))
        .and_then(|p| {
            let x = int_prop(p, "x")?;
            let y = int_prop(p, "y")?;
            Some(Position { x, y })
        });
    Some(OutputConfig {
        name,
        off: flag_child(node, "off"),
        mode: child_string(node, "mode"),
        scale: child_f32(node, "scale"),
        transform: child_string(node, "transform"),
        position,
        variable_refresh_rate: flag_child(node, "variable-refresh-rate"),
        focus_at_startup: flag_child(node, "focus-at-startup"),
        background_color: child_string(node, "background-color"),
        backdrop_color: child_string(node, "backdrop-color"),
        hot_corners: child_section(node, "hot-corners", hot_corners_from_kdl),
        max_bpc: child_int(node, "max-bpc"),
        layout: child_section(node, "layout", layout_from_kdl),
    })
}

fn window_rule_from_kdl(node: &KdlNode) -> Option<WindowRule> {
    // niri writes the match criteria as repeated `match app-id=...` nodes, the
    // schema wants a single `match_rules` object. A rule whose criteria are
    // repeated or partially given cannot be represented, so it is reported
    // rather than half-converted.
    let matches: Vec<&KdlNode> = MergedConfig::children(node)
        .filter(|(n, name)| n.name().value() == "match" && *name == "match")
        .map(|(n, _)| n)
        .collect();
    let match_rules = match_rules_from(matches.iter().copied())?;
    let exclude = {
        let ex: Vec<&KdlNode> = MergedConfig::children(node)
            .filter(|(n, _)| n.name().value() == "exclude")
            .map(|(n, _)| n)
            .collect();
        if ex.is_empty() {
            None
        } else {
            match_rules_from(ex.iter().copied())
        }
    };

    Some(WindowRule {
        match_rules,
        exclude,
        open_floating: flag_child(node, "open-floating"),
        open_fullscreen: flag_child(node, "open-fullscreen"),
        open_maximized: flag_child(node, "open-maximized"),
        open_centered: flag_child(node, "open-centered"),
        open_tiled: flag_child(node, "open-tiled"),
        default_width: child_int(node, "default-width"),
        default_height: child_int(node, "default-height"),
        min_width: child_int(node, "min-width"),
        min_height: child_int(node, "min-height"),
        max_width: child_int(node, "max-width"),
        max_height: child_int(node, "max-height"),
        border: flag_child(node, "border"),
        focus_ring: flag_child(node, "focus-ring"),
        shadow: flag_child(node, "shadow"),
        geometry_corner_radius: child_int(node, "geometry-corner-radius"),
        clip_to_geometry: flag_child(node, "clip-to-geometry"),
        opacity: child_f32(node, "opacity"),
        block_out_from: child_string(node, "block-out-from"),
    })
}

/// Merge repeated `match`/`exclude` nodes into one criteria object.
///
/// Two nodes setting the same criterion (the keepass example sets `app-id`
/// twice to block two apps) cannot be a single `MatchRules`, because the struct
/// holds one value per key.
fn match_rules_from<'a>(nodes: impl Iterator<Item = &'a KdlNode>) -> Option<MatchRules> {
    let mut rules = MatchRules::default();
    let mut any = false;
    // Shared across every `match` node: setting one criterion twice, whether in
    // one node or in two, is the case a single-valued struct cannot hold.
    let mut seen: Vec<&str> = Vec::new();
    for node in nodes {
        any = true;
        for entry in node.entries() {
            let Some(name) = entry.name() else { continue };
            if seen.contains(&name.value()) {
                return None;
            }
            seen.push(name.value());
            let value = entry.value().as_string().map(str::to_string);
            match name.value() {
                "title" => rules.title = value,
                "app-id" => rules.app_id = value,
                "namespace" => rules.namespace = value,
                "is-active" => rules.is_active = bool_prop(node, "is-active"),
                "is-focused" => rules.is_focused = bool_prop(node, "is-focused"),
                "is-floating" => rules.is_floating = bool_prop(node, "is-floating"),
                "is-maximized" => rules.is_maximized = bool_prop(node, "is-maximized"),
                "is-fullscreen" => rules.is_fullscreen = bool_prop(node, "is-fullscreen"),
                "at-startup" => rules.at_startup = bool_prop(node, "at-startup"),
                _ => return None,
            }
        }
    }
    any.then_some(rules)
}

fn layer_rule_from_kdl(node: &KdlNode) -> Option<LayerRule> {
    let matches: Vec<&KdlNode> = MergedConfig::children(node)
        .filter(|(n, _)| n.name().value() == "match")
        .map(|(n, _)| n)
        .collect();
    let match_rules = match_rules_from(matches.iter().copied())?;
    Some(LayerRule {
        namespace: match_rules.namespace.clone().unwrap_or_default(),
        match_rules,
        exclude: None,
        anchor: child_string(node, "anchor"),
        layer: child_string(node, "layer"),
        keyboard_interactivity: child_string(node, "keyboard-interactivity"),
        margin: None,
    })
}

fn workspace_from_kdl(node: &KdlNode) -> Option<NamedWorkspace> {
    Some(NamedWorkspace {
        name: MergedConfig::arg(node).unwrap_or_default(),
        open_on_output: child_string(node, "open-on-output"),
        layout: child_section(node, "layout", layout_from_kdl),
    })
}

fn spawn_entry_from_arg(node: &KdlNode) -> Option<SpawnEntry> {
    Some(SpawnEntry {
        command: MergedConfig::arg(node)?,
        args: None,
        env: None,
    })
}

fn spawn_from_kdl(node: &KdlNode) -> Option<SpawnEntry> {
    let args: Vec<String> = MergedConfig::args(node);
    let (command, rest) = args.split_first()?;
    let mut env = HashMap::new();
    for arg in rest {
        if let Some((k, v)) = arg.split_once('=') {
            if k.chars()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
            {
                env.insert(k.to_string(), v.to_string());
            }
        }
    }
    let args: Vec<String> = rest
        .iter()
        .filter(|a| {
            !a.contains('=')
                || !a.split_once('=').is_some_and(|(k, _)| {
                    k.chars()
                        .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
                })
        })
        .cloned()
        .collect();
    Some(SpawnEntry {
        command: command.clone(),
        args: (!args.is_empty()).then_some(args),
        env: (!env.is_empty()).then_some(env),
    })
}

fn environment_from_kdl(merged: &MergedConfig<'_>) -> HashMap<String, Option<String>> {
    let mut env = HashMap::new();
    for located in merged.nodes_named("environment") {
        for (child, name) in MergedConfig::children(located.node) {
            let value = MergedConfig::scalar(child).and_then(|v| match v {
                Value::Null => None,
                Value::String(s) => Some(s),
                other => Some(other.to_string()),
            });
            env.insert(name.to_string(), value);
        }
    }
    env
}

fn binds_from_kdl(merged: &MergedConfig<'_>) -> BindsConfig {
    let mut binds = BindsConfig::default();
    for located in merged.nodes_named("binds") {
        let Some(children) = located.node.children() else {
            continue;
        };
        for child in children.nodes() {
            binds.binds.push(bind_entry(child));
        }
    }
    binds
}

/// A bind is `key [properties] { action; }`.
///
/// The action is a child node, never an argument: `Mod+T spawn "foot"` is
/// rejected by both the KDL parser and niri, because a bare identifier is not a
/// value.
///
/// `BindsConfig::modes` stays empty. niri declares a modal bind with a
/// `switch-mode` action rather than a second block, so the schema's mode map has
/// no source to read from yet; filling it is a follow-up, not something to
/// guess at here.
fn bind_entry(node: &KdlNode) -> BindEntry {
    let action_node = node.children().and_then(|c| c.nodes().first());
    let args = action_node.map(MergedConfig::args).unwrap_or_default();
    BindEntry {
        key: node.name().value().to_string(),
        action: action_node
            .map(|a| a.name().value().to_string())
            .unwrap_or_default(),
        args: (!args.is_empty()).then_some(args),
        cooldown_ms: int_prop(node, "cooldown-ms"),
        allow_when_locked: bool_prop(node, "allow-when-locked"),
        allow_inhibiting: bool_prop(node, "allow-inhibiting"),
        overlay_title: string_prop(node, "hotkey-overlay-title"),
    }
}

fn unknown_as_json(merged: &MergedConfig<'_>) -> Vec<Value> {
    const KNOWN: &[&str] = &[
        "input",
        "output",
        "binds",
        "layout",
        "window-rule",
        "layer-rule",
        "animations",
        "gestures",
        "overview",
        "recent-windows",
        "workspaces",
        "switch-events",
        "debug",
        "spawn-at-startup",
        "spawn-sh-at-startup",
        "environment",
        "cursor",
        "screenshot-path",
        "prefer-no-csd",
        "blur",
        "xwayland-satellite",
        "clipboard",
        "hotkey-overlay",
        "config-notification",
        "include",
        "workspace",
    ];
    let mut out = Vec::new();
    for located in merged.nodes() {
        if KNOWN.contains(&located.node.name().value()) {
            continue;
        }
        out.push(Value::Object(Map::from_iter([(
            located.node.name().value().to_string(),
            node_to_json(located.node),
        )])));
    }
    out
}

/// A lossy JSON view of a node, for `Config::unknown`.
///
/// The AST keeps the node verbatim; this exists so the frontend can list a
/// section it does not model without the engine having to pretend it understands
/// it.
fn node_to_json(node: &KdlNode) -> Value {
    let mut map = Map::from_iter([(
        node.name().value().to_string(),
        Value::Array(
            MergedConfig::args(node)
                .into_iter()
                .map(Value::String)
                .collect(),
        ),
    )]);
    for (child, name) in MergedConfig::children(node) {
        map.insert(
            name.to_string(),
            child
                .children()
                .map(|_| node_to_json(child))
                .or_else(|| MergedConfig::scalar(child))
                .unwrap_or(Value::Null),
        );
    }
    Value::Object(map)
}

// --- child accessors --------------------------------------------------------

/// Whether a children block carries a bare `<name>` flag node.
fn c_has_flag(children: &KdlDocument, name: &str) -> bool {
    children
        .get(name)
        .is_some_and(|n| n.entries().is_empty() && n.children().is_none())
}

/// [`c_has_flag`] for a node that is itself the block.
fn node_has_flag(node: &KdlNode, name: &str) -> bool {
    node.children().is_some_and(|c| c_has_flag(c, name))
}

fn child_scalar(node: &KdlNode, name: &str) -> Option<Value> {
    node.children()
        .and_then(|c| c.get(name))
        .and_then(MergedConfig::scalar)
}

fn child_string(node: &KdlNode, name: &str) -> Option<String> {
    child_scalar(node, name).and_then(|v| v.as_str().map(str::to_string))
}

fn child_strings(node: &KdlNode, name: &str) -> Option<Vec<String>> {
    let child = node.children().and_then(|c| c.get(name))?;
    Some(MergedConfig::args(child))
}

fn child_int(node: &KdlNode, name: &str) -> Option<i32> {
    child_scalar(node, name).and_then(|v| v.as_i64().and_then(|i| i32::try_from(i).ok()))
}

fn child_f32(node: &KdlNode, name: &str) -> Option<f32> {
    child_scalar(node, name)
        .and_then(|v| v.as_f64())
        .map(|v| v as f32)
}

/// A child node that stands for a boolean.
///
/// niri writes `natural-scroll` for true and `/-natural-scroll` for false. A
/// `/-` node is still a node in the AST, so an explicit `natural-scroll false`
/// is a real setting and is read as false.
fn flag_child(node: &KdlNode, name: &str) -> Option<bool> {
    let value = child_scalar(node, name)?;
    match value {
        Value::Null => Some(false),
        Value::Bool(b) => Some(b),
        _ => None,
    }
}

/// An integer property.
///
/// Read straight off the `KdlValue` rather than through its string form: niri
/// writes `cooldown-ms=150` and `position x=0 y=0` as real numbers, and asking a
/// number for its string yields nothing.
fn int_prop(node: &KdlNode, name: &str) -> Option<i32> {
    let value = node.get(name)?;
    let n = match value.value() {
        KdlValue::Base10(i) => *i,
        KdlValue::Base2(i) => *i,
        KdlValue::Base8(i) => *i,
        KdlValue::Base16(i) => *i,
        KdlValue::Base10Float(f) => *f as i64,
        KdlValue::String(raw) | KdlValue::RawString(raw) => raw.parse().ok()?,
        KdlValue::Bool(_) | KdlValue::Null => return None,
    };
    i32::try_from(n).ok()
}

fn string_prop(node: &KdlNode, name: &str) -> Option<String> {
    node.get(name)
        .and_then(|v| v.value().as_string().map(str::to_string))
}

fn bool_prop(node: &KdlNode, name: &str) -> Option<bool> {
    match node.get(name).map(|v| v.value().clone()) {
        Some(KdlValue::Bool(b)) => Some(b),
        Some(KdlValue::Null) => Some(false),
        _ => None,
    }
}

fn child_section<T>(node: &KdlNode, name: &str, read: fn(&KdlNode) -> Option<T>) -> Option<T> {
    read(node.children().and_then(|c| c.get(name))?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kdl::include::load_config_set;

    /// Write `body` to a temp config, load it, apply `edit` to the projected
    /// model, and hand back the resulting text.
    fn round_trip(body: &str, edit: impl FnOnce(&mut Config)) -> String {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("config.kdl");
        std::fs::write(&path, body).expect("write");

        let mut set = load_config_set(&path).expect("load");
        let mut config = to_config(&set).expect("project");
        edit(&mut config);
        apply_config(&mut set, &config).expect("apply");
        set.main().doc.to_string()
    }

    /// The same, but also reporting which files were touched.
    fn round_trip_changed(body: &str, edit: impl FnOnce(&mut Config)) -> (String, ChangedFiles) {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("config.kdl");
        std::fs::write(&path, body).expect("write");

        let mut set = load_config_set(&path).expect("load");
        let mut config = to_config(&set).expect("project");
        edit(&mut config);
        let changed = apply_config(&mut set, &config).expect("apply");
        (set.main().doc.to_string(), changed)
    }

    fn with_blur(enabled: bool) -> impl FnOnce(&mut Config) {
        move |config: &mut Config| {
            config.blur = Some(BlurConfig {
                enabled: Some(enabled),
                ..BlurConfig::default()
            });
        }
    }

    // --- D-1: `on` / `off` is a rename, not a value --------------------------

    #[test]
    fn turning_blur_off_renames_on_to_off() {
        // `blur { on false }` is a file niri refuses to load with
        // `Error: unexpected argument`, so the engine must never produce it.
        let out = round_trip("blur {\n  on\n  passes 2\n}\n", with_blur(false));
        assert_eq!(out, "blur {\n  off\n  passes 2\n}\n", "{out}");
        assert!(!out.contains("false"), "an argument was written: {out}");
    }

    #[test]
    fn turning_blur_on_renames_off_to_on() {
        let out = round_trip("blur {\n  off\n  passes 2\n}\n", with_blur(true));
        assert_eq!(out, "blur {\n  on\n  passes 2\n}\n", "{out}");
    }

    #[test]
    fn blur_already_off_is_left_alone() {
        // The value read back out of the file already agrees with the model, so
        // applying it has to change nothing at all - and report nothing.
        let (out, changed) = round_trip_changed("blur {\n  off\n}\n", with_blur(false));
        assert_eq!(out, "blur {\n  off\n}\n");
        assert!(changed.is_empty(), "reported {changed:?} for a no-op");
    }

    #[test]
    fn blur_already_on_is_left_alone() {
        let (out, changed) = round_trip_changed("blur {\n  on\n}\n", with_blur(true));
        assert_eq!(out, "blur {\n  on\n}\n");
        assert!(changed.is_empty(), "reported {changed:?} for a no-op");
    }

    #[test]
    fn blur_comment_next_to_the_toggle_survives_the_rename() {
        let out = round_trip(
            "blur {\n  // the user wrote this\n  on\n}\n",
            with_blur(false),
        );
        assert_eq!(out, "blur {\n  // the user wrote this\n  off\n}\n", "{out}");
    }

    #[test]
    fn a_block_with_neither_spelling_is_not_invented() {
        // Adding `off` to a `blur` block that only sets `passes` would be
        // writing a setting the user never had.
        let (out, changed) = round_trip_changed("blur {\n  passes 2\n}\n", with_blur(false));
        assert_eq!(out, "blur {\n  passes 2\n}\n");
        assert!(changed.is_empty(), "reported {changed:?}");
    }

    // --- D-2: `prefer-no-csd` is a bool, so false has to be writable ---------

    #[test]
    fn disabling_prefer_no_csd_writes_false() {
        // A bare `prefer-no-csd` already means true, so leaving it bare when the
        // model says false is the bug: the setting could never be turned off.
        let out = round_trip("prefer-no-csd\n", |config| {
            config.prefer_no_csd = false;
        });
        assert_eq!(out, "prefer-no-csd false\n", "{out}");
    }

    #[test]
    fn enabling_prefer_no_csd_writes_true_back() {
        let out = round_trip("prefer-no-csd false\n", |config| {
            config.prefer_no_csd = true;
        });
        assert_eq!(out, "prefer-no-csd true\n", "{out}");
    }

    #[test]
    fn a_bare_prefer_no_csd_is_left_bare() {
        let (out, changed) = round_trip_changed("prefer-no-csd\n", |config| {
            config.prefer_no_csd = true;
        });
        assert_eq!(out, "prefer-no-csd\n", "true must not be spelled out");
        assert!(changed.is_empty(), "reported {changed:?}");
    }

    // --- the rest of the write path ------------------------------------------

    #[test]
    fn layout_gaps_is_written() {
        let out = round_trip("layout {\n  gaps 10\n}\n", |config| {
            config.layout = Some(LayoutConfig {
                gaps: Some(42),
                ..LayoutConfig::default()
            });
        });
        assert_eq!(out, "layout {\n  gaps 42\n}\n", "{out}");
    }

    #[test]
    fn layout_gaps_keeps_its_original_form_when_unchanged() {
        // A value that came back through the model must not be re-emitted, or
        // every save would rewrite the whole file.
        let (out, changed) = round_trip_changed("layout {\n  gaps 10\n}\n", |_| {});
        assert_eq!(out, "layout {\n  gaps 10\n}\n");
        assert!(changed.is_empty());
    }

    #[test]
    fn a_hex_gaps_value_is_not_rewritten_in_decimal() {
        let (out, changed) = round_trip_changed("layout {\n  gaps 0x10\n}\n", |_| {});
        assert_eq!(out, "layout {\n  gaps 0x10\n}\n", "{out}");
        assert!(changed.is_empty());
    }

    #[test]
    fn screenshot_path_is_written() {
        let out = round_trip("screenshot-path \"/old\"\n", |config| {
            config.screenshot_path = Some("/new".to_string());
        });
        assert_eq!(out, "screenshot-path \"/new\"\n", "{out}");
    }

    #[test]
    fn a_field_with_no_node_in_the_file_is_skipped() {
        let (out, changed) = round_trip_changed("layout {\n  gaps 10\n}\n", |config| {
            config.screenshot_path = Some("/new".to_string());
        });
        assert_eq!(out, "layout {\n  gaps 10\n}\n");
        assert!(changed.is_empty(), "reported {changed:?}");
    }

    #[test]
    fn a_non_scalar_value_is_refused_rather_than_stringified() {
        // Turning a JSON object into `"{\"a\":1}"` is the "coerce it so it
        // compiles" move that code-style forbids.
        let err = set_single_arg(&mut KdlNode::new("x"), serde_json::json!({"a": 1}))
            .expect_err("object has no KDL spelling");
        assert!(matches!(err, ApplyError::Unrepresentable(_)), "{err:?}");
        assert!(json_to_kdl(&serde_json::json!([1, 2])).is_none());
        assert!(json_to_kdl(&serde_json::json!(true)).is_some());
    }

    // --- D-3: the source map must not keep a stale copy ---------------------

    #[test]
    fn the_source_map_document_follows_an_edit() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("config.kdl");
        std::fs::write(&path, "layout {\n  gaps 10\n}\n").expect("write");

        let mut set = load_config_set(&path).expect("load");
        let mut config = to_config(&set).expect("project");
        config.layout = Some(LayoutConfig {
            gaps: Some(42),
            ..LayoutConfig::default()
        });
        let changed = apply_config(&mut set, &config).expect("apply");
        assert_eq!(changed.len(), 1);

        let live = set.main().doc.to_string();
        let mapped = set
            .source_map
            .get_document(&set.main_path)
            .expect("the source map still has a document")
            .to_string();
        assert_eq!(live, mapped, "source map handed out a stale document");
        assert!(mapped.contains("gaps 42"), "{mapped}");
    }

    #[test]
    fn an_edit_does_not_move_the_reported_line_numbers() {
        // The stored text has to stay the original: spans recorded at parse time
        // index into it, and that is what keeps line 1 line 1 after an edit.
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("config.kdl");
        let body = "// a comment\nlayout {\n  gaps 10\n}\n";
        std::fs::write(&path, body).expect("write");

        let mut set = load_config_set(&path).expect("load");
        let layout = set
            .main()
            .doc
            .nodes()
            .iter()
            .find(|n| n.name().value() == "layout")
            .expect("layout node");
        let id = crate::kdl::source_map::node_id_from_node(set.main_path.clone(), layout);
        assert_eq!(&body[id.byte_range()][..6], "layout");
        assert_eq!(set.source_map.line_column(&id), Some((2, 1)));

        let mut config = to_config(&set).expect("project");
        config.layout = Some(LayoutConfig {
            gaps: Some(42),
            ..LayoutConfig::default()
        });
        apply_config(&mut set, &config).expect("apply");
        assert_eq!(set.source_map.line_column(&id), Some((2, 1)));
        assert_eq!(
            set.source_map.get_source_content(&set.main_path),
            Some(body)
        );
    }

    // --- D-4: duplicates are per file, shadowing is not ---------------------

    #[test]
    fn one_section_in_two_files_is_a_warning_not_an_error() {
        // niri accepts this: it reports a duplicate only within a single
        // document. Treating the set as one document would reject configs niri
        // loads, such as `noctalia-style` with `environment` in two files.
        let dir = tempfile::tempdir().expect("temp dir");
        std::fs::create_dir_all(dir.path().join("cfg")).expect("mkdir");
        std::fs::write(
            dir.path().join("config.kdl"),
            "layout {\n  gaps 1\n}\ninclude \"cfg/a.kdl\"\n",
        )
        .expect("write");
        std::fs::write(dir.path().join("cfg/a.kdl"), "layout {\n  gaps 10\n}\n").expect("write");

        let set = load_config_set(&dir.path().join("config.kdl")).expect("load");
        let (config, report) = to_config_with_report(&set).expect("must not fail");
        assert_eq!(config.layout.as_ref().and_then(|l| l.gaps), Some(1));
        assert!(report.duplicates.is_empty(), "{:?}", report.duplicates);
        assert_eq!(report.shadowed.len(), 2, "both copies are reported");
        assert!(report.shadowed.iter().all(|s| s.reason == SHADOWED));
        assert!(report.shadowed.iter().all(|s| s.raw.starts_with("layout")));
    }

    #[test]
    fn a_section_in_two_files_is_written_to_both() {
        // Both copies are live as far as the file layout goes, and only one
        // survives in the running compositor. Writing both is the only choice
        // that does not silently leave a stale value behind in one of them; the
        // report is what tells the user this is ambiguous.
        let dir = tempfile::tempdir().expect("temp dir");
        std::fs::create_dir_all(dir.path().join("cfg")).expect("mkdir");
        std::fs::write(
            dir.path().join("config.kdl"),
            "layout {\n  gaps 1\n}\ninclude \"cfg/a.kdl\"\n",
        )
        .expect("write");
        std::fs::write(dir.path().join("cfg/a.kdl"), "layout {\n  gaps 10\n}\n").expect("write");

        let mut set = load_config_set(&dir.path().join("config.kdl")).expect("load");
        let mut config = to_config(&set).expect("project");
        config.layout = Some(LayoutConfig {
            gaps: Some(7),
            ..LayoutConfig::default()
        });
        let changed = apply_config(&mut set, &config).expect("apply");
        assert_eq!(changed.len(), 2, "both files own a `layout` node");
        for path in &changed {
            // `apply_config` edits the AST; writing to disk is the save path's
            // job, so the change is checked in memory.
            let text = set.file(path).expect("in the set").doc.to_string();
            assert!(text.contains("gaps 7"), "{}: {text}", path.display());
        }
    }

    #[test]
    fn one_section_twice_in_one_file_is_an_error() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("config.kdl");
        std::fs::write(&path, "layout {\n  gaps 10\n}\nlayout {\n  gaps 20\n}\n").expect("write");
        let set = load_config_set(&path).expect("load");
        let err = to_config_with_report(&set).expect_err("niri rejects this");
        assert!(err.to_string().contains("only once"), "{err}");
    }

    // --- D-5: renamed children are not "not understood" ---------------------

    #[test]
    fn renamed_children_are_not_reported_as_unknown() {
        // All three are read by the engine; comparing the raw node name against
        // the serde field name is what used to call them unknown.
        let body = "cursor {\n  xcursor-theme \"Bibata\"\n  xcursor-size 24\n}\n\n\
                    hotkey-overlay {\n  skip-at-startup\n}\n\n\
                    blur {\n  on\n}\n";
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("config.kdl");
        std::fs::write(&path, body).expect("write");

        let set = load_config_set(&path).expect("load");
        let (config, report) = to_config_with_report(&set).expect("project");
        assert!(report.unmapped.is_empty(), "{:?}", report.unmapped);

        let cursor = config.cursor.as_ref().expect("cursor");
        assert_eq!(cursor.theme.as_deref(), Some("Bibata"));
        assert_eq!(cursor.size, Some(24));
        assert_eq!(
            config.hotkey_overlay.as_ref().and_then(|h| h.enabled),
            Some(false),
            "skip-at-startup means the overlay is off"
        );
        assert_eq!(config.blur.as_ref().and_then(|b| b.enabled), Some(true));
    }

    #[test]
    fn a_genuinely_unknown_child_is_still_reported() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("config.kdl");
        std::fs::write(
            &path,
            "layout {\n  gaps 10\n  custom-column-rule \"50%\"\n}\n",
        )
        .expect("write");
        let set = load_config_set(&path).expect("load");
        let (_, report) = to_config_with_report(&set).expect("project");
        assert_eq!(report.unmapped.len(), 1, "{:?}", report.unmapped);
        assert_eq!(report.unmapped[0].reason, NO_FIELD);
        assert!(report.unmapped[0].raw.contains("custom-column-rule"));
    }

    // --- D-7: the preview is the node, not the comment above it -------------

    #[test]
    fn an_unmapped_preview_is_the_node_and_not_its_leading_comment() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("config.kdl");
        let body = "// a comment that belongs to the node below\n\
                    window-rule {\n  geometry-corner-radius 12\n}\n";
        std::fs::write(&path, body).expect("write");

        let set = load_config_set(&path).expect("load");
        let (_, report) = to_config_with_report(&set).expect("project");
        let unmapped = report
            .unmapped
            .iter()
            .chain(report.shadowed.iter())
            .find(|u| u.line == 2)
            .expect("the rule is on line 2");
        assert!(
            unmapped.raw.starts_with("window-rule"),
            "preview is not the node: {:?}",
            unmapped.raw
        );
        assert!(
            !unmapped.raw.contains("a comment that belongs"),
            "the leading decor leaked into the preview: {:?}",
            unmapped.raw
        );
    }

    // --- read path: names niri actually writes -------------------------------

    /// Every KDL child name the engine looks up, per section that
    /// `report_unknown_children` checks.
    ///
    /// A name has to satisfy one rule in both places at once: the reader looks
    /// it up by its KDL spelling, and the report resolves it through
    /// [`serde_name_of`] to decide whether the schema has a field for it. A name
    /// that reads correctly but resolves to nothing is reported as not
    /// understood - a warning about something the engine just read. Listing them
    /// here turns that into a failing test rather than a warning in somebody's
    /// status panel.
    const READ_NAMES: &[(&str, &[&str])] = &[
        (
            "input",
            &[
                "keyboard",
                "touchpad",
                "mouse",
                "trackpoint",
                "tablet",
                "touch",
                "focus-follows-mouse",
                "warp-mouse-to-focus",
                "mod-key",
            ],
        ),
        (
            "layout",
            &[
                "gaps",
                "center-focused-column",
                "always-center-single-column",
                "empty-workspace-above-first",
                "default-column-display",
                "background-color",
                "focus-ring",
                "border",
                "shadow",
                "tab-indicator",
                "struts",
            ],
        ),
        (
            "cursor",
            &[
                "xcursor-theme",
                "xcursor-size",
                "hide-when-typing",
                "hide-after-inactive-ms",
            ],
        ),
        (
            "blur",
            &[
                "on",
                "off",
                "radius",
                "passes",
                "noise",
                "contrast",
                "brightness",
            ],
        ),
        ("clipboard", &["disable-primary", "history", "max-items"]),
        (
            "animations",
            &[
                "off",
                "slowdown",
                "window-open",
                "window-close",
                "window-movement",
                "window-resize",
                "workspace-switch",
            ],
        ),
        // `workspace-shadow` is niri's own name for the field, but niri writes
        // it as a block and the schema has a bool, so the engine does not read
        // it. Not listed here: this table is what the engine looks up.
        ("overview", &["zoom", "backdrop-color"]),
        (
            "switch-events",
            &["lid-close", "lid-open", "tablet-mode-on", "tablet-mode-off"],
        ),
        (
            "hotkey-overlay",
            &["skip-at-startup", "delay-ms", "width", "height"],
        ),
        ("xwayland-satellite", &["path"]),
    ];

    fn schema_keys<T: serde::Serialize>(value: &T) -> serde_json::Map<String, serde_json::Value> {
        serde_json::to_value(value)
            .expect("a schema struct always serializes")
            .as_object()
            .expect("a schema struct is always an object")
            .clone()
    }

    /// A projection with everything present, so the key set is the full field
    /// list rather than only what one file happened to set.
    fn full_config() -> Config {
        Config {
            input: Some(InputConfig::default()),
            layout: Some(LayoutConfig::default()),
            cursor: Some(CursorConfig::default()),
            blur: Some(BlurConfig::default()),
            clipboard: Some(ClipboardConfig::default()),
            animations: Some(AnimationsConfig::default()),
            overview: Some(OverviewConfig::default()),
            switch_events: Some(SwitchEventsConfig::default()),
            hotkey_overlay: Some(HotkeyOverlayConfig::default()),
            xwayland_satellite: Some(XwaylandSatelliteConfig::default()),
            ..Config::default()
        }
    }

    #[test]
    fn every_name_the_engine_reads_resolves_to_a_real_schema_field() {
        let config = full_config();
        let sections: Vec<(&str, serde_json::Map<String, serde_json::Value>)> = vec![
            ("input", schema_keys(&config.input)),
            ("layout", schema_keys(&config.layout)),
            ("cursor", schema_keys(&config.cursor)),
            ("blur", schema_keys(&config.blur)),
            ("clipboard", schema_keys(&config.clipboard)),
            ("animations", schema_keys(&config.animations)),
            ("overview", schema_keys(&config.overview)),
            ("switch-events", schema_keys(&config.switch_events)),
            ("hotkey-overlay", schema_keys(&config.hotkey_overlay)),
            (
                "xwayland-satellite",
                schema_keys(&config.xwayland_satellite),
            ),
        ];

        for (section, names) in READ_NAMES {
            let keys = sections
                .iter()
                .find(|(name, _)| name == section)
                .map(|(_, keys)| keys)
                .unwrap_or_else(|| panic!("{section} is not a reported section"));
            for kdl_name in *names {
                let serde_name = serde_name_of(section, kdl_name);
                assert!(
                    keys.contains_key(serde_name),
                    "{section}.{kdl_name} is read by the engine but resolves to \
                     `{serde_name}`, which is not a field of the schema struct"
                );
            }
        }
    }

    #[test]
    fn no_rename_points_at_a_field_that_does_not_exist() {
        // Catches a typo in the table itself, which would otherwise turn into a
        // node the engine reports as unknown and never reads.
        let config = full_config();
        for (section, kdl_name, serde_name) in RENAMED_CHILDREN {
            let keys = match *section {
                "input" => schema_keys(&config.input),
                "layout" => schema_keys(&config.layout),
                "cursor" => schema_keys(&config.cursor),
                "blur" => schema_keys(&config.blur),
                "clipboard" => schema_keys(&config.clipboard),
                "animations" => schema_keys(&config.animations),
                "overview" => schema_keys(&config.overview),
                "switch-events" => schema_keys(&config.switch_events),
                "hotkey-overlay" => schema_keys(&config.hotkey_overlay),
                "xwayland-satellite" => schema_keys(&config.xwayland_satellite),
                other => panic!("rename table names an unreported section: {other}"),
            };
            assert!(
                keys.contains_key(*serde_name),
                "{section}: rename `{kdl_name}` -> `{serde_name}`, but that is not a field"
            );
        }
    }

    #[test]
    fn window_movement_is_read_and_not_reported() {
        // niri writes `window-movement`; the schema field is `window_move`,
        // which kebab-cases to `window-move`. Both the read and the report have
        // to agree, or the engine warns about a node it just understood.
        let body = "animations {\n    window-movement {\n        duration-ms 150\n    }\n}\n";
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("config.kdl");
        std::fs::write(&path, body).expect("write");

        let mut set = load_config_set(&path).expect("load");
        let (config, report) = to_config_with_report(&set).expect("project");
        assert!(
            report.unmapped.is_empty(),
            "window-movement was reported as unknown: {:?}",
            report.unmapped
        );
        let animations = config.animations.as_ref().expect("animations");
        assert_eq!(
            animations.window_move.as_ref().and_then(|a| a.duration),
            Some(150)
        );

        // And the round-trip still leaves the file alone.
        apply_config(&mut set, &config).expect("apply");
        assert_eq!(set.main().doc.to_string(), body);
    }

    #[test]
    fn animation_names_are_read_the_way_niri_writes_them() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("config.kdl");
        std::fs::write(
            &path,
            "animations {\n  slowdown 3.0\n  window-open {\n    duration-ms 200\n  }\n}\n",
        )
        .expect("write");
        let set = load_config_set(&path).expect("load");
        let (config, report) = to_config_with_report(&set).expect("project");
        let animations = config.animations.as_ref().expect("animations");
        assert_eq!(animations.slowdown, Some(3.0));
        assert_eq!(
            animations.window_open.as_ref().and_then(|a| a.duration),
            Some(200)
        );
        assert!(report.unmapped.is_empty(), "{:?}", report.unmapped);
    }
}
