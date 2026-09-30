//! Wrapper around `niri msg` for live data queries.

use crate::error::{AppError, AppResult};
use crate::niri::types::{LayerInfo, OutputInfo, WindowInfo, WorkspaceInfo};
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use tracing::{debug, trace, warn};

/// How long a `niri msg` query may take before it is treated as failed.
///
/// niri is local, so anything slower than this is a compositor that is not
/// answering. Without a bound, a socket that accepts and then stalls would hold a
/// request open indefinitely, and the screen waiting on it would hang.
const QUERY_TIMEOUT: Duration = Duration::from_secs(2);

/// Check whether the compositor is answering.
///
/// This asks the compositor, not the binary: an installed `niri` with no running
/// session is the case that matters, and only the compositor knows.
pub async fn is_niri_running() -> bool {
    trace!(target: "niriforge::niri::ipc", "is_niri_running called");
    niri_msg(&["msg", "--json", "outputs"]).await.is_ok()
}

/// Execute `niri msg` with given arguments and return stdout.
///
/// The arguments are passed as a list, never through a shell, so a value coming
/// from a config or from the UI cannot turn into a command.
pub async fn niri_msg(args: &[&str]) -> AppResult<String> {
    trace!(target: "niriforge::niri::ipc", "niri_msg called with args: {:?}", args);
    niri_msg_with(crate::niri::validate::NIRI_BINARY, args).await
}

