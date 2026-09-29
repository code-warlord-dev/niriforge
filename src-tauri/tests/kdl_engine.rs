//! Load/save round-trip and include-resolution tests over `testdata/`.
//!
//! The property under test throughout is the one a user notices first: opening a
//! config in NiriForge and saving it without touching anything must leave every
//! byte on disk alone. That is why these tests compare strings rather than
//! documents - `KdlDocument`'s own equality walks the leading/trailing decor
//! character by character, which makes a failure unreadable and hides the actual
//! regression behind a formatting detail.

use niriforge_lib::kdl::include::{IncludeTree, MAX_INCLUDE_DEPTH};
use niriforge_lib::kdl::mapping::to_config_with_report;
use niriforge_lib::kdl::{apply_config, parse_config, serialize_all, to_config};
use niriforge_lib::schema::Config;
use std::path::{Path, PathBuf};

const TESTDATA: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/testdata");

/// Every fixture, as (label, path).
fn fixtures() -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    let root = Path::new(TESTDATA);
    collect_kdl(root, root, &mut out);
    out.sort_by(|a, b| a.0.cmp(&b.0));
    assert!(!out.is_empty(), "no fixtures found under {TESTDATA}");
    out
}

fn collect_kdl(root: &Path, dir: &Path, out: &mut Vec<(String, PathBuf)>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_kdl(root, &path, out);
        } else if path.extension().is_some_and(|e| e == "kdl") {
            let label = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .display()
                .to_string();
            out.push((label, path));
        }
    }
}

/// Entry points that make sense on their own.
///
/// A file reached through an `include` is a fragment, but every one of them in
/// `testdata` is also a valid config, so parsing it directly is a useful check
/// that a fragment is not being read through its parent's lens.
fn entry_points() -> Vec<PathBuf> {
    vec![
        Path::new(TESTDATA).join("default.kdl"),
        Path::new(TESTDATA).join("with-comments.kdl"),
        Path::new(TESTDATA).join("commented-out.kdl"),
        Path::new(TESTDATA).join("unknown-blocks.kdl"),
        Path::new(TESTDATA).join("multi-file/config.kdl"),
        Path::new(TESTDATA).join("cachyos-style/config.kdl"),
        Path::new(TESTDATA).join("noctalia-style/config.kdl"),
    ]
}

fn round_trip(path: &Path) -> (Vec<(PathBuf, String)>, Vec<PathBuf>, Config) {
    let mut set = parse_config(path).expect("config should load");
    let before = serialize_all(&set).expect("serialize");

    let config = to_config(&set).expect("project into the typed model");
    let changed = apply_config(&mut set, &config).expect("apply the model back");
    let after = serialize_all(&set).expect("serialize");

    assert_eq!(
        before,
        after,
        "{}: load/save with no edit changed the file",
        path.display()
    );
    assert!(
        changed.is_empty(),
        "{}: apply_config reported {} changed files on an untouched config",
        path.display(),
        changed.len()
    );

    (after, changed, config)
}

#[test]
fn every_fixture_round_trips_byte_for_byte() {
    for (label, path) in fixtures() {
        // A fragment has to be parseable on its own, but it is not an entry
        // point: its own `include`s may be relative to the parent. Loading it
        // directly is still required, and is what the fixtures promise.
        let set = parse_config(&path).unwrap_or_else(|e| panic!("{label}: {e}"));
        let text = std::fs::read_to_string(&path).expect("fixture is readable");
        let out = set.main.doc.to_string();
        assert_eq!(out, text, "{label}: re-serialization is not byte-identical");
    }
}

#[test]
fn entry_points_round_trip_through_the_typed_model() {
    for path in entry_points() {
        round_trip(&path);
    }
}

#[test]
fn every_file_of_a_config_set_stays_in_its_own_file() {
    // The flatten that the first resolver did: after a load/save the entry point
    // must still be a file of includes, not a file holding everything.
    let main = Path::new(TESTDATA).join("multi-file/config.kdl");
    let set = parse_config(&main).expect("load");
    assert_eq!(
        set.main.doc.to_string(),
        std::fs::read_to_string(&main).unwrap()
    );
    for file in &set.files {
        if file.path == std::fs::canonicalize(&main).unwrap() {
            continue;
        }
        let text = std::fs::read_to_string(&file.path).expect("included file is readable");
        assert_eq!(
            file.doc.to_string(),
            text,
            "{} was rewritten",
            file.path.display()
        );
    }
}

