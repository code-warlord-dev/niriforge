/**
 * The wire contract as the frontend sees it.
 *
 * Every type below the re-export is generated from the Rust structs the backend
 * serialises, by `pnpm gen:types`. There is no hand-written copy of a field
 * name to fall out of step: if the backend renames a field, this file stops
 * typechecking until it is regenerated.
 *
 * The one type that is not generated is `ValidationIssue`, because `id` is a
 * frontend concern - it identifies a row in the validation panel, and the
 * backend has no reason to invent one.
 */

import type { ValidationError } from "./generated/contract";

export type * from "./generated/contract";

/** A validation error as the UI holds it: the wire shape plus a list identity. */
export type ValidationIssue = ValidationError & { id: string };

/**
 * A stable identity for a validation issue.
 *
 * Two issues at the same place with the same text are the same issue, and an
 * issue that moves to another line is a different one. Index is the last
 * resort, not the key: reordering a list must not remount every row.
 */
export function issueId(issue: ValidationError, index: number): string {
  const place = [issue.file ?? "", issue.line ?? "", issue.column ?? ""].join(":");
  return `${place}:${issue.message}#${index}`;
}

/** Give every issue in a batch its identity, keeping the wire order. */
export function toIssues(errors: ValidationError[]): ValidationIssue[] {
  return errors.map((error, index) => ({ ...error, id: issueId(error, index) }));
}