/// [`niri_msg`] against a named binary.
///
/// The binary is a parameter so the tests can say what answers instead of
/// depending on the machine they run on. The arguments are still a list, so
/// naming the binary is the only thing a caller controls.
async fn niri_msg_with(binary: &str, args: &[&str]) -> AppResult<String> {
    trace!(target: "niriforge::niri::ipc", "niri_msg_with: {} {:?}", binary, args);
    let output = with_timeout(
        Command::new(binary)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|err| AppError::Io(format!("{binary} did not answer: {err}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        warn!(target: "niriforge::niri::ipc", "niri msg failed: {} exited with {}: {}", binary, output.status, stderr.trim());
        return Err(AppError::Other(format!(
            "{binary} exited with {}: {}",
            output.status,
            stderr.trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Get live outputs from niri.
pub async fn get_outputs() -> AppResult<Vec<OutputInfo>> {
    execute_niri_msg_json(&["msg", "--json", "outputs"]).await
}

/// Get live windows from niri.
pub async fn get_windows() -> AppResult<Vec<WindowInfo>> {
    execute_niri_msg_json(&["msg", "--json", "windows"]).await
}

/// Get live workspaces from niri.
pub async fn get_workspaces() -> AppResult<Vec<WorkspaceInfo>> {
    execute_niri_msg_json(&["msg", "--json", "workspaces"]).await
}

/// Get live layers from niri.
pub async fn get_layers() -> AppResult<Vec<LayerInfo>> {
    execute_niri_msg_json(&["msg", "--json", "layers"]).await
}

/// Get focused window from niri.
pub async fn get_focused_window() -> AppResult<Option<WindowInfo>> {
    execute_niri_msg_json(&["msg", "--json", "focused-window"]).await
}

/// Run a query, or give up after [`QUERY_TIMEOUT`].
///
/// `kill_on_drop` on the child is what makes the bound real: without it a killed
/// process would be reaped by the OS but the future would still wait on the pipe.
async fn with_timeout<F>(future: F) -> std::result::Result<std::process::Output, String>
where
    F: std::future::Future<Output = std::io::Result<std::process::Output>>,
{
    trace!(target: "niriforge::niri::ipc", "with_timeout started");
    match tokio::time::timeout(QUERY_TIMEOUT, future).await {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(err)) => {
            warn!(target: "niriforge::niri::ipc", "with_timeout: process error: {}", err);
            Err(err.to_string())
        }
        Err(_) => {
            warn!(target: "niriforge::niri::ipc", "with_timeout: timeout after {} seconds", QUERY_TIMEOUT.as_secs());
            Err(format!(
                "no answer within {} seconds",
                QUERY_TIMEOUT.as_secs()
            ))
        }
    }
}

/// Execute a raw niri msg command and parse JSON output.
async fn execute_niri_msg_json<T>(args: &[&str]) -> AppResult<T>
where
    T: for<'de> serde::Deserialize<'de>,
{
    trace!(target: "niriforge::niri::ipc", "execute_niri_msg_json: {:?}", args);
    let stdout = niri_msg(args).await?;
    debug!(target: "niriforge::niri::ipc", "niri msg response received ({} bytes)", stdout.len());
    serde_json::from_str(&stdout).map_err(|err| {
        AppError::Serialization(format!("niri returned something unreadable: {err}"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    use std::path::Path;

    /// Write a stub and mark it executable in the same step, so the kernel never
    /// sees a writable executable and refuses it with "text file busy".
    fn stub(dir: &Path, name: &str, script: &str) -> String {
        let path = dir.join(name);
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o755)
            .open(&path)
            .expect("stub should be created");
        file.write_all(script.as_bytes())
            .expect("stub should be written");
        file.sync_all().expect("stub should be flushed");
        path.display().to_string()
    }

    /// The real `niri_msg`, pointed at a stub: same code path, including the
    /// error text the user ends up seeing.
    async fn msg_with(binary: &str, args: &[&str]) -> AppResult<String> {
        niri_msg_with(binary, args).await
    }

    #[tokio::test]
    async fn stdout_is_returned_on_success() {
        let dir = TempDir::new().expect("temp dir");
        let binary = stub(
            dir.path(),
            "niri-a",
            "#!/bin/sh\necho 'niri 26.04 (8ed0da4)'\n",
        );

        let out = msg_with(&binary, &["--version"])
            .await
            .expect("the call should succeed");

        assert_eq!(out.trim(), "niri 26.04 (8ed0da4)");
    }

    #[tokio::test]
    async fn a_failing_binary_carries_its_diagnostic() {
        let dir = TempDir::new().expect("temp dir");
        let binary = stub(
            dir.path(),
            "niri-b",
            "#!/bin/sh\necho 'no compositor is running' >&2\nexit 1\n",
        );

        let err = msg_with(&binary, &["msg", "outputs"])
            .await
            .expect_err("a failing binary is an error");

        assert!(
            err.to_string().contains("no compositor is running"),
            "the reason has to survive: {err}"
        );
    }

    #[tokio::test]
    async fn a_missing_binary_is_an_error_not_a_panic() {
        let dir = TempDir::new().expect("temp dir");
        let missing = dir.path().join("no-niri-here").display().to_string();

        let err = msg_with(&missing, &["msg", "outputs"])
            .await
            .expect_err("a missing binary is an error");

        assert!(matches!(err, AppError::Io(_)), "got {err:?}");
    }

    #[tokio::test]
    async fn arguments_are_not_run_through_a_shell() {
        // A window title or a spawn command coming from a config must not be able
        // to become a command. The proof is that shell metacharacters arrive as
        // literal argument text.
        let dir = TempDir::new().expect("temp dir");
        let binary = stub(
            dir.path(),
            "niri-c",
            "#!/bin/sh\nfor a in \"$@\"; do echo \"[$a]\"; done\n",
        );

        let out = msg_with(&binary, &["msg", "action", "close-window; rm -rf /"])
            .await
            .expect("the call should succeed");

        assert!(
            out.contains("[close-window; rm -rf /]"),
            "the argument must arrive whole: {out}"
        );
    }

    #[tokio::test]
    async fn json_output_is_parsed() {
        let dir = TempDir::new().expect("temp dir");
        let binary = stub(
            dir.path(),
            "niri-d",
            "#!/bin/sh\necho '[{\"name\":\"eDP-1\",\"make\":\"\",\"model\":\"\",\"serial\":\"\",\"modes\":[],\"current_mode\":null,\"scale\":1.0,\"transform\":\"normal\",\"position\":{\"x\":0,\"y\":0},\"vrr\":false,\"focused\":true}]'\n",
        );

        let outputs: Vec<OutputInfo> = serde_json::from_str(
            &msg_with(&binary, &["msg", "--json", "outputs"])
                .await
                .expect("the call should succeed"),
        )
        .expect("the json should parse");

        assert_eq!(outputs.len(), 1);
        assert_eq!(outputs[0].name, "eDP-1");
    }

    #[tokio::test]
    async fn unreadable_json_is_reported_rather_than_panicking() {
        let dir = TempDir::new().expect("temp dir");
        let binary = stub(dir.path(), "niri-e", "#!/bin/sh\necho 'not json'\n");

        let out = msg_with(&binary, &["msg", "--json", "outputs"])
            .await
            .expect("the call should succeed");

        let parsed: AppResult<Vec<OutputInfo>> = serde_json::from_str::<Vec<OutputInfo>>(&out)
            .map_err(|err| AppError::Serialization(err.to_string()));

        assert!(
            matches!(parsed, Err(AppError::Serialization(_))),
            "got {parsed:?}"
        );
    }

    #[tokio::test]
    async fn a_hanging_compositor_is_given_up_on_rather_than_waited_on_forever() {
        let dir = TempDir::new().expect("temp dir");
        let binary = stub(dir.path(), "niri-f", "#!/bin/sh\nsleep 30\n");

        let started = std::time::Instant::now();
        let outcome = with_timeout(
            Command::new(&binary)
                .arg("msg")
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .kill_on_drop(true)
                .output(),
        )
        .await;

        assert!(
            outcome.is_err(),
            "a stalled compositor must not be waited on"
        );
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "the bound has to be the configured one, waited {:?}",
            started.elapsed()
        );
    }

    #[tokio::test]
    async fn running_state_is_a_bool_even_without_a_compositor() {
        // Whatever the machine this runs on, the call has to answer.
        let running = is_niri_running().await;

        assert!(matches!(running, true | false));
    }
}
