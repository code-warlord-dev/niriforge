//! KDL parsing, serialization, include resolution, and source-map for niri configs.

pub mod include;
pub mod parser;
pub mod serializer;
pub mod source_map;

use crate::error::{AppError, AppResult};
use crate::schema::Config;

/// Parse a KDL document into a typed Config, resolving includes.
#[allow(dead_code, unused_variables)]
pub async fn parse_config(main_path: &std::path::Path) -> AppResult<Config> {
    Err(AppError::other("Not implemented yet"))
}

/// Serialize a Config back to KDL documents, preserving source-map info.
#[allow(dead_code, unused_variables)]
pub fn serialize_config(config: &Config) -> AppResult<String> {
    Err(AppError::other("Not implemented yet"))
}
