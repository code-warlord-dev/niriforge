use std::fmt;
use std::path::{Path, PathBuf};
use thiserror::Error;

/// Position of a problem inside a KDL source file.
///
/// The `kdl` parser reports failures as a byte offset into the source, but
/// users (and niri's own diagnostics) speak in line/column, and the spec asks
/// for errors to carry a location. Both are kept so nothing has to be
/// recomputed downstream.
#[derive(Error, Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct KdlLocation {
    /// File the position points into.
    pub file: PathBuf,
    /// 1-based line number.
    pub line: usize,
    /// 1-based column, counted in characters so multi-byte text cannot skew it.
    pub column: usize,
    /// Absolute byte offset, as reported by the parser.
    pub offset: usize,
    /// Length of the offending span, in bytes.
    pub length: usize,
}

impl KdlLocation {
    /// Derive a location from a parser span.
    ///
    /// `offset` and `length` are byte offsets into `input`; an offset past the
    /// end of the input is clamped so a malformed span still yields a usable
    /// position rather than a panic on a user-supplied file.
    pub fn from_span(file: &Path, input: &str, offset: usize, length: usize) -> Self {
        let offset = offset.min(input.len());
        let (line, column) = line_column_at(input, offset);
        Self {
            file: file.to_path_buf(),
            line,
            column,
            offset,
            length,
        }
    }
}

impl fmt::Display for KdlLocation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}:{}:{}", self.file.display(), self.line, self.column)
    }
}

/// 1-based line and column of a byte offset within `input`.
///
/// The column is counted in characters rather than bytes: KDL offsets are byte
/// offsets, but a column is what an editor and a human both expect.
pub(crate) fn line_column_at(input: &str, offset: usize) -> (usize, usize) {
    let mut line = 1;
    let mut column = 1;
    for (index, ch) in input.char_indices() {
        if index >= offset {
            break;
        }
        if ch == '\n' {
            line += 1;
            column = 1;
        } else {
            column += 1;
        }
    }
    (line, column)
}

/// Human-readable text for a `kdl` parse failure.
///
/// `kdl::KdlError`'s own `Display` prints just the error kind; the label and
/// help strings carry the actionable part ("wrap it in quotes", "expected
/// closing `}`"), so they are folded in here.
pub fn describe_kdl_error(err: &kdl::KdlError) -> String {
    let mut message = err.to_string();
    if let Some(label) = err.label {
        if !label.is_empty() {
            message.push_str(" (");
            message.push_str(label);
            message.push(')');
        }
    }
    if let Some(help) = err.help {
        if !help.is_empty() {
            message.push_str("; ");
            message.push_str(&help.replace('\n', " "));
        }
    }
    message
}

/// Specific error types for KDL parsing operations.
#[derive(Error, Debug, Clone, serde::Serialize)]
#[serde(tag = "type", content = "details")]
pub enum KdlError {
    #[error("Failed to read KDL file: {path:?} - {details}")]
    Io { path: PathBuf, details: String },

    #[error("KDL parse error at {location}: {message}")]
    Parse {
        location: KdlLocation,
        message: String,
    },

    #[error("UTF-8 error in {path:?}: {message}")]
    Utf8 { path: PathBuf, message: String },

    #[error("Failed to deserialize KDL value: {message}")]
    Deserialize { message: String },
}

impl From<std::io::Error> for KdlError {
    fn from(err: std::io::Error) -> Self {
        // This is a fallback; prefer the Io variant with path
        KdlError::Deserialize {
            message: err.to_string(),
        }
    }
}

impl From<kdl::KdlError> for KdlError {
    fn from(err: kdl::KdlError) -> Self {
        let location =
            KdlLocation::from_span(Path::new(""), &err.input, err.span.offset(), err.span.len());
        KdlError::Parse {
            location,
            message: describe_kdl_error(&err),
        }
    }
}

impl From<KdlError> for AppError {
    fn from(err: KdlError) -> Self {
        match err {
            KdlError::Io { path, details } => AppError::Io(format!("{path:?}: {details}")),
            KdlError::Parse { location, message } => {
                AppError::KdlParse(format!("{location}: {message}"))
            }
            KdlError::Utf8 { path, message } => AppError::Utf8(format!("{path:?}: {message}")),
            KdlError::Deserialize { message } => AppError::Serialization(message),
        }
    }
}

/// What a command returns when it fails.
///
/// The `type` tag is the machine-readable half and the `details` the
/// human-readable one. They are the same string space: the tag is the variant
/// name, which is why the frontend can switch on it and get an exhaustive check,
/// and why no separate `code` field exists to fall out of step with it.
#[derive(Error, Debug, serde::Serialize, schemars::JsonSchema)]
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

/// Specific error types for include resolution.
#[derive(Error, Debug, Clone, serde::Serialize)]
#[serde(tag = "type", content = "details")]
pub enum IncludeError {
    #[error("Include cycle detected: {path:?} -> {cycle:?}")]
    Cycle { path: PathBuf, cycle: Vec<PathBuf> },

    #[error("Include depth exceeded: max depth {max_depth} reached at {path:?}")]
    DepthExceeded { max_depth: usize, path: PathBuf },

    #[error("Included file not found: {path:?} (referenced from {base:?})")]
    NotFound { path: PathBuf, base: PathBuf },

    #[error("Optional include not found: {path:?} (referenced from {base:?})")]
    OptionalNotFound { path: PathBuf, base: PathBuf },

    #[error("Invalid include path: {path:?} - {reason}")]
    InvalidPath { path: PathBuf, reason: String },

    #[error("IO error reading include: {path:?}")]
    Io { path: PathBuf },
}

impl From<IncludeError> for AppError {
    fn from(err: IncludeError) -> Self {
        AppError::IncludeResolution(err.to_string())
    }
}

pub struct ValidationError {
    pub file: Option<String>,
    pub line: Option<usize>,
    pub column: Option<usize>,
    pub message: String,
    pub code: Option<String>,
}

impl ValidationError {
    /// One line naming the place, when it is known, and the message.
    ///
    /// A validation error without a location is still worth printing: "somewhere in
    /// your config" beats silence, and the message is what the user acts on.
    pub fn describe(&self) -> String {
        match (&self.file, self.line, self.column) {
            (Some(file), Some(line), Some(column)) => {
                format!("{file}:{line}:{column}: {}", self.message)
            }
            (Some(file), Some(line), None) => format!("{file}:{line}: {}", self.message),
            (Some(file), None, _) => format!("{file}: {}", self.message),
            (None, Some(line), Some(column)) => {
                format!("line {line}, column {column}: {}", self.message)
            }
            (None, _, _) => self.message.clone(),
        }
    }
}

impl AppError {
    pub fn kdl_serialize(message: impl Into<String>) -> Self {
        Self::KdlSerialize {
            message: message.into(),
        }
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
