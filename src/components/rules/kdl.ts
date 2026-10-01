import type { MatchRules } from "@/types/generated/contract";

/**
 * KDL text for the pages that edit rules.
 *
 * This is a read-only projection: it never becomes the source of truth, it
 * only shows what the current typed rule will be written as. The backend
 * serializer stays the authority, so this deliberately serialises only the
 * shapes that survive a round trip.
 */

export function kdlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function kdlIdentifier(value: string): string {
  return /^[A-Za-z][\w.-]*$/.test(value) ? value : kdlString(value);
}

function isPlainPattern(value: string): boolean {
  return !/[*+?()[\]{}^$|\\]/.test(value);
}

function patternNode(key: string, value: string): string {
  return isPlainPattern(value)
    ? `match ${key}=${kdlString(value)}`
    : `match ${key}=${kdlIdentifier(value)}`;
}

function boolValue(value: boolean): string {
  return value ? "true" : "false";
}

function boolNode(key: string, value: boolean): string {
  return `match ${key}=${boolValue(value)}`;
}

/** One line per criterion, in the order niri documents them. */
export function matchRulesToKdl(rules: MatchRules): string[] {
  const lines: string[] = [];
  if (rules["app-id"] != null) lines.push(patternNode("app-id", rules["app-id"]));
  if (rules.title != null) lines.push(patternNode("title", rules.title));
  if (rules.namespace != null) lines.push(patternNode("namespace", rules.namespace));
  if (rules["is-active"] != null) lines.push(boolNode("is-active", rules["is-active"]));
  if (rules["is-focused"] != null) lines.push(boolNode("is-focused", rules["is-focused"]));
  if (rules["is-floating"] != null) lines.push(boolNode("is-floating", rules["is-floating"]));
  if (rules["is-maximized"] != null) lines.push(boolNode("is-maximized", rules["is-maximized"]));
  if (rules["is-fullscreen"] != null) lines.push(boolNode("is-fullscreen", rules["is-fullscreen"]));
  if (rules["at-startup"] != null) lines.push(boolNode("at-startup", rules["at-startup"]));
  return lines;
}

/** Keys niri's matcher accepts, with the ones that are a literal vs. a regex. */
const MATCH_CRITERIA: Array<{ key: keyof MatchRules; isPattern: boolean }> = [
  { key: "app-id", isPattern: true },
  { key: "title", isPattern: true },
  { key: "is-active", isPattern: false },
  { key: "is-focused", isPattern: false },
  { key: "is-floating", isPattern: false },
  { key: "is-maximized", isPattern: false },
  { key: "is-fullscreen", isPattern: false },
  { key: "at-startup", isPattern: false },
];

const CRITERIA_BY_KEY = new Map(MATCH_CRITERIA.map((c) => [c.key as string, c]));

/**
 * Whether niri would compile the value into a regex rather than compare it.
 *
 * A value with no regex metacharacter is a literal, and telling the two apart
 * is the difference between `^Foo$` meaning an anchored pattern and
 * `terminal` meaning a literal app id.
 */
export function isRegexPattern(key: string, value: string): boolean {
  return (CRITERIA_BY_KEY.get(key)?.isPattern ?? false) && !isPlainPattern(value);
}

/**
 * Compile a pattern the way niri would, so the page can refuse a regex niri
 * would reject at config load.
 */
export function compilePattern(value: string): { ok: true } | { ok: false; message: string } {
  if (value === "") return { ok: true };
  try {
    new RegExp(value);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export function hasMatchCriteria(rules: MatchRules): boolean {
  return Object.values(rules).some((value) => value !== null && value !== undefined);
}

/** Compact one-line summary, the way the rule list prints it. */
export function summarizeMatch(rules: MatchRules): string {
  const parts = matchRulesToKdl(rules).map((line) => line.replace(/^match /, ""));
  if (parts.length === 0) return "match {}";
  return `match { ${parts.join("; ")} }`;
}
