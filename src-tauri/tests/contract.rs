//! The contract cannot drift, and these are the tests that say so.
//!
//! The frontend's types are generated from the Rust structs, so the only way
//! they can fall out of step is if somebody edits the generated file, forgets to
//! regenerate, or registers a command the frontend does not know about. All
//! three are checked here, and all three are cheap to check.

use serde_json::Value;

/// The schema the TypeScript types are generated from, as it is committed.
const COMMITTED_SCHEMA: &str = include_str!("../schema/contract.schema.json");

/// The commands the backend registers.
const HANDLER: &str = include_str!("../src/lib.rs");

/// The commands the frontend is allowed to call.
const FRONTEND_COMMANDS: &str = include_str!("../../src/lib/ipc.ts");

#[test]
fn committed_schema_matches_the_rust_types() {
    let current = format!(
        "{}\n",
        serde_json::to_string_pretty(&niriforge_lib::commands::contract_schema())
            .expect("the contract schema is serialisable")
    );
    assert_eq!(
        COMMITTED_SCHEMA, current,
        "the contract schema is out of date - run `pnpm gen:types` and commit the result"
    );
}

#[test]
fn every_field_on_the_wire_is_kebab_case() {
    let schema: Value = serde_json::from_str(COMMITTED_SCHEMA).expect("the schema is JSON");
    let mut checked = 0usize;
    visit_properties(&schema, &mut checked);
    assert!(
        checked > 100,
        "expected to have walked the whole schema, only saw {checked} fields"
    );
}

/// Every `properties` key anywhere in the schema, checked as it is found.
fn visit_properties(node: &Value, checked: &mut usize) {
    let Some(object) = node.as_object() else {
        return;
    };
    for (key, value) in object {
        if key == "properties" {
            let Some(properties) = value.as_object() else {
                continue;
            };
            for name in properties.keys() {
                *checked += 1;
                assert!(
                    is_kebab_case(name),
                    "`{name}` is not kebab-case, so the frontend would read a field the \
                     backend never sends; give the Rust field \
                     `#[serde(rename_all = \"kebab-case\")]` or rename it"
                );
            }
        }
        visit_properties(value, checked);
    }
}

fn is_kebab_case(name: &str) -> bool {
    if name.is_empty() || name.starts_with('-') || name.ends_with('-') {
        return false;
    }
    name.split('-').all(|word| {
        !word.is_empty()
            && word
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
    })
}

#[test]
fn the_frontend_calls_only_commands_the_backend_registers() {
    let registered = registered_commands();
    let callable = callable_commands();

    let unknown: Vec<&String> = callable
        .iter()
        .filter(|name| !registered.contains(name))
        .collect();
    assert!(
        unknown.is_empty(),
        "the frontend can call {unknown:?}, which `generate_handler!` does not register; \
         a call to one of those fails at runtime with \"command not found\""
    );

    let uncalled: Vec<&String> = registered
        .iter()
        .filter(|name| !callable.contains(name))
        .collect();
    assert!(
        uncalled.is_empty(),
        "the backend registers {uncalled:?}, which nothing in the frontend calls; \
         either call it or stop promising it"
    );
}

fn registered_commands() -> Vec<String> {
    let body = HANDLER
        .split_once("generate_handler![")
        .expect("lib.rs registers its commands with generate_handler!")
        .1
        .split_once(']')
        .expect("generate_handler! is closed")
        .0;
    body.split(',')
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .collect()
}

fn callable_commands() -> Vec<String> {
    let body = FRONTEND_COMMANDS
        .split_once("COMMANDS = [")
        .expect("ipc.ts lists the commands the frontend may call")
        .1
        .split_once(']')
        .expect("the command list is closed")
        .0;
    body.split(',')
        .map(|entry| {
            entry
                .trim()
                .trim_start_matches('"')
                .trim_end_matches('"')
                .to_string()
        })
        .filter(|name| !name.is_empty())
        .collect()
}
