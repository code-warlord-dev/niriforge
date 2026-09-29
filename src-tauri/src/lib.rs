// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

pub mod commands;
pub mod error;
pub mod schema;
pub mod kdl;
pub mod niri;
pub mod fs;

use crate::commands::*;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            load_config,
            save_config,
            validate_config,
            list_backups,
            restore_backup,
            get_config_path,
            check_niri_running,
            niri_msg,
            get_outputs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}