#[test]
fn multi_file_config_resolves_every_include() {
    let main = Path::new(TESTDATA).join("multi-file/config.kdl");
    let set = parse_config(&main).expect("load");
    assert_eq!(set.files.len(), 5, "main plus four includes");
    assert_eq!(set.includes.edges.len(), 4);

    let names: Vec<String> = set
        .files
        .iter()
        .map(|f| {
            f.path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default()
        })
        .collect();
    for expected in [
        "config.kdl",
        "outputs.kdl",
        "layout.kdl",
        "binds.kdl",
        "rules.kdl",
    ] {
        assert!(
            names.contains(&expected.to_string()),
            "{expected} missing from {names:?}"
        );
    }
}

#[test]
fn includes_resolve_relative_to_the_file_that_contains_them() {
    // `cfg/display.kdl` includes `panel/monitors.kdl`, which is relative to
    // `cfg/`, not to the entry point. Getting this wrong resolves to
    // `cfg/panel/panel/monitors.kdl` and fails to load.
    let main = Path::new(TESTDATA).join("cachyos-style/config.kdl");
    let set = parse_config(&main).expect("load");
    let names: Vec<String> = set
        .files
        .iter()
        .map(|f| f.path.to_string_lossy().replace('\\', "/"))
        .collect();
    assert_eq!(set.files.len(), 9, "main plus eight includes: {names:?}");
    assert!(
        names.iter().any(|n| n.ends_with("cfg/panel/monitors.kdl")),
        "panel/monitors.kdl not resolved: {names:?}"
    );
    assert!(
        names
            .iter()
            .any(|n| n.ends_with("cfg/panel/profiles/laptop.kdl")),
        "four levels deep was not reached: {names:?}"
    );
}

#[test]
fn include_depth_of_the_cachyos_fixture_is_four() {
    let main = Path::new(TESTDATA).join("cachyos-style/config.kdl");
    let set = parse_config(&main).expect("load");
    let deepest = set.files.iter().map(|f| f.depth).max().unwrap_or(0);
    assert_eq!(
        deepest, 3,
        "config.kdl -> display.kdl -> monitors.kdl -> profiles"
    );
    assert!(deepest < MAX_INCLUDE_DEPTH);
}

#[test]
fn optional_include_that_is_missing_is_not_an_error() {
    let main = Path::new(TESTDATA).join("noctalia-style/config.kdl");
    let set = parse_config(&main).expect("optional missing include is fine");
    // `cfg/absent.kdl` is deliberately not in the tree; the testdata README
    // says not to add it.
    assert!(!set
        .paths()
        .iter()
        .any(|p| p.to_string_lossy().ends_with("absent.kdl")));
    assert_eq!(
        set.includes.skipped.len(),
        1,
        "the missing optional include is reported, not silently dropped: {:?}",
        set.includes.skipped
    );
    assert!(set.includes.skipped[0].1.raw_path.ends_with("absent.kdl"));
}

#[test]
fn optional_include_under_an_optional_parent_is_still_followed() {
    // config.kdl -> noctalia.kdl (optional, present) -> cfg/noctalia-bar.kdl.
    let main = Path::new(TESTDATA).join("noctalia-style/config.kdl");
    let set = parse_config(&main).expect("load");
    let names: Vec<String> = set
        .files
        .iter()
        .map(|f| f.path.to_string_lossy().to_string())
        .collect();
    assert!(
        names.iter().any(|n| n.ends_with("noctalia.kdl")),
        "{names:?}"
    );
    assert!(
        names.iter().any(|n| n.ends_with("cfg/noctalia-bar.kdl")),
        "a present optional include must still be followed: {names:?}"
    );
}

#[test]
fn include_tree_records_where_each_edge_came_from() {
    let main = Path::new(TESTDATA).join("multi-file/config.kdl");
    let set = parse_config(&main).expect("load");
    let canonical = std::fs::canonicalize(&main).unwrap();
    for edge in &set.includes.edges {
        assert_eq!(
            edge.from, canonical,
            "every edge starts at the entry point here"
        );
        assert!(
            !edge.directive.optional,
            "this fixture has no optional includes"
        );
    }
    let tree: &IncludeTree = &set.includes;
    assert_eq!(tree.all_files().len(), 5);
}

