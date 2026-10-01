"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Command,
  Crosshair,
  Keyboard,
  Mouse,
  Plus,
  Pointer,
  Tablet,
  Touchpad,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KdlPreviewPanel } from "@/components/rules/KdlPreviewPanel";
import { RuleEmptyState } from "@/components/rules/RuleEmptyState";
import { TriStateField } from "@/components/forms/TriStateField";
import { formatAccelSpeed, inputToKdl } from "@/components/input/inputKdl";
import { useConfigStore } from "@/stores/configStore";
import { logger } from "@/lib/logger";
import type {
  InputConfig,
  KeyboardConfig,
  MouseConfig,
  TouchpadConfig,
  TrackpointConfig,
} from "@/types/generated/contract";

/** `global` and `window` are the only track-layout values niri 26.04 accepts. */
const TRACK_LAYOUTS = ["global", "window"] as const;
const ACCEL_PROFILES = ["adaptive", "flat"] as const;
const SCROLL_METHODS = ["no-scroll", "two-finger", "edge", "on-button-down"] as const;
/** Registered modifier keys; anything else is an `invalid Mod key` at load. */
const MOD_KEYS = [
  "ctrl",
  "shift",
  "alt",
  "super",
  "mod3",
  "mod5",
  "iso_level3_shift",
  "iso_level5_shift",
] as const;

const UNSET = "__unset__";

/**
 * Input Devices.
 *
 * Each device is a separate node in `config.input`, and niri replaces a device
 * section wholesale when the same node appears in a later include, so this page
 * edits the node that is already there rather than assuming one layout. A field
 * left at "niri default" is not written at all: absent and off are different
 * things for several flags, and the KDL preview keeps them visible.
 */
