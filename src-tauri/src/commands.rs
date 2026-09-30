//! The wire contract between the backend and the frontend.
//!
//! Every type a command takes or returns is declared here, and every one of them
//! is reachable from [`Contract`], which is the root of the JSON Schema the
//! TypeScript types are generated from. A type that is not named there cannot
//! reach the frontend, which is the point: the frontend is written against a
//! generated file, not against a hand-maintained copy of these structs.
//!
//! Two rules hold for every field on the wire, and both are checked by tests in
//! `tests/contract.rs` rather than by convention:
//!
//! - Field names are `kebab-case`, the spelling niri itself uses in the config
//!   file. `schema/mod.rs` has to say that anyway, because the KDL mapper reads
//!   its field names from serde, so a field that arrived in the UI as
//!   `window_rules` could not be matched back to the `window-rules` node it came
//!   from.
//! - A field is optional on the wire if and only if the Rust field is an
//!   `Option` or carries a `serde` default. There is no second opinion.
//!
//! The document that states the same thing for people is `docs/CONTRACT.md`.

use crate::error::{AppError, AppResult, ValidationError};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::command;
use tracing::{debug, info};

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub struct ConfigDto {
    pub config: crate::schema::Config,
    pub meta: ConfigMeta,
}

/// What the backend knows about the config it just read.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub struct ConfigMeta {
    /// The file the load was resolved against.
    pub main_path: PathBuf,
    /// Every file that took part, the main one included, in load order.
    pub included_files: Vec<PathBuf>,
    /// The niri version the config was checked against, if niri answered.
    pub niri_version: Option<String>,
}

/// What the caller wants from a save.
///
/// The defaults are the safe ones: a save takes a backup and refuses to write a
/// config that does not validate, unless the caller says otherwise. An omitted
/// field is a decision, so a caller that cares has to say so.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case", default)]
pub struct SaveOptions {
    /// Take a backup before replacing the files.
    pub create_backup: bool,
    /// Label for that backup.
    pub backup_name: Option<String>,
    /// Refuse to write when validation fails.
    pub validate: bool,
}

impl Default for SaveOptions {
    fn default() -> Self {
        Self {
            create_backup: true,
            backup_name: None,
            validate: true,
        }
    }
}