// --- negative cases, in a temp dir -----------------------------------------

fn temp_config(files: &[(&str, &str)]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("temp dir");
    for (name, body) in files {
        let path = dir.path().join(name);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("create dir");
        }
        std::fs::write(&path, body).expect("write fixture");
    }
    dir
}

#[test]
fn a_missing_mandatory_include_is_an_error_with_a_usable_message() {
    let dir = temp_config(&[("config.kdl", "include \"gone.kdl\"\n")]);
    let err = parse_config(&dir.path().join("config.kdl")).expect_err("must fail");
    let text = err.to_string();
    assert!(text.contains("Include resolution error"), "{text}");
    assert!(
        text.contains("gone.kdl"),
        "message must name the file: {text}"
    );
    assert!(
        text.contains("config.kdl"),
        "message must name the referrer: {text}"
    );
}

#[test]
fn a_file_that_includes_itself_is_a_cycle() {
    let dir = temp_config(&[("config.kdl", "include \"config.kdl\"\n")]);
    let err = parse_config(&dir.path().join("config.kdl")).expect_err("must fail");
    assert!(err.to_string().contains("cycle"), "{err}");
}

#[test]
fn a_two_file_cycle_is_detected() {
    let dir = temp_config(&[
        ("config.kdl", "include \"a.kdl\"\n"),
        ("a.kdl", "include \"b.kdl\"\n"),
        ("b.kdl", "include \"a.kdl\"\n"),
    ]);
    let err = parse_config(&dir.path().join("config.kdl")).expect_err("must fail");
    assert!(err.to_string().contains("cycle"), "{err}");
}

#[test]
fn a_cycle_written_with_dot_dot_is_still_a_cycle() {
    // niri compares the paths as written, so `a/../a` walks straight past its
    // own detector. Ours canonicalizes first.
    let dir = temp_config(&[
        ("config.kdl", "include \"sub/a.kdl\"\n"),
        ("sub/a.kdl", "include \"../sub/a.kdl\"\n"),
    ]);
    let err = parse_config(&dir.path().join("config.kdl")).expect_err("must fail");
    assert!(err.to_string().contains("cycle"), "{err}");
}

#[test]
fn include_depth_beyond_niris_limit_is_an_error() {
    // A chain of MAX_INCLUDE_DEPTH + 1 includes, all distinct files.
    let mut files: Vec<(String, String)> =
        vec![("config.kdl".to_string(), "include \"f0.kdl\"\n".to_string())];
    for i in 0..=MAX_INCLUDE_DEPTH {
        files.push((format!("f{i}.kdl"), format!("include \"f{}.kdl\"\n", i + 1)));
    }
    files.push((
        format!("f{}.kdl", MAX_INCLUDE_DEPTH + 1),
        "layout {\n  gaps 1\n}\n".to_string(),
    ));
    let refs: Vec<(&str, &str)> = files
        .iter()
        .map(|(n, b)| (n.as_str(), b.as_str()))
        .collect();
    let dir = temp_config(&refs);

    let err = parse_config(&dir.path().join("config.kdl")).expect_err("must fail");
    assert!(
        err.to_string().contains("depth"),
        "message must mention the limit: {err}"
    );
}

#[test]
fn a_chain_exactly_at_the_limit_loads() {
    let depth = MAX_INCLUDE_DEPTH;
    let mut files: Vec<(String, String)> =
        vec![("config.kdl".to_string(), "include \"f0.kdl\"\n".to_string())];
    for i in 0..depth - 1 {
        files.push((format!("f{i}.kdl"), format!("include \"f{}.kdl\"\n", i + 1)));
    }
    files.push((
        format!("f{}.kdl", depth - 1),
        "layout {\n  gaps 1\n}\n".to_string(),
    ));
    let refs: Vec<(&str, &str)> = files
        .iter()
        .map(|(n, b)| (n.as_str(), b.as_str()))
        .collect();
    let dir = temp_config(&refs);

    let set = parse_config(&dir.path().join("config.kdl")).expect("a legal chain must load");
    assert_eq!(set.files.len(), depth + 1);
}

// --- projection details -----------------------------------------------------