export function InputPage() {
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);
  const [tab, setTab] = useState("keyboard");

  useEffect(() => {
    logger.info("InputPage", "mounted");
    return () => logger.info("InputPage", "unmounted");
  }, []);

  const patchInput = useCallback((patch: (node: InputConfig) => void) => {
    const store = useConfigStore.getState();
    store.update((draft) => {
      if (!draft.input) draft.input = {};
      patch(draft.input);
    });
    store.markDirty();
  }, []);

  const patchKeyboard = useCallback(
    (patch: (node: KeyboardConfig) => void) => {
      patchInput((node) => {
        if (!node.keyboard) node.keyboard = {};
        patch(node.keyboard);
      });
    },
    [patchInput]
  );

  const patchTouchpad = useCallback(
    (patch: (node: TouchpadConfig) => void) => {
      patchInput((node) => {
        if (!node.touchpad) node.touchpad = {};
        patch(node.touchpad);
      });
    },
    [patchInput]
  );

  const patchMouse = useCallback(
    (patch: (node: MouseConfig) => void) => {
      patchInput((node) => {
        if (!node.mouse) node.mouse = {};
        patch(node.mouse);
      });
    },
    [patchInput]
  );

  const patchTrackpoint = useCallback(
    (patch: (node: TrackpointConfig) => void) => {
      patchInput((node) => {
        if (!node.trackpoint) node.trackpoint = {};
        patch(node.trackpoint);
      });
    },
    [patchInput]
  );

  const addInputNode = useCallback(() => {
    const store = useConfigStore.getState();
    store.update((draft) => {
      draft.input = {};
    });
    store.markDirty();
    logger.debug("InputPage", "input node created");
  }, []);

  const addKeyboard = useCallback(() => {
    patchInput((node) => {
      node.keyboard = node.keyboard ?? {};
    });
  }, [patchInput]);

  const addTouchpad = useCallback(() => {
    patchInput((node) => {
      node.touchpad = node.touchpad ?? {};
    });
  }, [patchInput]);

  const addMouse = useCallback(() => {
    patchInput((node) => {
      node.mouse = node.mouse ?? {};
    });
  }, [patchInput]);

  const addTrackpoint = useCallback(() => {
    patchInput((node) => {
      node.trackpoint = node.trackpoint ?? {};
    });
  }, [patchInput]);

  const addTablet = useCallback(() => {
    patchInput((node) => {
      node.tablet = node.tablet ?? {};
    });
  }, [patchInput]);

  const addTouch = useCallback(() => {
    patchInput((node) => {
      node.touch = node.touch ?? {};
    });
  }, [patchInput]);

  const input = config?.input ?? null;
  const kdlLines = useMemo(() => (input ? inputToKdl(input) : []), [input]);

  if (!config) {
    return (
      <div className="flex h-full flex-col">
        <RuleEmptyState icon={Keyboard} title={t("empty.title")} description={t("empty.description")} />
      </div>
    );
  }

  if (!input) {
    return (
      <div className="flex h-full flex-col">
        <RuleEmptyState
          icon={Keyboard}
          title={t("input.empty_title", { defaultValue: "No input section" })}
          description={t("input.empty_description", {
            defaultValue:
              "This config has no input block, so niri uses its built-in defaults for every device. Add the block to start tuning a keyboard, touchpad or pointer.",
          })}
          actionLabel={t("input.add_node", { defaultValue: "Add input block" })}
          onAction={addInputNode}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card p-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Keyboard className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">{t("sidebar.input")}</h1>
          <span className="font-mono text-xs text-muted-foreground">config.input</span>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-border px-4 pt-3">
          <TabsList className="h-auto flex-wrap justify-start gap-1 bg-transparent p-0">
            <TabsTrigger value="keyboard">
              <Keyboard className="mr-1.5 h-4 w-4" />
              {t("input.tab_keyboard", { defaultValue: "Keyboard" })}
            </TabsTrigger>
            <TabsTrigger value="touchpad">
              <Touchpad className="mr-1.5 h-4 w-4" />
              {t("input.tab_touchpad", { defaultValue: "Touchpad" })}
            </TabsTrigger>
            <TabsTrigger value="mouse">
              <Mouse className="mr-1.5 h-4 w-4" />
              {t("input.tab_mouse", { defaultValue: "Mouse" })}
            </TabsTrigger>
            <TabsTrigger value="trackpoint">
              <Pointer className="mr-1.5 h-4 w-4" />
              {t("input.tab_trackpoint", { defaultValue: "Trackpoint" })}
            </TabsTrigger>
            <TabsTrigger value="tablet">
              <Tablet className="mr-1.5 h-4 w-4" />
              {t("input.tab_tablet", { defaultValue: "Tablet & Touch" })}
            </TabsTrigger>
            <TabsTrigger value="focus">
              <Command className="mr-1.5 h-4 w-4" />
              {t("input.tab_focus", { defaultValue: "Focus & Modifiers" })}
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-4">
            <TabsContent value="keyboard" className="mt-0 space-y-4">
              {input.keyboard ? (
                <>
                  <Panel
                    title="xkb"
                    icon={<Keyboard className="h-4 w-4 text-primary" />}
                  >
                    {input.keyboard.xkb ? (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <TextField
                          id="xkb-layout"
                          name="layout"
                          value={input.keyboard.xkb.layout}
                          placeholder="us,ru"
                          onChange={(value) =>
                            patchKeyboard((node) => {
                              node.xkb = node.xkb ?? {};
                              node.xkb.layout = value;
                            })
                          }
                        />
                        <TextField
                          id="xkb-variant"
                          name="variant"
                          value={input.keyboard.xkb.variant}
                          onChange={(value) =>
                            patchKeyboard((node) => {
                              node.xkb = node.xkb ?? {};
                              node.xkb.variant = value;
                            })
                          }
                        />
                        <TextField
                          id="xkb-options"
                          name="options"
                          value={input.keyboard.xkb.options}
                          placeholder="grp:alt_shift_toggle"
                          onChange={(value) =>
                            patchKeyboard((node) => {
                              node.xkb = node.xkb ?? {};
                              node.xkb.options = value;
                            })
                          }
                        />
                        <TextField
                          id="xkb-model"
                          name="model"
                          value={input.keyboard.xkb.model}
                          onChange={(value) =>
                            patchKeyboard((node) => {
                              node.xkb = node.xkb ?? {};
                              node.xkb.model = value;
                            })
                          }
                        />
                        <TextField
                          id="xkb-rules"
                          name="rules"
                          value={input.keyboard.xkb.rules}
                          onChange={(value) =>
                            patchKeyboard((node) => {
                              node.xkb = node.xkb ?? {};
                              node.xkb.rules = value;
                            })
                          }
                        />
                        <TextField
                          id="xkb-file"
                          name="file"
                          value={input.keyboard.xkb.file}
                          onChange={(value) =>
                            patchKeyboard((node) => {
                              node.xkb = node.xkb ?? {};
                              node.xkb.file = value;
                            })
                          }
                        />
                      </div>
                    ) : (
                      <AddRow
                        label={t("input.xkb_absent", {
                          defaultValue: "No xkb block: the layout comes from the system defaults.",
                        })}
                        actionLabel={t("input.add_xkb", { defaultValue: "Add xkb block" })}
                        onAction={() =>
                          patchKeyboard((node) => {
                            node.xkb = node.xkb ?? {};
                          })
                        }
                      />
                    )}
                  </Panel>

                  <Panel
                    title={t("input.repeat_title", { defaultValue: "Repeat & tracking" })}
                    icon={<Command className="h-4 w-4 text-primary" />}
                  >
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <NumberField
                        id="repeat-delay"
                        name="repeat-delay"
                        value={input.keyboard["repeat-delay"]}
                        min={0}
                        max={65535}
                        hint={t("input.repeat_delay_hint", { defaultValue: "Milliseconds before a held key repeats (0–65535)." })}
                        onChange={(value) =>
                          patchKeyboard((node) => {
                            node["repeat-delay"] = value;
                          })
                        }
                      />
                      <NumberField
                        id="repeat-rate"
                        name="repeat-rate"
                        value={input.keyboard["repeat-rate"]}
                        min={0}
                        max={255}
                        hint={t("input.repeat_rate_hint", { defaultValue: "Repeats per second (0–255)." })}
                        onChange={(value) =>
                          patchKeyboard((node) => {
                            node["repeat-rate"] = value;
                          })
                        }
                      />
                      <EnumField
                        id="track-layout"
                        name="track-layout"
                        value={input.keyboard["track-layout"]}
                        options={TRACK_LAYOUTS}
                        onChange={(value) =>
                          patchKeyboard((node) => {
                            node["track-layout"] = value;
                          })
                        }
                      />
                      <TriStateField
                        id="numlock"
                        name="numlock"
                        value={input.keyboard.numlock}
                        hint={t("input.numlock_hint", {
                          defaultValue: "niri accepts a bare node, true or false here.",
                        })}
                        onChange={(value) =>
                          patchKeyboard((node) => {
                            node.numlock = value;
                          })
                        }
                      />
                    </div>
                  </Panel>
                </>
              ) : (
                <DevicePrompt device="keyboard" onAdd={addKeyboard} />
              )}
            </TabsContent>

            <TabsContent value="touchpad" className="mt-0 space-y-4">
              {input.touchpad ? (
                <>
                  <Panel
                    title={t("input.tap_title", { defaultValue: "Gestures & tap" })}
                    icon={<Touchpad className="h-4 w-4 text-primary" />}
                  >
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <TriStateField id="tp-off" name="off" value={input.touchpad.off} hint={t("input.off_hint", { defaultValue: "Hide the device from niri entirely." })} onChange={(value) => patchTouchpad((node) => { node.off = value; })} />
                      <TriStateField id="tp-tap" name="tap" value={input.touchpad.tap} hint={t("input.tap_hint", { defaultValue: "A single-finger tap is a left click." })} onChange={(value) => patchTouchpad((node) => { node.tap = value; })} />
                      <TriStateField id="tp-dwt" name="dwt" value={input.touchpad.dwt} hint={t("input.dwt_hint", { defaultValue: "Disable the pad while typing." })} onChange={(value) => patchTouchpad((node) => { node.dwt = value; })} />
                      <TriStateField id="tp-dwtp" name="dwtp" value={input.touchpad.dwtp} hint={t("input.dwtp_hint", { defaultValue: "Disable the pad while typing, palm detection only." })} onChange={(value) => patchTouchpad((node) => { node.dwtp = value; })} />
                      <TriStateField id="tp-drag" name="drag" value={input.touchpad.drag} hint={t("input.drag_hint", { defaultValue: "Tap-and-drag; niri requires the explicit true/false argument." })} onChange={(value) => patchTouchpad((node) => { node.drag = value; })} />
                      <TriStateField id="tp-natural" name="natural-scroll" value={input.touchpad["natural-scroll"]} onChange={(value) => patchTouchpad((node) => { node["natural-scroll"] = value; })} />
                      <TriStateField id="tp-left-handed" name="left-handed" value={input.touchpad["left-handed"]} onChange={(value) => patchTouchpad((node) => { node["left-handed"] = value; })} />
                      <TriStateField id="tp-middle" name="middle-emulation" value={input.touchpad["middle-emulation"]} onChange={(value) => patchTouchpad((node) => { node["middle-emulation"] = value; })} />
                    </div>
                  </Panel>

                  <Panel
                    title={t("input.accel_title", { defaultValue: "Acceleration & scrolling" })}
                    icon={<Crosshair className="h-4 w-4 text-primary" />}
                  >
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <AccelSpeedField
                        id="tp-accel"
                        value={input.touchpad["accel-speed"]}
                        onChange={(value) => patchTouchpad((node) => { node["accel-speed"] = value; })}
                      />
                      <EnumField id="tp-profile" name="accel-profile" value={input.touchpad["accel-profile"]} options={ACCEL_PROFILES} onChange={(value) => patchTouchpad((node) => { node["accel-profile"] = value; })} />
                      <EnumField id="tp-scroll-method" name="scroll-method" value={input.touchpad["scroll-method"]} options={SCROLL_METHODS} onChange={(value) => patchTouchpad((node) => { node["scroll-method"] = value; })} />
                    </div>
                  </Panel>
                </>
              ) : (
                <DevicePrompt device="touchpad" onAdd={addTouchpad} />
              )}
            </TabsContent>

            <TabsContent value="mouse" className="mt-0 space-y-4">
              {input.mouse ? (
                <PointerPanel
                  device="mouse"
                  off={input.mouse.off}
                  naturalScroll={input.mouse["natural-scroll"]}
                  leftHanded={input.mouse["left-handed"]}
                  accelSpeed={input.mouse["accel-speed"]}
                  accelProfile={input.mouse["accel-profile"]}
                  scrollMethod={input.mouse["scroll-method"]}
                  patch={patchMouse}
                />
              ) : (
                <DevicePrompt device="mouse" onAdd={addMouse} />
              )}
            </TabsContent>

            <TabsContent value="trackpoint" className="mt-0 space-y-4">
              {input.trackpoint ? (
                <PointerPanel
                  device="trackpoint"
                  off={input.trackpoint.off}
                  naturalScroll={input.trackpoint["natural-scroll"]}
                  leftHanded={input.trackpoint["left-handed"]}
                  accelSpeed={input.trackpoint["accel-speed"]}
                  accelProfile={input.trackpoint["accel-profile"]}
                  scrollMethod={input.trackpoint["scroll-method"]}
                  patch={patchTrackpoint}
                />
              ) : (
                <DevicePrompt device="trackpoint" onAdd={addTrackpoint} />
              )}
            </TabsContent>

            <TabsContent value="tablet" className="mt-0 space-y-4">
              <Panel
                title={t("input.tablet_title", { defaultValue: "Tablet" })}
                icon={<Tablet className="h-4 w-4 text-primary" />}
              >
                {input.tablet ? (
                  <>
                    <TriStateField id="tablet-off" name="off" value={input.tablet.off} onChange={(value) => patchInput((node) => { if (node.tablet) node.tablet.off = value; })} />
                    <p className="text-xs text-muted-foreground">
                      {t("input.tablet_hint", {
                        defaultValue:
                          "This build models the off flag only; the other tablet keys stay in the file untouched.",
                      })}
                    </p>
                  </>
                ) : (
                  <AddRow
                    label={t("input.tablet_absent", { defaultValue: "No tablet block in this config." })}
                    actionLabel={t("input.add_device", { defaultValue: "Add {{device}} block", device: "tablet" })}
                    onAction={addTablet}
                  />
                )}
              </Panel>

              <Panel
                title={t("input.touch_title", { defaultValue: "Touch screen" })}
                icon={<Tablet className="h-4 w-4 text-primary" />}
              >
                {input.touch ? (
                  <>
                    <TriStateField id="touch-off" name="off" value={input.touch.off} onChange={(value) => patchInput((node) => { if (node.touch) node.touch.off = value; })} />
                    <p className="text-xs text-muted-foreground">
                      {t("input.touch_hint", {
                        defaultValue:
                          "This build models the off flag only; the other touch keys stay in the file untouched.",
                      })}
                    </p>
                  </>
                ) : (
                  <AddRow
                    label={t("input.touch_absent", { defaultValue: "No touch block in this config." })}
                    actionLabel={t("input.add_device", { defaultValue: "Add {{device}} block", device: "touch" })}
                    onAction={addTouch}
                  />
                )}
              </Panel>
            </TabsContent>

            <TabsContent value="focus" className="mt-0 space-y-4">
              <Panel
                title={t("input.focus_title", { defaultValue: "Window focus policies" })}
                icon={<Crosshair className="h-4 w-4 text-primary" />}
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <TriStateField
                    id="focus-follows-mouse"
                    name="focus-follows-mouse"
                    value={input["focus-follows-mouse"]}
                    hint={t("input.focus_follows_hint", {
                      defaultValue: "Focus the window under the pointer. niri has no false spelling; off removes the node.",
                    })}
                    onChange={(value) => patchInput((node) => { node["focus-follows-mouse"] = value; })}
                  />
                  <TriStateField
                    id="warp-mouse-to-focus"
                    name="warp-mouse-to-focus"
                    value={input["warp-mouse-to-focus"]}
                    hint={t("input.warp_hint", {
                      defaultValue: "Move the pointer to a window focused from the keyboard.",
                    })}
                    onChange={(value) => patchInput((node) => { node["warp-mouse-to-focus"] = value; })}
                  />
                </div>
              </Panel>

              <Panel
                title={t("input.modkey_title", { defaultValue: "Modifier key" })}
                icon={<Command className="h-4 w-4 text-primary" />}
              >
                <EnumField
                  id="mod-key"
                  name="mod-key"
                  value={input["mod-key"]}
                  options={MOD_KEYS}
                  onChange={(value) => patchInput((node) => { node["mod-key"] = value; })}
                />
              </Panel>
            </TabsContent>
          </div>

          <div className="min-w-0 lg:sticky lg:top-0 lg:self-start">
            <KdlPreviewPanel
              nodeName="input"
              lines={kdlLines}
              title={t("input.kdl_title", { defaultValue: "Input as KDL" })}
              note={t("input.kdl_note", {
                defaultValue:
                  "A flag left at niri default is omitted; an explicit off is written as a commented-out node, which niri reads as absent.",
              })}
            />
          </div>
        </div>
      </Tabs>
    </div>
  );
}