/// The outcome of a save that returned successfully.
///
/// A save that failed is an `Err`, not a `success: false`: there is no partial
/// outcome to report, and a caller that ignores the error still sees that the
/// file it asked for is not what is on disk.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub struct SaveResult {
    pub success: bool,
    /// The backup that was taken, if one was.
    pub backup_id: Option<String>,
    /// Every file the write touched, empty when the write was a no-op.
    pub modified_files: Vec<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<ValidationError>,
    pub warnings: Vec<ValidationError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub struct BackupMeta {
    pub id: String,
    pub name: Option<String>,
    pub timestamp: String,
    pub files: Vec<PathBuf>,
    pub niri_version: Option<String>,
    pub comment: Option<String>,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub struct OutputInfo {
    pub name: String,
    pub make: String,
    pub model: String,
    pub serial: String,
    pub modes: Vec<ModeInfo>,
    pub current_mode: Option<String>,
    pub scale: f32,
    pub transform: String,
    pub position: crate::schema::Position,
    pub vrr: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub struct ModeInfo {
    pub width: i32,
    pub height: i32,
    pub refresh_rate: f32,
    pub preferred: bool,
}

/// The root of the wire contract.
///
/// It is not a payload of any command. It exists so that one schema names every
/// type the frontend can see, which is what makes "generate the TypeScript from
/// this" a complete statement rather than a partial one.
#[derive(Debug, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub struct Contract {
    pub config: crate::schema::Config,
    pub config_dto: ConfigDto,
    pub config_meta: ConfigMeta,
    pub save_options: SaveOptions,
    pub save_result: SaveResult,
    pub validation_result: ValidationResult,
    pub validation_error: ValidationError,
    pub app_error: AppError,
    pub backup_meta: BackupMeta,
    pub output_info: OutputInfo,
}

/// The JSON Schema the frontend's types are generated from.
pub fn contract_schema() -> schemars::schema::RootSchema {
    schemars::schema_for!(Contract)
}

#[command]
#[allow(unused_variables)]
pub async fn load_config(path: Option<PathBuf>) -> AppResult<ConfigDto> {
    // Resolve config path with XDG priority
    let config_path = match path {
        Some(p) => crate::fs::paths::normalize_path(p)?,
        None => crate::fs::paths::get_niri_config_path()?,
    };

    // Log what we're loading
    info!(target: "niriforge::commands", "Loading niri config from: {}", config_path.display());
    debug!(target: "niriforge::commands", "Resolved config path: {}", config_path.display());

    // Parse config with KDL engine (includes include resolution)
    let kdl_config = crate::kdl::parse_config(&config_path)?;

    // Convert to typed Config
    let config = crate::kdl::to_config(&kdl_config)?;

    // Log what we loaded
    info!(target: "niriforge::commands", "Loaded config: {} outputs, {} binds, {} rules",
        config.outputs.len(),
        config.binds.binds.len(),
        config.window_rules.len() + config.layer_rules.len());

    // Get niri version if available
    let niri_version: Option<String> = None;

    Ok(ConfigDto {
        config,
        meta: ConfigMeta {
            main_path: config_path,
            included_files: kdl_config.includes.files.clone(),
            niri_version,
        },
    })
}

#[command]
#[allow(unused_variables)]
pub async fn save_config(config: ConfigDto, options: SaveOptions) -> AppResult<SaveResult> {
    info!(target: "niriforge::commands", "save_config called with create_backup={}, validate={}", options.create_backup, options.validate);
    // TODO: Implement config saving with atomic write
    Err(AppError::other("Not implemented yet"))
}

#[command]
#[allow(unused_variables)]
pub async fn validate_config(config: ConfigDto) -> AppResult<ValidationResult> {
    info!(target: "niriforge::commands", "validate_config called");
    // TODO: Implement validation
    Err(AppError::other("Not implemented yet"))
}

#[command]
pub async fn list_backups() -> AppResult<Vec<BackupMeta>> {
    info!(target: "niriforge::commands", "list_backups called");
    // TODO: Implement backup listing
    Err(AppError::other("Not implemented yet"))
}

#[command]
pub async fn restore_backup(id: String) -> AppResult<()> {
    info!(target: "niriforge::commands", "restore_backup called with id: {}", id);
    // TODO: Implement backup restore
    Err(AppError::other("Not implemented yet"))
}

#[command]
pub async fn serialize_file() -> AppResult<String> {
    info!(target: "niriforge::commands", "serialize_file called");
    // TODO: Implement serialization of the full config
    Err(AppError::other("Not implemented yet"))
}

#[command]
pub async fn create_backup(name: Option<String>, comment: Option<String>) -> AppResult<BackupMeta> {
    info!(target: "niriforge::commands", "create_backup called with name: {:?}, comment: {:?}", name, comment);
    // TODO: Implement backup creation
    Err(AppError::other("Not implemented yet"))
}

#[command]
pub async fn delete_backup(id: String) -> AppResult<()> {
    info!(target: "niriforge::commands", "delete_backup called with id: {}", id);
    // TODO: Implement backup deletion
    Err(AppError::other("Not implemented yet"))
}

#[command]
pub async fn get_config_path() -> AppResult<PathBuf> {
    info!(target: "niriforge::commands", "get_config_path called");
    // TODO: Implement config path resolution
    Err(AppError::other("Not implemented yet"))
}

#[command]
pub async fn check_niri_running() -> AppResult<bool> {
    info!(target: "niriforge::commands", "check_niri_running called");
    // TODO: Check if niri is running
    Err(AppError::other("Not implemented yet"))
}

#[command]
#[allow(unused_variables)]
pub async fn niri_msg(args: Vec<String>) -> AppResult<String> {
    info!(target: "niriforge::commands", "niri_msg called with args: {:?}", args);
    // TODO: Execute niri msg
    Err(AppError::other("Not implemented yet"))
}

#[command]
pub async fn get_outputs() -> AppResult<Vec<OutputInfo>> {
    info!(target: "niriforge::commands", "get_outputs called");
    // TODO: Get live outputs from niri
    Err(AppError::other("Not implemented yet"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_options_default_to_the_safe_answer() {
        let options: SaveOptions = serde_json::from_str("{}").expect("an empty request is valid");
        assert!(
            options.create_backup,
            "a save takes a backup unless told not to"
        );
        assert!(
            options.validate,
            "a save refuses invalid config unless told not to"
        );
        assert!(options.backup_name.is_none());
    }

    #[test]
    fn save_options_read_the_wire_names() {
        let options: SaveOptions = serde_json::from_str(
            r#"{ "create-backup": false, "backup-name": "before 1.2", "validate": false }"#,
        )
        .expect("kebab-case is the wire spelling");
        assert!(!options.create_backup);
        assert_eq!(options.backup_name.as_deref(), Some("before 1.2"));
        assert!(!options.validate);
    }

    #[test]
    fn config_fields_reach_the_wire_as_niri_spells_them() {
        let json = serde_json::to_value(ConfigDto {
            config: crate::schema::Config::default(),
            meta: ConfigMeta {
                main_path: PathBuf::from("/etc/niri/config.kdl"),
                included_files: vec![],
                niri_version: None,
            },
        })
        .expect("the config serialises");
        let config = &json["config"];
        assert!(config.get("window-rules").is_some(), "{config}");
        assert!(config.get("spawn-at-startup").is_some(), "{config}");
        assert!(config.get("window_rules").is_none(), "{config}");
        assert_eq!(json["meta"]["main-path"], "/etc/niri/config.kdl");
    }

    #[test]
    fn an_error_carries_a_tag_and_something_to_read() {
        let json = serde_json::to_value(AppError::ConfigNotFound {
            path: PathBuf::from("/tmp/config.kdl"),
        })
        .expect("the error serialises");
        assert_eq!(json["type"], "ConfigNotFound");
        assert_eq!(json["details"]["path"], "/tmp/config.kdl");
    }
}