#[test]
fn unknown_top_level_nodes_are_reported_and_kept() {
    let path = Path::new(TESTDATA).join("unknown-blocks.kdl");
    let set = parse_config(&path).expect("load");
    let (config, report) = to_config_with_report(&set).expect("project");

    assert_eq!(
        config.unknown.len(),
        9,
        "every node niri does not know has to be visible: {:?}",
        config.unknown
    );
    let names: Vec<&str> = config
        .unknown
        .iter()
        .filter_map(|v| v.as_object())
        .filter_map(|o| o.keys().next())
        .map(String::as_str)
        .collect();
    for expected in [
        "my-custom-block",
        "custom-rules",
        "experimental-features",
        "use-niri-graphics",
        "outputs",
        "focus-ring",
        "example.com/plugin",
        "#draft",
        "use-experimental-look",
    ] {
        assert!(
            names.contains(&expected),
            "{expected} missing from {names:?}"
        );
    }
    assert!(
        !report.is_clean(),
        "the report must say something did not fit"
    );
}

#[test]
fn a_hash_prefixed_node_name_is_a_name_not_a_comment() {
    let path = Path::new(TESTDATA).join("unknown-blocks.kdl");
    let set = parse_config(&path).expect("load");
    let draft = set
        .main
        .doc
        .nodes()
        .iter()
        .find(|n| n.name().value() == "#draft")
        .expect("#draft node");
    assert_eq!(
        set.main.doc.to_string(),
        std::fs::read_to_string(&path).unwrap()
    );
    assert!(draft.children().is_some());
}

#[test]
fn comment_outs_survive_the_typed_model() {
    // `/-` has no terminator: the kdl parser folds each disabled node into the
    // leading decor of the next one, which is why it survives `Display`.
    let path = Path::new(TESTDATA).join("commented-out.kdl");
    let (_, _, config) = round_trip(&path);
    assert!(
        config.outputs.is_empty(),
        "a commented-out output is not an output"
    );
    let out = std::fs::read_to_string(&path).unwrap();
    let set = parse_config(&path).expect("load");
    let reloaded = to_config(&set).expect("project");
    assert_eq!(reloaded.outputs.len(), config.outputs.len());

    for marker in [
        "/-output \"DP-2\"",
        "/-spawn-at-startup \"polybar\"",
        "/-prefer-no-csd",
        "/-spawn-at-startup \"wofi\"",
        "/-window-rule {",
    ] {
        assert!(out.contains(marker), "{marker} disappeared");
    }
    assert!(
        out.contains("/-focus-ring {"),
        "commented-out child block gone"
    );
    assert!(
        out.contains("/-Mod+1 { focus-workspace 1; }"),
        "commented-out bind gone"
    );
}

#[test]
fn no_comment_is_lost_or_reformatted() {
    let path = Path::new(TESTDATA).join("with-comments.kdl");
    let before = std::fs::read_to_string(&path).unwrap();
    let (_, _, _) = round_trip(&path);

    let mut set = parse_config(&path).expect("load");
    let config = to_config(&set).expect("project");
    apply_config(&mut set, &config).expect("apply");
    let after = set.main.doc.to_string();
    assert_eq!(before, after);

    for line in before
        .lines()
        .filter(|l| l.contains("//") || l.contains("/*"))
    {
        assert!(after.contains(line), "comment lost: {line:?}");
    }
}

#[test]
fn a_real_config_in_the_project_tree_reparses_100_percent() {
    // Same property on the file that ships with niri: the largest, most
    // comment-heavy config anyone is likely to open.
    let path = Path::new(TESTDATA).join("default.kdl");
    let source = std::fs::read_to_string(&path).expect("readable");
    let set = parse_config(&path).expect("load");
    assert_eq!(set.main.doc.to_string(), source, "not byte-identical");

    let before_nodes = set.main.doc.nodes().len();
    let (config, _) = to_config_with_report(&set).expect("project");
    let mut set = set;
    apply_config(&mut set, &config).expect("apply");
    assert_eq!(set.main.doc.to_string(), source);
    assert_eq!(set.main.doc.nodes().len(), before_nodes);
}

// --- projection specifics ---------------------------------------------------