interface PanelProps {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}

function Panel({ title, icon, children }: PanelProps) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-card p-4">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

interface TextFieldProps {
  id: string;
  name: string;
  value: string | null | undefined;
  placeholder?: string;
  onChange: (value: string | null) => void;
}

function TextField({ id, name, value, placeholder, onChange }: TextFieldProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="font-mono text-xs text-muted-foreground">
        {name}
      </Label>
      <Input
        id={id}
        className="h-8 font-mono"
        value={value ?? ""}
        placeholder={placeholder ?? t("input.unset", { defaultValue: "niri default" })}
        onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
      />
    </div>
  );
}

interface NumberFieldProps {
  id: string;
  name: string;
  value: number | null | undefined;
  min: number;
  max: number;
  hint?: string;
  onChange: (value: number | null) => void;
}

/**
 * Bounded integer field. niri rejects out-of-range values outright, so the
 * field clamps to the range the wire type can hold instead of passing an
 * invalid number to the file.
 */
function NumberField({ id, name, value, min, max, hint, onChange }: NumberFieldProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="font-mono text-xs text-muted-foreground">
        {name}
      </Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        className="h-8 font-mono"
        value={value ?? ""}
        placeholder={t("input.unset", { defaultValue: "niri default" })}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === "") {
            onChange(null);
            return;
          }
          const parsed = Number(raw);
          if (Number.isFinite(parsed)) {
            onChange(Math.min(max, Math.max(min, Math.round(parsed))));
          }
        }}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

