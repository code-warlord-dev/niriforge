import { invoke } from "@tauri-apps/api/core";
import type { AppError, ValidationError } from "@/types/config";
import { logger } from "@/lib/logger";

/**
 * The boundary.
 *
 * Every command the backend registers, in one place, so that the list cannot
 * drift from `generate_handler!` in `src-tauri/src/lib.rs` without a test
 * failing, and so that a typo in a command name is a type error rather than a
 * rejected promise at runtime.
 */
export const COMMANDS = [
  "greet",
  "load_config",
  "save_config",
  "validate_config",
  "list_backups",
  "restore_backup",
  "create_backup",
  "delete_backup",
  "get_config_path",
  "check_niri_running",
  "niri_msg",
  "get_outputs",
  "serialize_file",
] as const;

export type CommandName = (typeof COMMANDS)[number];

/** Call a command the backend actually registers. */
export function invokeCommand<T>(
  command: CommandName,
  args?: Record<string, unknown>
): Promise<T> {
  logger.debug("ipc", `invoking command: ${command}`, args);
  const start = performance.now();
  return invoke<T>(command, args)
    .then((result) => {
      logger.debug("ipc", `command succeeded: ${command}`, {
        durationMs: performance.now() - start,
      });
      return result;
    })
    .catch((error) => {
      logger.error("ipc", `command failed: ${command}`, {
        durationMs: performance.now() - start,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    });
}

/**
 * Every tag `AppError` can carry, as a completeness check rather than a list.
 *
 * `satisfies Record<AppError["type"], true>` means adding a variant to the Rust
 * enum fails the typecheck here until it is handled, which is the point: the
 * frontend should not have to be re-guessed when the backend grows an error.
 */
const APP_ERROR_TAGS = {
  Io: true,
  KdlParse: true,
  KdlSerialize: true,
  SchemaValidation: true,
  NiriValidate: true,
  Backup: true,
  ConfigNotFound: true,
  IncludeResolution: true,
  AtomicWrite: true,
  SymlinkResolution: true,
  FileWatch: true,
  Serialization: true,
  Utf8: true,
  Tauri: true,
  Other: true,
} as const satisfies Record<AppError["type"], true>;

/**
 * Whether a rejected value is an `AppError` from the backend.
 *
 * The tag is checked because the frontend branches on it. The payload of
 * `details` is not checked field by field: it is the backend's own text, and the
 * worst a wrong payload can do is print a sentence that does not parse.
 */
export function isAppError(value: unknown): value is AppError {
  if (typeof value !== "object" || value === null) return false;
  if (!("type" in value)) return false;
  const tag: unknown = value.type;
  return typeof tag === "string" && tag in APP_ERROR_TAGS;
}

/** One issue as a single line: where it is, then what is wrong. */
export function describeValidationError(issue: ValidationError): string {
  const { file, line, column } = issue;
  if (file !== undefined && file !== null && line !== undefined && line !== null) {
    const atColumn = column === undefined || column === null ? "" : `:${column}`;
    return `${file}:${line}${atColumn}: ${issue.message}`;
  }
  return issue.message;
}

/**
 * Turn a failed command into text a user can act on.
 *
 * The backend's `type` says what kind of failure it is; its `details` says what
 * happened. Both are shown, because the type alone is a code and the details
 * alone do not say how bad it is.
 */
export function describeAppError(error: AppError): string {
  switch (error.type) {
    case "NiriValidate":
      return error.details.errors.map(describeValidationError).join("; ");
    case "ConfigNotFound":
      return error.details.path;
    case "KdlSerialize":
      return error.details.message;
    default:
      return error.details;
  }
}

/**
 * Normalise anything thrown by `invoke` into an `AppError`.
 *
 * Tauri rejects with the serialised `AppError` for a command that returned
 * `Err`, and with a plain string for a command that is not registered at all.
 * The second case has to survive being displayed rather than crash the store.
 */
export function toAppError(value: unknown): AppError {
  if (isAppError(value)) return value;
  const message = value instanceof Error ? value.message : String(value);
  return { type: "Other", details: message };
}
