import type {
  InputConfig,
  KeyboardConfig,
  MouseConfig,
  TabletConfig,
  TouchConfig,
  TouchpadConfig,
  TrackpointConfig,
} from "@/types/generated/contract";
import { kdlString } from "@/components/rules/kdl";

/**
 * KDL text for the `input` section.
 *
 * This is a read-only projection of the typed config, not a second source of
 * truth. Every line follows the grammar niri 26.04 actually parses: a bare node
 * for an enabled class-A flag, the node commented out when the flag is
 * explicitly off (there is no `flag false` spelling), an argument only where
 * niri accepts one. String values are always quoted and enum values are written
 * lowercase, because niri rejects both unquoted identifiers and wrong case.
 */

/** niri wants a decimal with a digit on each side; rounding drops slider noise. */
export function formatAccelSpeed(value: number): string {
  return String(Number(value.toFixed(2)));
}

function bareFlag(name: string, value: boolean | null | undefined): string | null {
  if (value == null) return null;
  // `/-name` is a KDL comment: niri ignores the node, which is what off means.
  return value ? name : `/-${name}`;
}

function argumentFlag(name: string, value: boolean | null | undefined): string | null {
  if (value == null) return null;
  return `${name} ${value}`;
}

function section(name: string, body: string[]): string[] {
  if (body.length === 0) return [];
  return [`${name} {`, ...body.map((line) => `    ${line}`), "}"];
}

function compact(lines: Array<string | null>): string[] {
  return lines.filter((line): line is string => line !== null);
}

function xkbLines(xkb: NonNullable<KeyboardConfig["xkb"]>): string[] {
  return section(
    "xkb",
    compact([
      xkb.rules != null ? `rules ${kdlString(xkb.rules)}` : null,
      xkb.model != null ? `model ${kdlString(xkb.model)}` : null,
      xkb.layout != null ? `layout ${kdlString(xkb.layout)}` : null,
      xkb.variant != null ? `variant ${kdlString(xkb.variant)}` : null,
      xkb.options != null ? `options ${kdlString(xkb.options)}` : null,
      xkb.file != null ? `file ${kdlString(xkb.file)}` : null,
    ])
  );
}

function keyboardLines(keyboard: KeyboardConfig): string[] {
  const body: string[] = [];
  if (keyboard.xkb) body.push(...xkbLines(keyboard.xkb));
  if (keyboard["repeat-delay"] != null) body.push(`repeat-delay ${keyboard["repeat-delay"]}`);
  if (keyboard["repeat-rate"] != null) body.push(`repeat-rate ${keyboard["repeat-rate"]}`);
  if (keyboard["track-layout"] != null) {
    body.push(`track-layout ${kdlString(keyboard["track-layout"])}`);
  }
  const numlock = argumentFlag("numlock", keyboard.numlock);
  if (numlock) body.push(numlock);
  return section("keyboard", body);
}

/** The fields shared by mouse and trackpoint in niri 26.04. */
type PointerConfig = MouseConfig | TrackpointConfig;

function pointerLines(name: string, device: PointerConfig): string[] {
  return section(
    name,
    compact([
      bareFlag("off", device.off),
      bareFlag("natural-scroll", device["natural-scroll"]),
      bareFlag("left-handed", device["left-handed"]),
      device["accel-speed"] != null
        ? `accel-speed ${formatAccelSpeed(device["accel-speed"])}`
        : null,
      device["accel-profile"] != null ? `accel-profile ${kdlString(device["accel-profile"])}` : null,
      device["scroll-method"] != null ? `scroll-method ${kdlString(device["scroll-method"])}` : null,
    ])
  );
}

function touchpadLines(touchpad: TouchpadConfig): string[] {
  return section(
    "touchpad",
    compact([
      bareFlag("off", touchpad.off),
      bareFlag("tap", touchpad.tap),
      bareFlag("dwt", touchpad.dwt),
      bareFlag("dwtp", touchpad.dwtp),
      // drag is the one device flag niri requires an argument for.
      argumentFlag("drag", touchpad.drag),
      bareFlag("natural-scroll", touchpad["natural-scroll"]),
      bareFlag("left-handed", touchpad["left-handed"]),
      bareFlag("middle-emulation", touchpad["middle-emulation"]),
      touchpad["accel-speed"] != null
        ? `accel-speed ${formatAccelSpeed(touchpad["accel-speed"])}`
        : null,
      touchpad["accel-profile"] != null
        ? `accel-profile ${kdlString(touchpad["accel-profile"])}`
        : null,
      touchpad["scroll-method"] != null
        ? `scroll-method ${kdlString(touchpad["scroll-method"])}`
        : null,
    ])
  );
}

function offOnlyLines(name: string, device: TabletConfig | TouchConfig): string[] {
  return section(name, compact([bareFlag("off", device.off)]));
}

/** Body lines of the `input` node, indented relative to it. */
export function inputToKdl(input: InputConfig): string[] {
  const body: string[] = [];
  if (input.keyboard) body.push(...keyboardLines(input.keyboard));
  if (input.touchpad) body.push(...touchpadLines(input.touchpad));
  if (input.mouse) body.push(...pointerLines("mouse", input.mouse));
  if (input.trackpoint) body.push(...pointerLines("trackpoint", input.trackpoint));
  if (input.tablet) body.push(...offOnlyLines("tablet", input.tablet));
  if (input.touch) body.push(...offOnlyLines("touch", input.touch));
  const focus = bareFlag("focus-follows-mouse", input["focus-follows-mouse"]);
  if (focus) body.push(focus);
  const warp = bareFlag("warp-mouse-to-focus", input["warp-mouse-to-focus"]);
  if (warp) body.push(warp);
  if (input["mod-key"] != null) body.push(`mod-key ${kdlString(input["mod-key"])}`);
  return body;
}
