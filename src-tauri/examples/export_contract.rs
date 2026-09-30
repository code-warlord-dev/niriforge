//! Print the wire contract as JSON Schema.
//!
//! `pnpm gen:types` runs this and feeds the output to `json2ts`, so the
//! TypeScript types the frontend imports are produced by the Rust types the
//! backend actually serialises. There is no second place to update.

fn main() {
    let schema = niriforge_lib::commands::contract_schema();
    println!(
        "{}",
        serde_json::to_string_pretty(&schema).expect("the contract schema is serialisable")
    );
}
