import type { BindEntry } from "@/types/generated/contract";
import { kdlString } from "@/components/rules/kdl";

/**
 * KDL text for `binds`.
 *
 * A bind is `key [properties] { action; }`: the action is a child node, never
 * an argument, and the overlay title property is spelled `hotkey-overlay-title`
 * in the file even though the wire contract calls the field `overlay-title`.
 * The preview follows the file spelling so what is shown is what niri reads.
 */

function bindProperties(bind: BindEntry): string[] {
  const props: string[] = [];
  if (bind["allow-when-locked"] != null) {
    props.push(`allow-when-locked=${bind["allow-when-locked"]}`);
  }
  if (bind["allow-inhibiting"] != null) {
    props.push(`allow-inhibiting=${bind["allow-inhibiting"]}`);
  }
  if (bind["cooldown-ms"] != null) props.push(`cooldown-ms=${bind["cooldown-ms"]}`);
  if (bind["overlay-title"] != null) {
    props.push(`hotkey-overlay-title=${kdlString(bind["overlay-title"])}`);
  }
  return props;
}

/** The bind's node header: chord plus any inline properties. */
export function bindHeader(bind: BindEntry): string {
  const props = bindProperties(bind);
  return props.length > 0 ? `${bind.key} ${props.join(" ")}` : bind.key;
}

/** The single action node inside the bind block. */
export function bindActionLine(bind: BindEntry): string {
  const args = (bind.args ?? []).map((arg) => kdlString(arg)).join(" ");
  return args ? `${bind.action} ${args}` : bind.action;
}

/** Body lines of the `binds` node, indented relative to it. */
export function bindsToKdlLines(binds: BindEntry[]): string[] {
  const lines: string[] = [];
  for (const bind of binds) {
    lines.push(`${bindHeader(bind)} {`);
    lines.push(`    ${bindActionLine(bind)};`);
    lines.push("}");
  }
  return lines;
}

/**
 * A chord reduced to a comparable form.
 *
 * niri does not care whether the modifier comes first, so sorting the parts is
 * what lets `Mod+Shift+D` and `Shift+Mod+D` be reported as the same chord.
 */
export function normalizeChord(key: string): string {
  return key
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0)
    .sort()
    .join("+");
}

/** Row index -> the shared chord, for every bind whose chord appears twice. */
export function findDuplicateChords(binds: BindEntry[]): Map<number, string> {
  const byChord = new Map<string, number[]>();
  binds.forEach((bind, index) => {
    const chord = normalizeChord(bind.key);
    if (chord === "") return;
    const existing = byChord.get(chord);
    if (existing) existing.push(index);
    else byChord.set(chord, [index]);
  });

  const duplicates = new Map<number, string>();
  for (const [chord, indices] of byChord) {
    if (indices.length < 2) continue;
    for (const index of indices) duplicates.set(index, chord);
  }
  return duplicates;
}

/** niri key names whose physical key label differs from the token. */
const KEY_ALIASES: Record<string, string> = {
  mod: "Super",
  super: "Super",
  mod4: "Super",
  ctrl: "Ctrl",
  control: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  return: "Enter",
  enter: "Enter",
  escape: "Esc",
  esc: "Esc",
  backspace: "Backspace",
  delete: "Del",
  space: "Space",
  tab: "Tab",
  capslock: "Caps",
  minus: "-",
  equal: "=",
  grave: "`",
  bracketleft: "[",
  bracketright: "]",
  backslash: "\\",
  semicolon: ";",
  apostrophe: "'",
  comma: ",",
  period: ".",
  slash: "/",
};

/** One niri key token mapped onto the physical key it names, when known. */
export function normalizeKeyToken(token: string): string {
  const trimmed = token.trim();
  const lower = trimmed.toLowerCase();
  const alias = KEY_ALIASES[lower];
  if (alias) return alias;
  if (/^[a-z]$/.test(lower)) return lower.toUpperCase();
  if (/^[0-9]$/.test(lower)) return lower;
  if (/^f([1-9]|1[0-2])$/.test(lower)) return lower.toUpperCase();
  return trimmed;
}

/** How many binds name each physical key. */
export function keyCounts(binds: BindEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const bind of binds) {
    for (const token of bind.key.split("+")) {
      const label = normalizeKeyToken(token);
      if (label === "") continue;
      counts[label] = (counts[label] ?? 0) + 1;
    }
  }
  return counts;
}