#[test]
fn an_output_is_read_from_its_argument_and_its_position_properties() {
    let path = Path::new(TESTDATA).join("multi-file/includes/outputs.kdl");
    let set = parse_config(&path).expect("load");
    let config = to_config(&set).expect("project");

    let panel = config
        .outputs
        .iter()
        .find(|o| o.name == "eDP-1")
        .expect("eDP-1");
    assert_eq!(panel.mode.as_deref(), Some("1920x1080@60.000"));
    assert_eq!(panel.scale, Some(1.0));
    assert_eq!(panel.transform.as_deref(), Some("normal"));
    // `position x=0 y=0` is properties, not two arguments.
    let position = panel.position.as_ref().expect("position");
    assert_eq!((position.x, position.y), (0, 0));

    let dp2 = config
        .outputs
        .iter()
        .find(|o| o.name == "DP-2")
        .expect("DP-2");
    assert_eq!(dp2.position.as_ref().map(|p| (p.x, p.y)), Some((1920, 0)));
}

#[test]
fn a_bind_action_is_a_child_node_not_an_argument() {
    let path = Path::new(TESTDATA).join("multi-file/includes/binds.kdl");
    let set = parse_config(&path).expect("load");
    let config = to_config(&set).expect("project");

    let quit = config
        .binds
        .binds
        .iter()
        .find(|b| b.key == "Mod+Q")
        .expect("Mod+Q bind");
    assert_eq!(quit.action, "close-window");
    assert_eq!(quit.allow_when_locked, None);

    let volume = config
        .binds
        .binds
        .iter()
        .find(|b| b.key == "XF86AudioRaiseVolume")
        .expect("volume bind");
    assert_eq!(volume.action, "spawn");
    assert_eq!(volume.allow_when_locked, Some(true));
    assert_eq!(
        volume.args.as_deref(),
        Some(
            ["wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", "0.05+"]
                .map(str::to_string)
                .as_slice()
        )
    );
}

#[test]
fn bind_properties_are_read_from_the_bind_itself() {
    let path = Path::new(TESTDATA).join("cachyos-style/cfg/keybindings.kdl");
    let set = parse_config(&path).expect("load");
    let config = to_config(&set).expect("project");
    let scroll = config
        .binds
        .binds
        .iter()
        .find(|b| b.key == "Mod+WheelScrollDown")
        .expect("scroll bind");
    assert_eq!(scroll.cooldown_ms, Some(150));
    assert_eq!(scroll.action, "focus-workspace-down");
}

#[test]
fn a_window_rule_with_repeated_match_nodes_is_not_half_converted() {
    // `match app-id=...` twice sets one criterion to two values, which a
    // `MatchRules` struct cannot hold. The rule is reported instead of being
    // silently truncated to the first value.
    let path = Path::new(TESTDATA).join("multi-file/includes/rules.kdl");
    let set = parse_config(&path).expect("load");
    let (config, report) = to_config_with_report(&set).expect("project");
    // Three rules: one sets two different criteria across two `match` nodes
    // (converts), one sets the same criterion twice (does not), one has no
    // `match` at all (does not).
    assert_eq!(config.window_rules.len(), 1);
    let demo = &config.window_rules[0];
    assert_eq!(
        demo.match_rules.app_id.as_deref(),
        Some("^org\\.example\\.Demo$")
    );
    assert_eq!(demo.match_rules.title.as_deref(), Some("^Inbox — .*"));
    assert!(!config
        .window_rules
        .iter()
        .any(|r| r.match_rules.app_id.as_deref() == Some("^steam$")));
    assert!(!report.unmapped.is_empty());
    assert!(
        report.unmapped.iter().any(|u| u.reason.contains("shape")),
        "{:?}",
        report.unmapped
    );
}

#[test]
fn a_single_match_node_converts_whole() {
    let path = Path::new(TESTDATA).join("cachyos-style/cfg/rules.kdl");
    let set = parse_config(&path).expect("load");
    let config = to_config(&set).expect("project");
    let demo = config
        .window_rules
        .iter()
        .find(|r| r.match_rules.app_id.as_deref() == Some("^org\\.example\\.Demo$"))
        .expect("demo rule");
    assert_eq!(demo.open_floating, Some(true));
    let block = config
        .window_rules
        .iter()
        .find(|r| r.block_out_from.as_deref() == Some("screen-capture"))
        .expect("block-out rule");
    assert!(block.match_rules.app_id.is_some());
}

#[test]
fn a_raw_string_survives_as_the_regex_the_user_wrote() {
    let path = Path::new(TESTDATA).join("with-comments.kdl");
    let set = parse_config(&path).expect("load");
    let config = to_config(&set).expect("project");
    let rule = config
        .window_rules
        .iter()
        .find(|r| r.match_rules.title.as_deref() == Some("^Inbox — .*"))
        .expect("title rule");
    assert_eq!(
        rule.match_rules.app_id.as_deref(),
        Some("^org\\.example\\.Demo$")
    );
    assert_eq!(rule.open_floating, Some(true));
}

