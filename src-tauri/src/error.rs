use std::path::PathBuf;
use thiserror::Error;

#[derive(Error, Debug, serde::Serialize)]
#[serde(tag = "type", content = "details")]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(String),

    #[error("KDL parse error: {0}")]
    KdlParse(String),

    #[error("KDL serialize error: {message}")]
    KdlSerialize { message: String },

    #[error("Schema validation error: {0}")]
    SchemaValidation(String),

    #[error("Niri validate error: {errors:?}")]
    NiriValidate { errors: Vec<ValidationError> },

    #[error("Backup error: {0}")]
    Backup(String),

    #[error("Config not found at: {path:?}")]
    ConfigNotFound { path: PathBuf },

    #[error("Include resolution error: {0}")]
    IncludeResolution(String),

    #[error("Atomic write error: {0}")]
    AtomicWrite(String),

    #[error("Symlink resolution error: {0}")]
    SymlinkResolution(String),

    #[error("File watch error: {0}")]
    FileWatch(String),

    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error("UTF-8 error: {0}")]
    Utf8(String),

    #[error("Tauri error: {0}")]
    Tauri(String),

    #[error("Other: {0}")]
    Other(String),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ValidationError {
    pub file: Option<String>,
    pub line: Option<usize>,
    pub column: Option<usize>,
    pub message: String,
    pub code: Option<String>,
}

impl AppError {
    pub fn kdl_serialize(message: impl Into<String>) -> Self {
        Self::KdlSerialize { message: message.into() }
    }

    pub fn schema_validation(message: impl Into<String>) -> Self {
        Self::SchemaValidation(message.into())
    }

    pub fn niri_validate(errors: Vec<ValidationError>) -> Self {
        Self::NiriValidate { errors }
    }

    pub fn backup(message: impl Into<String>) -> Self {
        Self::Backup(message.into())
    }

    pub fn include_resolution(message: impl Into<String>) -> Self {
        Self::IncludeResolution(message.into())
    }

    pub fn atomic_write(message: impl Into<String>) -> Self {
        Self::AtomicWrite(message.into())
    }

    pub fn symlink_resolution(message: impl Into<String>) -> Self {
        Self::SymlinkResolution(message.into())
    }

    pub fn other(message: impl Into<String>) -> Self {
        Self::Other(message.into())
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(err.to_string())
    }
}

impl From<kdl::KdlError> for AppError {
    fn from(err: kdl::KdlError) -> Self {
        Self::KdlParse(err.to_string())
    }
}

impl From<notify::Error> for AppError {
    fn from(err: notify::Error) -> Self {
        Self::FileWatch(err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        Self::Serialization(err.to_string())
    }
}

impl From<std::string::FromUtf8Error> for AppError {
    fn from(err: std::string::FromUtf8Error) -> Self {
        Self::Utf8(err.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(err: tauri::Error) -> Self {
        Self::Tauri(err.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;