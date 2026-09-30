//! Niri config validation via `niri validate`.
//!
//! # Facts this module is built on
//!
//! Established against a live niri, not derived from the source:
//!
//! - the binary is `niri validate -c <path>`; `NIRI_CONFIG` is the environment
//!   equivalent, and the argument wins over it;
//! - on success nothing is printed to stdout - a log line goes to *stderr* - so
//!   the **exit code is the signal** and there is no output to parse;
//! - on failure the exit code is 1 and a `miette` diagnostic goes to stderr,
//!   carrying the file, line and column of the offending span.
//!
//! # Missing binary
//!
//! niri is a runtime dependency, not a build dependency: the app has to be
//! installable and usable on a machine where the compositor is not running, and
//! editing a config for another machine is a normal thing to do. A missing
//! binary is therefore [`ValidationOutcome::Skipped`], and it is deliberately
//! *not* [`ValidationOutcome::Valid`] - reporting "checked and fine" for a check
//! that never ran is the one answer a safety gate must never give. Whether a
//! skipped check blocks the save is the caller's decision, and the save path
//! surfaces the outcome either way.
//!
//! # Unparsable diagnostics
//!
//! The text is meant for a person and can change between niri versions. A line
//! that cannot be read becomes a [`ValidationError`] with no location and the raw
//! text as the message. It is never dropped, and a failure is never downgraded to
//! a warning: the user still gets "niri rejected this config" with whatever the
//! compositor said about it.

use crate::error::{AppError, AppResult, ValidationError};
use std::path::Path;
use std::process::Stdio;
use tokio::process::Command;

/// The binary name looked up on `PATH`.
pub const NIRI_BINARY: &str = "niri";

/// What a validation attempt established.
///
/// Three states rather than a bool, because "the check did not run" and "the
/// check passed" lead to different decisions and the caller has to be able to
/// tell them apart.
#[derive(Debug, Clone, PartialEq)]
pub enum ValidationOutcome {
    /// niri accepted the file.
    Valid,
    /// niri rejected it. The errors carry whatever location could be read.
    Invalid(Vec<ValidationError>),
    /// niri could not be run, so nothing was checked. Never reported as success.
    Skipped(SkipReason),
}

/// Why the check did not happen.
#[derive(Debug, Clone, PartialEq)]
pub enum SkipReason {
    /// The binary is not installed, or not on `PATH`.
    BinaryMissing { binary: String },
    /// The binary exists but could not be started at all.
    NotExecutable { binary: String, details: String },
}

impl SkipReason {
    /// A sentence for the user, naming the reason rather than implying success.
    pub fn user_message(&self) -> String {
        match self {
            SkipReason::BinaryMissing { binary } => format!(
                "config was not checked: `{binary}` is not installed, so niri could not \
                 confirm it is valid. It has been written, but nothing has verified it."
            ),
            SkipReason::NotExecutable { binary, details } => format!(
                "config was not checked: `{binary}` could not be run ({details}). \
                 It has been written, but nothing has verified it."
            ),
        }
    }
}

impl ValidationOutcome {
    /// True only when niri actually accepted the file.
    pub fn is_valid(&self) -> bool {
        matches!(self, ValidationOutcome::Valid)
    }

    /// True when the file was rejected, with the errors that were read.
    pub fn errors(&self) -> &[ValidationError] {
        match self {
            ValidationOutcome::Invalid(errors) => errors,
            _ => &[],
        }
    }

    /// The user-facing sentence for a non-valid outcome.
    pub fn user_message(&self) -> Option<String> {
        match self {
            ValidationOutcome::Valid => None,
            ValidationOutcome::Invalid(errors) => Some(format!(
                "niri rejected the config ({} problem{}): {}",
                errors.len(),
                if errors.len() == 1 { "" } else { "s" },
                errors
                    .iter()
                    .map(ValidationError::describe)
                    .collect::<Vec<_>>()
                    .join("; ")
            )),
            ValidationOutcome::Skipped(reason) => Some(reason.user_message()),
        }
    }

