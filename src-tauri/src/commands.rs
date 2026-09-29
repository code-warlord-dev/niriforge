use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigDto {
    pub config: crate::schema::Config,
    pub meta: ConfigMeta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigMeta {
    pub main_path: PathBuf,
    pub included_files: Vec<PathBuf>,
    pub niri_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveOptions {
    pub create_backup: bool,
    pub backup_name: Option<String>,
    pub validate: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveResult {
    pub success: bool,
    pub backup_id: Option<String>,
    pub modified_files: Vec<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<ValidationError>,
    pub warnings: Vec<ValidationError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationError {
    pub file: Option<String>,
    pub line: Option<usize>,
    pub column: Option<usize>,
    pub message: String,
    pub code: Option<String>,
}

#[command]
#[allow(unused_variables)]
pub async fn load_config(path: Option<PathBuf>) -> AppResult<ConfigDto> {
    // TODO: Implement config loading with KDL parsing
    Err(AppError::other("Not implemented yet"))
}

#[command]
#[allow(unused_variables)]
pub async fn save_config(config: ConfigDto, options: SaveOptions) -> AppResult<SaveResult> {
    // TODO: Implement config saving with atomic write
    Err(AppError::other("Not implemented yet"))
}

#[command]
#[allow(unused_variables)]
pub async fn validate_config(config: ConfigDto) -> AppResult<ValidationResult> {
    // TODO: Implement validation
    Err(AppError::other("Not implemented yet"))
}

#[command]
pub async fn list_backups() -> AppResult<Vec<BackupMeta>> {
    // TODO: Implement backup listing
    Err(AppError::other("Not implemented yet"))
}

#[command]
#[allow(unused_variables)]
pub async fn restore_backup(id: String) -> AppResult<()> {
    // TODO: Implement backup restore
    Err(AppError::other("Not implemented yet"))
}

#[command]
pub async fn get_config_path() -> AppResult<PathBuf> {
    // TODO: Implement config path resolution
    Err(AppError::other("Not implemented yet"))
}

#[command]
pub async fn check_niri_running() -> AppResult<bool> {
    // TODO: Check if niri is running
    Err(AppError::other("Not implemented yet"))
}

#[command]
#[allow(unused_variables)]
pub async fn niri_msg(args: Vec<String>) -> AppResult<String> {
    // TODO: Execute niri msg
    Err(AppError::other("Not implemented yet"))
}

#[command]
pub async fn get_outputs() -> AppResult<Vec<OutputInfo>> {
    // TODO: Get live outputs from niri
    Err(AppError::other("Not implemented yet"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupMeta {
    pub id: String,
    pub name: Option<String>,
    pub timestamp: String,
    pub files: Vec<PathBuf>,
    pub niri_version: Option<String>,
    pub comment: Option<String>,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputInfo {
    pub name: String,
    pub make: String,
    pub model: String,
    pub serial: String,
    pub modes: Vec<ModeInfo>,
    pub current_mode: Option<String>,
    pub scale: f32,
    pub transform: String,
    pub position: Position,
    pub vrr: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModeInfo {
    pub width: i32,
    pub height: i32,
    pub refresh_rate: f32,
    pub preferred: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub x: i32,
    pub y: i32,
}