interface EnumFieldProps {
  id: string;
  name: string;
  value: string | null | undefined;
  options: readonly string[];
  onChange: (value: string | null) => void;
}

function EnumField({ id, name, value, options, onChange }: EnumFieldProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="font-mono text-xs text-muted-foreground">
        {name}
      </Label>
      <Select
        value={value ?? UNSET}
        onValueChange={(next) => onChange(next === UNSET ? null : next)}
      >
        <SelectTrigger id={id} className="h-8 font-mono text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNSET} className="font-mono text-xs">
            {t("input.unset", { defaultValue: "niri default" })}
          </SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option} className="font-mono text-xs">
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

interface AccelSpeedFieldProps {
  id: string;
  value: number | null | undefined;
  onChange: (value: number | null) => void;
}

function AccelSpeedField({ id, value, onChange }: AccelSpeedFieldProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="font-mono text-xs text-muted-foreground">
          accel-speed
        </Label>
        <span className="font-mono text-xs text-primary">
          {value != null ? formatAccelSpeed(value) : t("input.unset", { defaultValue: "niri default" })}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={-1}
        max={1}
        step={0.05}
        value={value ?? 0}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted"
        style={{ accentColor: "var(--primary)" }}
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">−1</span>
        <span className="text-xs text-muted-foreground">0</span>
        <span className="text-xs text-muted-foreground">+1</span>
      </div>
    </div>
  );
}