    /// Turn a non-valid outcome into the error the save path returns.
    pub fn into_result(self) -> AppResult<ValidationOutcome> {
        match self {
            ValidationOutcome::Valid => Ok(ValidationOutcome::Valid),
            ValidationOutcome::Invalid(errors) => Err(AppError::niri_validate(errors)),
            ValidationOutcome::Skipped(reason) => Ok(ValidationOutcome::Skipped(reason)),
        }
    }
}

/// Validate a config file using `niri validate -c <path>`.
///
/// The path is passed as given, so niri resolves `include` directives against
/// the file's own directory. That matters: validating a copy in a temp directory
/// would not see the user's includes, and a config that is only broken through an
/// include would be reported as fine.
pub async fn validate_with_niri(config_path: &Path) -> AppResult<ValidationOutcome> {
    run_niri_validate(NIRI_BINARY, config_path, config_path).await
}

/// Validate a config that has no file of its own yet, by writing it beside the
/// file it will replace.
///
/// The candidate is placed in the *real* directory for the reason above: niri has
/// to resolve the includes that the saved config will use. The candidate is
/// removed on every path, including the failing ones - a leftover candidate in
/// the config directory is debris the user would have to recognise and remove.
pub async fn validate_config_content(
    dir: &Path,
    file_name: &str,
    config_content: &str,
) -> AppResult<ValidationOutcome> {
    let target = dir.join(file_name);
    let candidate = crate::fs::atomic::stage_candidate(&target, config_content.as_bytes())?;
    let outcome = run_niri_validate(NIRI_BINARY, &candidate, &target).await;
    let _ = crate::fs::atomic::remove_staged(&candidate);
    outcome
}

/// Validate a staged candidate on behalf of the save path.
///
/// Exposed so the transaction can name its binary and so the tests can point at a
/// stub; it is the same code the public [`validate_with_niri`] runs.
pub async fn validate_candidate_with(
    binary: &str,
    candidate: &Path,
    display_path: &Path,
) -> AppResult<ValidationOutcome> {
    run_niri_validate(binary, candidate, display_path).await
}

/// Run `niri validate -c <candidate>` and interpret the result.
///
/// `display_path` is the file the candidate stands in for. niri reports the
/// candidate's own name in its diagnostics, so the name is rewritten to the real
/// file before the errors reach the user - a diagnostic pointing at a
/// `.niriforge-candidate` file is a diagnostic the user cannot act on.
async fn run_niri_validate(
    binary: &str,
    candidate: &Path,
    display_path: &Path,
) -> AppResult<ValidationOutcome> {
    let output = Command::new(binary)
        .arg("validate")
        .arg("-c")
        .arg(candidate)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .output()
        .await;

    let output = match output {
        Ok(output) => output,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ValidationOutcome::Skipped(SkipReason::BinaryMissing {
                binary: binary.to_string(),
            }));
        }
        Err(err) => {
            return Ok(ValidationOutcome::Skipped(SkipReason::NotExecutable {
                binary: binary.to_string(),
                details: err.to_string(),
            }));
        }
    };

    if output.status.success() {
        return Ok(ValidationOutcome::Valid);
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut errors = parse_niri_validate_output(&stderr);
    if errors.is_empty() {
        // niri failed and said nothing we could read. That is still a refusal,
        // and it must not become a pass: report the exit status so the user is
        // told the check happened and failed.
        errors.push(ValidationError {
            file: Some(display_path.display().to_string()),
            line: None,
            column: None,
            message: format!(
                "niri validate exited with {} without a diagnostic we could read",
                exit_description(&output.status)
            ),
            code: None,
        });
    }
    for error in &mut errors {
        rewrite_candidate_name(error, candidate, display_path);
    }
    Ok(ValidationOutcome::Invalid(errors))
}