#[test]
fn environment_entries_are_read_as_a_map() {
    let path = Path::new(TESTDATA).join("with-comments.kdl");
    let set = parse_config(&path).expect("load");
    let config = to_config(&set).expect("project");
    assert_eq!(
        config
            .environment
            .get("NIRIFORGE_ALPHA")
            .and_then(|v| v.as_deref()),
        Some("first")
    );
    assert_eq!(
        config
            .environment
            .get("NIRIFORGE_BETA")
            .and_then(|v| v.as_deref()),
        Some("value with spaces")
    );
    assert!(
        !config.environment.contains_key("NIRIFORGE_UNUSED"),
        "a commented-out variable is not set"
    );
}

#[test]
fn a_duplicated_section_is_an_error() {
    // niri rejects a config with two `environment` nodes, and the projection
    // must not silently merge them.
    let dir = temp_config(&[(
        "config.kdl",
        "environment {\n  A \"1\"\n}\nenvironment {\n  B \"2\"\n}\n",
    )]);
    let set = parse_config(&dir.path().join("config.kdl")).expect("parse");
    let err = to_config_with_report(&set).expect_err("duplicate must fail");
    assert!(err.to_string().contains("only once"), "{err}");
}

#[test]
fn a_commented_out_duplicate_does_not_count() {
    // The `/-environment` in `with-comments.kdl` is folded into the leading
    // decor of the next node, so a load must not see two environments.
    let path = Path::new(TESTDATA).join("with-comments.kdl");
    let set = parse_config(&path).expect("load");
    to_config_with_report(&set).expect("a commented-out section is not a duplicate");
}

#[test]
fn changing_a_value_writes_only_the_file_that_owns_it() {
    let main = Path::new(TESTDATA).join("cachyos-style/config.kdl");
    let mut set = parse_config(&main).expect("load");
    let mut config = to_config(&set).expect("project");
    config.layout = config.layout.clone().or(Some(Default::default()));
    config.layout.as_mut().expect("layout").gaps = Some(42);

    let changed = apply_config(&mut set, &config).expect("apply");
    assert_eq!(changed.len(), 1, "one file owns `layout.gaps`");
    assert!(
        changed[0].to_string_lossy().ends_with("cfg/display.kdl"),
        "{} should be the file that was changed",
        changed[0].display()
    );

    let updated = set.file(&changed[0]).expect("changed file").doc.to_string();
    assert!(updated.contains("gaps 42"), "{updated}");
    for file in &set.files {
        if file.path == changed[0] {
            continue;
        }
        assert_eq!(
            file.doc.to_string(),
            std::fs::read_to_string(&file.path).unwrap(),
            "{} must not be touched",
            file.path.display()
        );
    }
}

#[test]
fn the_entry_point_keeps_its_include_directives() {
    let main = Path::new(TESTDATA).join("cachyos-style/config.kdl");
    let set = parse_config(&main).expect("load");
    let entries = niriforge_lib::kdl::include::extract_includes(&set.main.doc).expect("directives");
    assert_eq!(entries.len(), 5);
    assert_eq!(entries[0].path, "cfg/display.kdl");
    assert_eq!(entries[0].optional, None);
}

// --- source map -------------------------------------------------------------

#[test]
fn source_map_points_at_the_original_line_after_an_edit() {
    let main = Path::new(TESTDATA).join("cachyos-style/cfg/display.kdl");
    let source = std::fs::read_to_string(&main).unwrap();
    let mut set = parse_config(&main).expect("load");

    let layout = set
        .main
        .doc
        .nodes()
        .iter()
        .find(|n| n.name().value() == "layout")
        .expect("layout node");
    let id = set.source_map.node_id_for(&set.main.path, layout);
    // Line 1 is the file's own comment, line 2 is blank.
    let before = set.source_map.line_column(&id).expect("location");
    assert_eq!(before, (3, 1));
    assert_eq!(&source[id.offset..id.offset + id.length][..6], "layout");

    // Replace the whole document with something on one line. A source map built
    // from a re-serialization would now report line 1.
    let flattened = niriforge_lib::kdl::parser::parse_kdl("layout {\n}\n", &main)
        .expect("valid KDL")
        .to_string();
    set.source_map.store_document(
        set.main.path.clone(),
        niriforge_lib::kdl::parser::parse_kdl(&flattened, &main).expect("valid KDL"),
        &source,
    );
    assert_eq!(set.source_map.line_column(&id), Some(before));
}