interface PointerPanelProps {
  device: "mouse" | "trackpoint";
  off: boolean | null | undefined;
  naturalScroll: boolean | null | undefined;
  leftHanded: boolean | null | undefined;
  accelSpeed: number | null | undefined;
  accelProfile: string | null | undefined;
  scrollMethod: string | null | undefined;
  patch: (patch: (node: MouseConfig | TrackpointConfig) => void) => void;
}

/**
 * Mouse and trackpoint share every field niri 26.04 gives them, so they share
 * one panel. niri has no `tap`, `dwt` or `middle-emulation` on these devices,
 * and offering them would only produce a config that fails to load.
 */
function PointerPanel({
  device,
  off,
  naturalScroll,
  leftHanded,
  accelSpeed,
  accelProfile,
  scrollMethod,
  patch,
}: PointerPanelProps) {
  const { t } = useTranslation();
  return (
    <>
      <Panel
        title={t("input.pointer_title", { defaultValue: "Pointer behaviour" })}
        icon={<Mouse className="h-4 w-4 text-primary" />}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TriStateField id={`${device}-off`} name="off" value={off} hint={t("input.off_hint", { defaultValue: "Hide the device from niri entirely." })} onChange={(value) => patch((node) => { node.off = value; })} />
          <TriStateField id={`${device}-natural`} name="natural-scroll" value={naturalScroll} onChange={(value) => patch((node) => { node["natural-scroll"] = value; })} />
          <TriStateField id={`${device}-left-handed`} name="left-handed" value={leftHanded} onChange={(value) => patch((node) => { node["left-handed"] = value; })} />
        </div>
      </Panel>

      <Panel
        title={t("input.accel_title", { defaultValue: "Acceleration & scrolling" })}
        icon={<Crosshair className="h-4 w-4 text-primary" />}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <AccelSpeedField id={`${device}-accel`} value={accelSpeed} onChange={(value) => patch((node) => { node["accel-speed"] = value; })} />
          <EnumField id={`${device}-profile`} name="accel-profile" value={accelProfile} options={ACCEL_PROFILES} onChange={(value) => patch((node) => { node["accel-profile"] = value; })} />
          <EnumField id={`${device}-scroll-method`} name="scroll-method" value={scrollMethod} options={SCROLL_METHODS} onChange={(value) => patch((node) => { node["scroll-method"] = value; })} />
        </div>
      </Panel>
    </>
  );
}

interface DevicePromptProps {
  device: string;
  onAdd: () => void;
}

function DevicePrompt({ device, onAdd }: DevicePromptProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-subtle bg-surface-card p-8 text-center">
      <p className="max-w-md text-sm text-muted-foreground">
        {t("input.device_absent", {
          defaultValue: "There is no {{device}} block in this config, so niri uses its defaults.",
          device,
        })}
      </p>
      <Button variant="outline" size="sm" onClick={onAdd}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        {t("input.add_device", { defaultValue: "Add {{device}} block", device })}
      </Button>
    </div>
  );
}

interface AddRowProps {
  label: string;
  actionLabel: string;
  onAction: () => void;
}

function AddRow({ label, actionLabel, onAction }: AddRowProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-border-subtle bg-muted p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <Button variant="outline" size="sm" onClick={onAction}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        {actionLabel}
      </Button>
    </div>
  );
}