fn exit_description(status: &std::process::ExitStatus) -> String {
    match status.code() {
        Some(code) => format!("status {code}"),
        None => "a signal".to_string(),
    }
}

/// Parse `niri validate` output into structured errors.
///
/// The layout niri emits is a `miette` grapheme report: an `Error:` line carries
/// the message, and a `╭─[file:line:column]` header carries the span. Every
/// `Error:` block becomes one error. A block whose location cannot be read is
/// still an error, with the location fields left empty - a missing coordinate is
/// a fact about the report, not a reason to discard the report.
fn parse_niri_validate_output(output: &str) -> Vec<ValidationError> {
    let mut errors = Vec::new();
    let mut message_lines: Vec<String> = Vec::new();
    let mut location: Option<(String, Option<usize>, Option<usize>)> = None;

    let flush = |message_lines: &mut Vec<String>, location: &mut Option<_>, out: &mut Vec<_>| {
        if message_lines.is_empty() && location.is_none() {
            return;
        }
        let message = if message_lines.is_empty() {
            "niri reported a problem without a message".to_string()
        } else {
            message_lines.join(" ")
        };
        let (file, line, column) = match location.take() {
            Some((file, line, column)) => (Some(file), line, column),
            None => (None, None, None),
        };
        out.push(ValidationError {
            file,
            line,
            column,
            message,
            code: None,
        });
        message_lines.clear();
    };

    for raw in output.lines() {
        let line = strip_ansi(raw);
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Some((file, line_no, column_no)) = parse_location_header(trimmed) {
            // The header belongs to the message that was just collected: niri
            // prints the message first and the position underneath it. A second
            // header with no message between the two means two diagnostics, so the
            // first is emitted before the second takes over.
            if location.is_some() {
                flush(&mut message_lines, &mut location, &mut errors);
            }
            location = Some((file, line_no, column_no));
            continue;
        }

        // A new `Error:` starts a new diagnostic; what came before it was the
        // miette cause chain (`├─▶ error parsing`, `╰─▶ error parsing KDL`),
        // which folds into the message rather than becoming errors of its own.
        if let Some(rest) = trimmed.strip_prefix("Error:") {
            flush(&mut message_lines, &mut location, &mut errors);
            push_message(&mut message_lines, rest);
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix('│') {
            // A wrapped continuation of the message being collected.
            push_continuation(&mut message_lines, rest);
            continue;
        }
        if trimmed.starts_with('├') || trimmed.starts_with('╰') {
            // Part of the miette cause chain, which is context for the message
            // rather than a diagnostic of its own.
            let rest = trimmed.trim_start_matches(['├', '╰', '─', '▶']);
            if !rest.trim().is_empty() {
                push_message(&mut message_lines, rest);
            }
            continue;
        }
        // Anything else - the `·` pointer lines, the `╭─[`, the source excerpt -
        // carries no message text. The location header is handled above; a
        // diagnostic that has no header at all keeps its raw lines so the user
        // sees what niri printed.
        if !trimmed.starts_with('╭') && !trimmed.starts_with('╰') {
            push_message(&mut message_lines, trimmed);
        }
    }
    flush(&mut message_lines, &mut location, &mut errors);
    errors
}

/// Add the continuation of a wrapped message.
///
/// The wrap is a rendering artefact, so the two halves are joined without a
/// separator: a message broken in the middle of a path has to come back as one
/// path, and a message broken at a space has to come back with the space it had.
/// Which of the two it was cannot be told from the text, so the safe reading is
/// the one that does not invent a character - the alternative would corrupt every
/// path niri reports.
fn push_continuation(lines: &mut Vec<String>, text: &str) {
    let fragment = text.trim();
    if fragment.is_empty() {
        return;
    }
    match lines.last_mut() {
        Some(last) => last.push_str(fragment),
        None => lines.push(fragment.to_string()),
    }
}

/// Add a fragment to the message, skipping a repeat of what is already there.
fn push_message(lines: &mut Vec<String>, text: &str) {
    let fragment = text
        .trim_start_matches(['×', '·', ' '])
        .trim()
        .trim_end_matches(['·', ' '])
        .trim();
    if fragment.is_empty() {
        return;
    }
    if lines.last().is_some_and(|last| last == fragment) {
        return;
    }
    lines.push(fragment.to_string());
}

/// Read a `╭─[file:line:column]` header.
///
/// The file may itself contain colons, so the split is from the right and takes
/// the last two fields as the position. A header with a file but no position is
/// still usable and is kept.
fn parse_location_header(trimmed: &str) -> Option<(String, Option<usize>, Option<usize>)> {
    let start = trimmed.find('[')?;
    if !trimmed[..start].contains('╭') {
        return None;
    }
    let end = trimmed.rfind(']')?;
    if end <= start {
        return None;
    }
    let inside = &trimmed[start + 1..end];
    let fields: Vec<&str> = inside.split(':').collect();
    // Only the trailing numeric fields are the position, so the file - which may
    // itself contain colons - is whatever is left. A path segment that happens to
    // be all digits is the one case this gets wrong, and it costs a location
    // rather than a diagnostic.
    let numeric_from_end = fields
        .iter()
        .rev()
        .take(2)
        .take_while(|field| field.trim().parse::<usize>().is_ok())
        .count();
    if numeric_from_end == 0 {
        return Some((inside.to_string(), None, None));
    }
    let split_at = fields.len() - numeric_from_end;
    let file = fields[..split_at].join(":");
    let line = fields.get(split_at).and_then(|f| f.trim().parse().ok());
    let column = fields.get(split_at + 1).and_then(|f| f.trim().parse().ok());
    Some((file, line, column))
}

/// Drop the escape sequences a coloured log line carries.
///
/// niri's log output is colourised even when it is not a terminal in some
/// builds, and a stray `ESC[34m` in the middle of a path makes the path unusable
/// for a click-through in the validation panel.
fn strip_ansi(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut chars = line.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '\u{1b}' {
            out.push(ch);
            continue;
        }
        if chars.peek() == Some(&'[') {
            chars.next();
            for next in chars.by_ref() {
                if next.is_ascii_alphabetic() {
                    break;
                }
            }
        }
    }
    out
}

