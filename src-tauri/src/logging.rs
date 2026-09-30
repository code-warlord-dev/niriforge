//! Logging initialization for NiriForge.
//!
//! This module sets up the `tracing` subscriber with:
//! - Console output via `tracing-subscriber::fmt`
//! - Optional file output via `tracing-appender` (rolling file)
//! - Environment-based filtering via `NIRIFORGE_LOG` / `RUST_LOG`
//! - Compatibility with `log` crate via `tracing-log`

use crate::fs::paths;
use std::sync::OnceLock;
use tracing_appender::non_blocking::NonBlocking;
use tracing_subscriber::{fmt, fmt::writer::MakeWriterExt, EnvFilter};

/// Initialize the logging subscriber.
///
/// This function is called once at application startup from `lib.rs::run()`.
/// It configures:
/// - Console layer with pretty formatting
/// - Optional file layer with daily rotation (if enabled via NIRIFORGE_LOG_FILE)
/// - EnvFilter from `NIRIFORGE_LOG`, `RUST_LOG`, or defaults
/// - `tracing-log` bridge for dependencies using the `log` crate
pub fn init_logging() {
    // Initialize the log -> tracing bridge first, so any early log calls from
    // dependencies are captured.
    let _ = tracing_log::LogTracer::init();

    // Build the EnvFilter from environment variables.
    // Priority: NIRIFORGE_LOG > RUST_LOG > default (warn for release, debug for debug)
    let env_filter = build_env_filter();

    // Check if file logging is enabled
    let file_logging = std::env::var("NIRIFORGE_LOG_FILE").is_ok();

    if file_logging {
        // With file logging: use a Tee writer to write to both stdout and file
        init_with_file(env_filter).expect("failed to initialize logging with file");
    } else {
        // Console only - use set_global_default to handle already-initialized logger gracefully
        let subscriber = fmt::Subscriber::builder()
            .with_env_filter(env_filter)
            .with_target(true)
            .with_thread_ids(false)
            .with_thread_names(false)
            .with_level(true)
            .with_file(false)
            .with_line_number(false)
            .finish();

        // Use set_global_default to handle already-initialized logger gracefully
        if tracing::subscriber::set_global_default(subscriber).is_err() {
            tracing::warn!("Logger already initialized, skipping initialization");
        }
    }

    // Log startup info
    tracing::info!(target: "niriforge::startup", "NiriForge starting up");
    tracing::debug!(target: "niriforge::startup", "Logging initialized");
}

/// Build the EnvFilter from environment variables.
fn build_env_filter() -> EnvFilter {
    // First try RUST_LOG (standard)
    if let Ok(filter) = EnvFilter::try_from_default_env() {
        return filter;
    }

    // Then try NIRIFORGE_LOG
    if let Ok(val) = std::env::var("NIRIFORGE_LOG") {
        if let Ok(filter) = EnvFilter::try_new(val) {
            return filter;
        }
    }

    // Default filter: warn in release, debug in debug builds
    #[cfg(debug_assertions)]
    {
        EnvFilter::new("debug,niriforge=trace")
    }
    #[cfg(not(debug_assertions))]
    {
        EnvFilter::new("warn,niriforge=info")
    }
}

/// Initialize logging with file output.
fn init_with_file(env_filter: EnvFilter) -> Result<(), Box<dyn std::error::Error>> {
    // Get the app data directory for log files
    let log_dir = paths::get_app_data_dir()?.join("logs");
    std::fs::create_dir_all(&log_dir)?;

    // Create a rolling file appender (daily rotation)
    let file_appender = tracing_appender::rolling::daily(&log_dir, "niriforge.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    // Store the guard so it doesn't get dropped
    static GUARD: OnceLock<tracing_appender::non_blocking::WorkerGuard> = OnceLock::new();
    let _ = GUARD.set(guard);

    // Use MakeWriterExt::and to tee output to both stdout and file
    // A closure returning stdout implements MakeWriter
    let stdout_writer = || std::io::stdout();
    let tee = NonBlocking::and(non_blocking, stdout_writer);

    fmt::Subscriber::builder()
        .with_env_filter(env_filter)
        .with_target(true)
        .with_thread_ids(false)
        .with_thread_names(false)
        .with_level(true)
        .with_file(false)
        .with_line_number(false)
        .with_writer(tee)
        .with_ansi(false) // Disable ANSI for file output
        .init();

    Ok(())
}