#[test]
fn two_files_with_the_same_offsets_do_not_share_a_location() {
    // `a.kdl` and `b.kdl` both start with `layout` at offset 0, so a span-only
    // lookup would report the wrong file - which in a save path means writing a
    // node into someone else's config.
    let dir = temp_config(&[
        ("config.kdl", "include \"a.kdl\"\ninclude \"b.kdl\"\n"),
        ("a.kdl", "layout {\n  gaps 1\n}\n"),
        ("b.kdl", "binds {\n  Mod+Q { close-window; }\n}\n"),
    ]);
    let set = parse_config(&dir.path().join("config.kdl")).expect("load");

    let a = set
        .files
        .iter()
        .find(|f| f.path.ends_with("a.kdl"))
        .expect("a.kdl");
    let b = set
        .files
        .iter()
        .find(|f| f.path.ends_with("b.kdl"))
        .expect("b.kdl");
    let node_a = a.doc.nodes().first().expect("node a");
    let node_b = b.doc.nodes().first().expect("node b");
    assert_eq!(node_a.span().offset(), node_b.span().offset());

    let view_a = set.source_map.file(&a.path).expect("a is mapped");
    let view_b = set.source_map.file(&b.path).expect("b is mapped");
    assert_eq!(view_a.path(), a.path.as_path());
    assert_eq!(view_b.path(), b.path.as_path());
    assert!(view_a.range(node_a).is_some());
    assert!(
        view_a.range(node_b).is_none(),
        "b.kdl's node is not in a.kdl"
    );
    assert!(view_b.range(node_b).is_some());
    assert!(view_b.range(node_a).is_none());
    assert_eq!(view_b.line_column(node_b), Some((1, 1)));
    assert_eq!(view_a.line_column(node_a), Some((1, 1)));
    assert!(set
        .source_map
        .nodes_from_file(&a.path)
        .iter()
        .all(|o| o.from_include));
}

#[test]
fn every_included_file_is_reachable_for_watching_and_backup() {
    let main = Path::new(TESTDATA).join("cachyos-style/config.kdl");
    let set = parse_config(&main).expect("load");
    let paths = set.paths();
    assert_eq!(paths.len(), 9);
    for path in &paths {
        assert!(path.is_absolute(), "{} should be canonical", path.display());
        assert!(path.exists(), "{} should exist", path.display());
    }
}

// --- a real user config, read-only -----------------------------------------

/// Opt in with `NIRIFORGE_TEST_CONFIG=/path/to/config.kdl`.
///
/// Skipped rather than failed when the variable is unset, so CI stays green on a
/// machine that has no niri config, and so nobody's real config is ever written
/// to: nothing in this test opens a file for writing.
#[test]
fn a_live_user_config_parses_and_reprints_byte_for_byte() {
    let Ok(path) = std::env::var("NIRIFORGE_TEST_CONFIG") else {
        eprintln!("skipping: NIRIFORGE_TEST_CONFIG is not set");
        return;
    };
    let path = PathBuf::from(path);
    if !path.is_file() {
        panic!("NIRIFORGE_TEST_CONFIG points at {}", path.display());
    }

    let set = parse_config(&path).expect("a real config should load");
    for file in &set.files {
        let source = std::fs::read_to_string(&file.path).expect("readable");
        assert_eq!(
            file.doc.to_string(),
            source,
            "{}: not byte-identical",
            file.path.display()
        );
    }

    let (config, report) = to_config_with_report(&set).expect("project");
    let mut set = set;
    let changed = apply_config(&mut set, &config).expect("apply");
    assert!(
        changed.is_empty(),
        "an unedited config must report no changed files, got {changed:?}"
    );
    for file in &set.files {
        let source = std::fs::read_to_string(&file.path).expect("readable");
        assert_eq!(
            file.doc.to_string(),
            source,
            "{} changed",
            file.path.display()
        );
    }
    eprintln!(
        "{}: {} files, {} nodes not represented in the schema",
        path.display(),
        set.files.len(),
        report.unmapped.len()
    );
}