/// Point a diagnostic back at the real file instead of the candidate.
fn rewrite_candidate_name(error: &mut ValidationError, candidate: &Path, display_path: &Path) {
    let candidate_name = match candidate.file_name().and_then(|n| n.to_str()) {
        Some(name) => name,
        None => return,
    };
    if let Some(file) = &mut error.file {
        if file.contains(candidate_name) {
            *file = file.replace(candidate_name, &display_path.display().to_string());
        }
    }
}

/// The version string of the running niri, if it can be asked.
///
/// Recorded in backup metadata so a restored config can be compared against the
/// compositor it was written for.
pub async fn niri_version(binary: &str) -> Option<String> {
    let output = Command::new(binary)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let line = strip_ansi(&text).trim().to_string();
    if line.is_empty() {
        None
    } else {
        Some(line)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::TempDir;

    /// Set mode on a freshly written file in the same step, so there is no window
    /// in which it is a writable executable the kernel would refuse to exec
    /// ("text file busy").
    ///
    /// The stubs let the tests exercise the real process invocation - argument
    /// shape, exit code, stderr parsing - without depending on niri being
    /// installed on the machine running them.
    fn write_executable(path: &Path, script: &str) {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o755)
            .open(path)
            .expect("stub should be created");
        file.write_all(script.as_bytes())
            .expect("stub should be written");
        file.sync_all().expect("stub should be flushed");
    }

    fn stub_niri(dir: &Path, name: &str, script: &str) -> PathBuf {
        let path = dir.join(name);
        write_executable(&path, script);
        path
    }

    fn accepting() -> &'static str {
        "#!/bin/sh\nprintf 'DEBUG niri_config: loaded config\\n' >&2\nexit 0\n"
    }

    /// A stub reproducing the shape of a real niri 26.04 failure, including the
    /// wrapped message, the cause chain and the location header.
    ///
    /// The diagnostic is written by the script rather than embedded, so the bytes
    /// the parser sees are the bytes a user would see.
    fn rejecting_script() -> String {
        let diagnostic = concat!(
            "Error:   \u{d7} error loading config\n",
            "  \u{251c}\u{2500}\u{25b6} error parsing\n",
            "  \u{2570}\u{2500}\u{25b6} error parsing KDL\n",
            "\n",
            "Error:   \u{d7} unexpected node `frobnicate`\n",
            "   \u{256d}\u{2500}[frobnicate.kdl:1:1]\n",
            " 1 \u{2502} frobnicate 1\n",
            "   \u{b7} \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{252c}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\n",
            "   \u{b7}       \u{2570}\u{2500}\u{2500} unexpected node\n",
            "   \u{2570}\u{2500}\u{2500}\u{2500}\u{2500}\n",
        );
        format!("#!/bin/sh\ncat >&2 <<'DIAG'\n{diagnostic}DIAG\nexit 1\n")
    }

    #[tokio::test]
    async fn a_stub_that_accepts_yields_valid() {
        let dir = TempDir::new().expect("temp dir");
        let binary = stub_niri(dir.path(), "niri-ok", accepting());
        let config = dir.path().join("config.kdl");
        std::fs::write(&config, "binds { Mod+Q { close-window; } }\n").expect("write");

        let outcome = run_niri_validate(binary.to_str().expect("utf8"), &config, &config)
            .await
            .expect("the run should complete");

        assert_eq!(outcome, ValidationOutcome::Valid, "got {outcome:?}");
        assert!(outcome.is_valid());
        assert_eq!(outcome.user_message(), None);
    }

    #[tokio::test]
    async fn a_stub_that_rejects_yields_the_message_and_the_location() {
        let dir = TempDir::new().expect("temp dir");
        let binary = stub_niri(dir.path(), "niri-bad", &rejecting_script());
        let config = dir.path().join("config.kdl");
        std::fs::write(&config, "frobnicate 1\n").expect("write");

        let outcome = run_niri_validate(binary.to_str().expect("utf8"), &config, &config)
            .await
            .expect("the run should complete");

        let errors = match &outcome {
            ValidationOutcome::Invalid(errors) => errors,
            other => panic!("expected a rejection, got {other:?}"),
        };
        let problem = errors
            .iter()
            .find(|e| e.message.contains("unexpected node"))
            .unwrap_or_else(|| panic!("the real diagnostic is missing from {errors:?}"));
        assert_eq!(problem.file.as_deref(), Some("frobnicate.kdl"));
        assert_eq!(problem.line, Some(1));
        assert_eq!(problem.column, Some(1));
        assert!(!outcome.is_valid());
        assert!(outcome
            .user_message()
            .is_some_and(|m| m.contains("niri rejected")));
    }

    #[tokio::test]
    async fn a_failure_with_no_readable_diagnostic_is_still_a_failure() {
        // The one thing this must never do is report success.
        let dir = TempDir::new().expect("temp dir");
        let binary = stub_niri(dir.path(), "niri-silent", "#!/bin/sh\nexit 1\n");
        let config = dir.path().join("config.kdl");
        std::fs::write(&config, "x\n").expect("write");

        let outcome = run_niri_validate(binary.to_str().expect("utf8"), &config, &config)
            .await
            .expect("the run should complete");

        match &outcome {
            ValidationOutcome::Invalid(errors) => {
                assert_eq!(errors.len(), 1);
                assert!(
                    errors[0].message.contains("exited with status 1"),
                    "the exit status has to reach the user: {:?}",
                    errors[0]
                );
            }
            other => panic!("an unreadable refusal must not become {other:?}"),
        }
    }

    #[tokio::test]
    async fn a_missing_binary_is_skipped_and_never_reported_as_valid() {
        let dir = TempDir::new().expect("temp dir");
        let config = dir.path().join("config.kdl");
        std::fs::write(&config, "x\n").expect("write");
        let missing = dir.path().join("definitely-not-installed");

        let outcome = run_niri_validate(missing.to_str().expect("utf8"), &config, &config)
            .await
            .expect("a missing binary is a defined state, not an error");

        assert!(
            matches!(
                outcome,
                ValidationOutcome::Skipped(SkipReason::BinaryMissing { .. })
            ),
            "got {outcome:?}"
        );
        assert!(!outcome.is_valid(), "skipped must never read as valid");
        let message = outcome.user_message().expect("skipped needs a message");
        assert!(message.contains("not installed"), "{message}");
        assert!(
            message.contains("nothing has verified"),
            "the message has to say the check did not run: {message}"
        );
        assert!(
            !message.contains("config is valid"),
            "the message must never read as a pass: {message}"
        );
    }

    #[tokio::test]
    async fn a_binary_that_is_not_executable_is_skipped() {
        let dir = TempDir::new().expect("temp dir");
        let not_exec = dir.path().join("niri");
        std::fs::write(&not_exec, "#!/bin/sh\nexit 0\n").expect("write");
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&not_exec, std::fs::Permissions::from_mode(0o600))
            .expect("chmod should work");

        let outcome = run_niri_validate(not_exec.to_str().expect("utf8"), &not_exec, &not_exec)
            .await
            .expect("the outcome must be defined");

        assert!(
            matches!(outcome, ValidationOutcome::Skipped(_)),
            "got {outcome:?}"
        );
    }

    #[tokio::test]
    async fn the_candidate_name_in_a_diagnostic_is_rewritten_to_the_real_file() {
        let dir = TempDir::new().expect("temp dir");
        let target = dir.path().join("config.kdl");
        std::fs::write(&target, "old\n").expect("write");
        let candidate = crate::fs::atomic::stage_candidate(&target, b"frobnicate 1\n")
            .expect("staging should succeed");
        // The diagnostic is emitted through a heredoc rather than `printf`, because
        // the box-drawing characters are not `\u` escapes the shell printf knows.
        let script = format!(
            "#!/bin/sh\ncat >&2 <<'DIAG'\nError:   \u{d7} broken\n   \u{256d}\u{2500}[{}:2:3]\nDIAG\nexit 1\n",
            candidate.display()
        );
        let binary = stub_niri(dir.path(), "niri-cand", &script);

        let outcome = run_niri_validate(binary.to_str().expect("utf8"), &candidate, &target)
            .await
            .expect("the run should complete");

        let errors = match &outcome {
            ValidationOutcome::Invalid(errors) => errors,
            other => panic!("expected a rejection, got {other:?}"),
        };
        let file = errors[0].file.as_deref().expect("a file should be named");
        assert!(
            !file.contains("niriforge-candidate"),
            "the user must not be pointed at a staged file: {file}"
        );
        assert!(file.ends_with("config.kdl"), "got {file}");
    }

    #[tokio::test]
    async fn validating_content_stages_beside_the_target_and_cleans_up() {
        let dir = TempDir::new().expect("temp dir");
        let binary = stub_niri(dir.path(), "niri-ok", accepting());
        let target = dir.path().join("config.kdl");
        std::fs::write(&target, "old\n").expect("write");

        let outcome = validate_config_content_with(
            binary.to_str().expect("utf8"),
            dir.path(),
            "config.kdl",
            "new\n",
        )
        .await
        .expect("the run should complete");

        assert!(outcome.is_valid());
        assert_eq!(
            std::fs::read_to_string(&target).expect("read"),
            "old\n",
            "validation must not replace the real file"
        );
        let mut left: Vec<String> = std::fs::read_dir(dir.path())
            .expect("read_dir")
            .map(|e| e.expect("entry").file_name().display().to_string())
            .collect();
        left.sort();
        let mut expected = vec![
            "config.kdl".to_string(),
            binary.file_name().expect("name").display().to_string(),
        ];
        expected.sort();
        assert_eq!(left, expected, "the staged candidate must be gone");
    }

    #[tokio::test]
    async fn a_rejected_candidate_is_removed_too() {
        let dir = TempDir::new().expect("temp dir");
        let binary = stub_niri(dir.path(), "niri-bad", &rejecting_script());
        let target = dir.path().join("config.kdl");
        std::fs::write(&target, "old\n").expect("write");

        let outcome = validate_config_content_with(
            binary.to_str().expect("utf8"),
            dir.path(),
            "config.kdl",
            "new\n",
        )
        .await
        .expect("the run should complete");

        assert!(!outcome.is_valid());
        let mut left: Vec<String> = std::fs::read_dir(dir.path())
            .expect("read_dir")
            .map(|e| e.expect("entry").file_name().display().to_string())
            .filter(|n| !n.starts_with("niri-"))
            .collect();
        left.sort();
        assert_eq!(left, vec!["config.kdl".to_string()]);
    }

    /// niri wraps a long message across lines with a `│` gutter, and the wrap can
    /// land in the middle of a path. Reassembling the fragments is what keeps the
    /// quoted filename intact, which is the part the user has to act on.
    #[test]
    fn a_wrapped_message_is_reassembled_into_one_line() {
        // The exact wrap niri 26.04 produces for a missing include.
        let output = concat!(
            "Error:   \u{d7} failed to read included config from \"/srv/niri/includes/\n",
            "  \u{2502} outputs.kdl\": No such file or directory (os error 2)\n",
            "   \u{256d}\u{2500}[config.kdl:6:1]\n",
        );

        let errors = parse_niri_validate_output(output);

        assert_eq!(errors.len(), 1, "got {errors:?}");
        assert!(
            errors[0].message.contains("/srv/niri/includes/outputs.kdl"),
            "the wrap must not break the path: {:?}",
            errors[0]
        );
        assert_eq!(errors[0].file.as_deref(), Some("config.kdl"));
        assert_eq!(errors[0].line, Some(6));
        assert_eq!(errors[0].column, Some(1));
    }

    /// A wrap that splits a word is rejoined without a space, because the break
    /// was a wrap and not a word boundary.
    #[test]
    fn a_wrap_inside_a_word_is_joined_without_inserting_a_space() {
        let output = concat!(
            "Error:   \u{d7} failed to read included config from \"/srv/niri/incl\n",
            "  \u{2502} udes/outputs.kdl\": No such file\n",
            "   \u{256d}\u{2500}[config.kdl:6:1]\n",
        );

        let errors = parse_niri_validate_output(output);

        assert!(
            errors[0].message.contains("/srv/niri/includes/outputs.kdl"),
            "got {:?}",
            errors[0]
        );
    }

    #[test]
    fn a_location_header_with_colons_in_the_path_is_split_from_the_right() {
        let errors = parse_niri_validate_output(
            "Error:   \u{d7} broken\n   \u{256d}\u{2500}[/home/a:b/c.kdl:12:34]\n",
        );

        assert_eq!(errors.len(), 1, "got {errors:?}");
        assert_eq!(errors[0].file.as_deref(), Some("/home/a:b/c.kdl"));
        assert_eq!(errors[0].line, Some(12));
        assert_eq!(errors[0].column, Some(34));
    }

    #[test]
    fn a_diagnostic_with_no_location_keeps_its_message() {
        let errors = parse_niri_validate_output("Error:   \u{d7} the include graph has a cycle\n");

        assert_eq!(errors.len(), 1, "got {errors:?}");
        assert_eq!(errors[0].file, None);
        assert_eq!(errors[0].line, None);
        assert!(errors[0].message.contains("cycle"));
    }

    #[test]
    fn colour_codes_do_not_leak_into_a_message_or_a_path() {
        let output = "\u{1b}[2m2026-09-30T00:00:00Z\u{1b}[0m \u{1b}[31mERROR\u{1b}[0m: \u{d7} bad \u{1b}[1mthing\u{1b}[0m\n   \u{256d}\u{2500}[/srv/niri/c.kdl:1:1]\n";

        let errors = parse_niri_validate_output(output);

        assert_eq!(errors.len(), 1, "got {errors:?}");
        assert!(!errors[0].message.contains('\u{1b}'), "{:?}", errors[0]);
        assert_eq!(errors[0].file.as_deref(), Some("/srv/niri/c.kdl"));
    }

    #[test]
    fn several_diagnostics_in_one_run_become_several_errors() {
        let output = concat!(
            "Error:   \u{d7} first problem\n",
            "   \u{256d}\u{2500}[a.kdl:1:1]\n",
            "Error:   \u{d7} second problem\n",
            "   \u{256d}\u{2500}[b.kdl:2:2]\n",
        );

        let errors = parse_niri_validate_output(output);

        assert_eq!(errors.len(), 2, "got {errors:?}");
        assert_eq!(errors[0].file.as_deref(), Some("a.kdl"));
        assert_eq!(errors[1].file.as_deref(), Some("b.kdl"));
        assert_eq!(errors[1].line, Some(2));
    }

    #[test]
    fn empty_output_yields_no_errors_so_the_caller_can_report_the_exit_code() {
        assert!(parse_niri_validate_output("").is_empty());
        assert!(parse_niri_validate_output("   \n\n").is_empty());
    }

    #[test]
    fn a_skipped_outcome_converts_to_ok_and_an_invalid_one_to_an_error() {
        let skipped = ValidationOutcome::Skipped(SkipReason::BinaryMissing {
            binary: "niri".to_string(),
        });
        assert!(skipped.clone().into_result().is_ok());

        let invalid = ValidationOutcome::Invalid(vec![ValidationError {
            file: None,
            line: None,
            column: None,
            message: "broken".to_string(),
            code: None,
        }]);
        let err = invalid
            .into_result()
            .expect_err("a refusal must not be an ok");
        assert!(matches!(err, AppError::NiriValidate { .. }), "got {err:?}");
    }

    #[tokio::test]
    async fn the_version_is_read_when_the_binary_answers() {
        let dir = TempDir::new().expect("temp dir");
        let binary = stub_niri(
            dir.path(),
            "niri-v",
            "#!/bin/sh\necho 'niri 26.04 (8ed0da4)'\n",
        );

        let version = niri_version(binary.to_str().expect("utf8")).await;

        assert_eq!(version.as_deref(), Some("niri 26.04 (8ed0da4)"));
    }

    #[tokio::test]
    async fn the_version_is_none_when_the_binary_is_absent() {
        let dir = TempDir::new().expect("temp dir");
        let missing = dir.path().join("nope");

        let version = niri_version(missing.to_str().expect("utf8")).await;

        assert_eq!(version, None);
    }

    /// [`validate_config_content`] with an explicit binary, so the test can use a
    /// stub. The public function keeps the single name the product uses.
    async fn validate_config_content_with(
        binary: &str,
        dir: &Path,
        file_name: &str,
        content: &str,
    ) -> AppResult<ValidationOutcome> {
        let target = dir.join(file_name);
        let candidate = crate::fs::atomic::stage_candidate(&target, content.as_bytes())?;
        let outcome = run_niri_validate(binary, &candidate, &target).await;
        let _ = crate::fs::atomic::remove_staged(&candidate);
        outcome
    }
}
