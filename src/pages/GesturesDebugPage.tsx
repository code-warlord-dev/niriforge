"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bug,
  Check,
  CircleSlash,
  Copy,
  Eraser,
  FileCode2,
  Hand,
  Layers,
  Plus,
  RefreshCw,
  ScanEye,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { RuleEmptyState } from "@/components/rules/RuleEmptyState";
import { kdlString } from "@/components/rules/kdl";
import { useConfigStore } from "@/stores/configStore";
import { describeAppError, invokeCommand, toAppError } from "@/lib/ipc";
import type { OutputInfo } from "@/types/config";
import type {
  DebugConfig,
  GesturesConfig,
  HotCornersConfig,
  HotkeyOverlayConfig,
  OverviewConfig,
  RecentWindowsConfig,
  SpawnEntry,
  SwitchEventsConfig,
} from "@/types/generated/contract";
import { logger } from "@/lib/logger";

/**
 * The corners niri watches, in the order the schema declares them.
 *
 * A corner is either empty (niri's own default action) or a single action
 * string, so the whole node is four independent text fields rather than a
 * picker: the set of actions is the same set the key bindings use, and that
 * list is not a closed enum.
 */
const HOT_CORNER_KEYS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;

/**
 * Switch events, in the order niri documents them.
 *
 * Each one takes a list of spawn entries, the same shape as
 * `spawn-at-startup`, so a lid action is a command plus optional arguments.
 */
const SWITCH_EVENT_KEYS = ["lid-open", "lid-close", "tablet-mode-on", "tablet-mode-off"] as const;
type SwitchEventKey = (typeof SWITCH_EVENT_KEYS)[number];

/** Log levels the `debug` node accepts, quietest first. */
const LOG_LEVELS = ["error", "warn", "info", "debug"] as const;

const LOG_LEVEL_NONE = "__default__";

/** One probe result: never a guess, always either the real answer or why not. */
type Probe =
  | { state: "unknown" }
  | { state: "loading" }
  | { state: "ok"; value: string }
  | { state: "unavailable"; reason: string };

const IDLE_PROBE: Probe = { state: "unknown" };

/**
 * Gestures & Debug.
 *
 * Two halves that are kept apart on purpose. The config half — `gestures`,
 * `switch-events`, `hotkey-overlay`, `overview`, `recent-windows`, `debug` — is
 * the file, and every field here goes through the config draft like the rest of
 * the app. The diagnostics half is telemetry read back from a running niri and
 * is never written anywhere: it shows what the commands actually returned, and
 * says so plainly when they cannot answer.
 *
 * Nothing on this page invents a frame time, a message rate or a scanout state.
 * A probe that failed is displayed as failed.
 */
export function GesturesDebugPage() {
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);

  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const [probing, setProbing] = useState(false);
  const [dumped, setDumped] = useState(false);
  const [newSpawn, setNewSpawn] = useState<Record<string, string>>({});

  useEffect(() => {
    logger.info("GesturesDebugPage", "mounted");
    return () => logger.info("GesturesDebugPage", "unmounted");
  }, []);

  const patchConfig = useCallback((patch: (draft: NonNullable<typeof config>) => void) => {
    const store = useConfigStore.getState();
    store.update(patch);
    store.markDirty();
  }, []);

  const patchGestures = useCallback(
    (patch: (node: GesturesConfig) => void) => {
      patchConfig((draft) => {
        if (!draft.gestures) draft.gestures = {};
        patch(draft.gestures);
      });
    },
    [patchConfig]
  );

  const patchSwitchEvents = useCallback(
    (key: SwitchEventKey, entries: SpawnEntry[] | null) => {
      patchConfig((draft) => {
        if (!draft["switch-events"]) draft["switch-events"] = {};
        draft["switch-events"][key] = entries;
      });
    },
    [patchConfig]
  );

  const patchHotkeyOverlay = useCallback(
    (patch: (node: HotkeyOverlayConfig) => void) => {
      patchConfig((draft) => {
        if (!draft["hotkey-overlay"]) draft["hotkey-overlay"] = {};
        patch(draft["hotkey-overlay"]);
      });
    },
    [patchConfig]
  );

  const patchOverview = useCallback(
    (patch: (node: OverviewConfig) => void) => {
      patchConfig((draft) => {
        if (!draft.overview) draft.overview = {};
        patch(draft.overview);
      });
    },
    [patchConfig]
  );

  const patchRecentWindows = useCallback(
    (patch: (node: RecentWindowsConfig) => void) => {
      patchConfig((draft) => {
        if (!draft["recent-windows"]) draft["recent-windows"] = {};
        patch(draft["recent-windows"]);
      });
    },
    [patchConfig]
  );

  const patchDebug = useCallback(
    (patch: (node: DebugConfig) => void) => {
      patchConfig((draft) => {
        if (!draft.debug) draft.debug = {};
        patch(draft.debug);
      });
    },
    [patchConfig]
  );

  const gestures = config?.gestures ?? null;
  const switchEvents = config?.["switch-events"] ?? null;
  const hotkeyOverlay = config?.["hotkey-overlay"] ?? null;
  const overview = config?.overview ?? null;
  const recentWindows = config?.["recent-windows"] ?? null;
  const debug = config?.debug ?? null;

  /**
   * Ask niri what it can tell us.
   *
   * Each probe is independent: a working `niri msg --version` next to a failing
   * socket query is a real and useful combination, so one failure does not
   * blank the rest.
   */
  const runProbes = useCallback(async () => {
    setProbing(true);
    setProbes({
      running: { state: "loading" },
      version: IDLE_PROBE,
      socket: IDLE_PROBE,
      outputs: IDLE_PROBE,
    });
    logger.info("GesturesDebugPage", "diagnostics probe started");

    const setProbe = (key: string, probe: Probe) =>
      setProbes((current) => ({ ...current, [key]: probe }));

    try {
      let running = false;
      try {
        running = await invokeCommand<boolean>("check_niri_running", {});
        setProbe("running", { state: "ok", value: running ? "yes" : "no" });
      } catch (err) {
        setProbe("running", { state: "unavailable", reason: describeAppError(toAppError(err)) });
      }

      const query = async (key: string, args: string[]) => {
        try {
          const output = await invokeCommand<string>("niri_msg", { args });
          setProbe(key, { state: "ok", value: output.trim() });
        } catch (err) {
          setProbe(key, { state: "unavailable", reason: describeAppError(toAppError(err)) });
        }
      };

      await query("version", ["--version"]);
      await query("socket", ["socket"]);

      try {
        const outputs = await invokeCommand<OutputInfo[]>("get_outputs", {});
        setProbe("outputs", {
          state: "ok",
          value:
            outputs.length === 0
              ? t("gestures.no_outputs", { defaultValue: "no outputs reported" })
              : outputs
                  .map(
                    (output) =>
                      `${output.name} ${output["current-mode"] ?? "—"} ${
                        output.vrr ? "vrr" : "no-vrr"
                      }`
                  )
                  .join("  ·  "),
        });
      } catch (err) {
        setProbe("outputs", { state: "unavailable", reason: describeAppError(toAppError(err)) });
      }

      logger.info("GesturesDebugPage", "diagnostics probe finished");
    } finally {
      setProbing(false);
    }
  }, [t]);

  const diagnostics = useMemo(
    () => [
      { key: "running", label: "niri process" },
      { key: "version", label: "niri msg --version" },
      { key: "socket", label: "niri msg socket" },
      { key: "outputs", label: "connected outputs" },
    ],
    []
  );

  /**
   * The dump carries the probe answers and the version of the app only.
   *
   * It deliberately does not include the config, the environment block or any
   * spawn command: those are the parts of this machine that turn a pasted
   * report into a leak.
   */
  const exportDump = useCallback(async () => {
    const lines: string[] = [];
    lines.push(`# niri diagnostics, taken ${new Date().toISOString()}`);
    lines.push("");
    for (const item of diagnostics) {
      const probe = probes[item.key] ?? IDLE_PROBE;
      if (probe.state === "ok") lines.push(`${item.label}: ${probe.value}`);
      else if (probe.state === "unavailable") lines.push(`${item.label}: unavailable (${probe.reason})`);
      else lines.push(`${item.label}: not checked`);
    }
    lines.push("");
    lines.push("# config values are excluded on purpose; nothing here is a secret by accident");

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setDumped(true);
      window.setTimeout(() => setDumped(false), 2000);
      logger.info("GesturesDebugPage", "diagnostic dump copied");
    } catch (err) {
      logger.warn("GesturesDebugPage", "clipboard write failed", err);
    }
  }, [diagnostics, probes]);

  const kdlLines = useMemo(() => {
    if (!config) return [];
    return gesturesDebugToKdl({
      gestures,
      switchEvents,
      hotkeyOverlay,
      overview,
      recentWindows,
      debug,
    });
  }, [config, gestures, switchEvents, hotkeyOverlay, overview, recentWindows, debug]);

  if (!config) {
    return (
      <div className="flex h-full flex-col">
        <RuleEmptyState icon={Hand} title={t("empty.title")} description={t("empty.description")} />
      </div>
    );
  }

  const hasGestureConfig =
    gestures != null ||
    switchEvents != null ||
    hotkeyOverlay != null ||
    overview != null ||
    recentWindows != null ||
    debug != null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card p-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Hand className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">{t("sidebar.gestures")}</h1>
          <span className="font-mono text-xs text-muted-foreground">
            gestures · switch-events · debug
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono text-xs">
            {kdlLines.length} lines
          </Badge>
          <Badge variant="outline" className="font-mono text-xs">
            {probing ? t("common.loading") : `${diagnostics.length} probes`}
          </Badge>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-card p-4">
            <div className="flex items-center gap-2">
              <Hand className="h-4 w-4 text-primary" />
              <h2 className="text-lg font-semibold">
                {t("gestures.touch", { defaultValue: "Touchpad & touch screen" })}
              </h2>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("gestures.touch_hint", {
                defaultValue:
                  "These two flags decide whether a drag at the screen edge pans a column, switches workspace, or does nothing. niri's own defaults apply while they are unset.",
              })}
            </p>

            <div className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-muted p-2.5">
              <div className="min-w-0">
                <span className="font-mono text-sm">dnd-edge-view-scroll</span>
                <p className="text-xs text-muted-foreground">
                  {t("gestures.dnd_view_scroll_hint", {
                    defaultValue: "Drag from the edge to scroll into the adjacent column.",
                  })}
                </p>
              </div>
              <Switch
                checked={gestures?.["dnd-edge-view-scroll"] ?? false}
                onCheckedChange={(checked) =>
                  patchGestures((node) => {
                    node["dnd-edge-view-scroll"] = checked;
                  })
                }
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-muted p-2.5">
              <div className="min-w-0">
                <span className="font-mono text-sm">dnd-edge-workspace-switch</span>
                <p className="text-xs text-muted-foreground">
                  {t("gestures.dnd_workspace_hint", {
                    defaultValue: "Drag from the edge to move to the next workspace instead.",
                  })}
                </p>
              </div>
              <Switch
                checked={gestures?.["dnd-edge-workspace-switch"] ?? false}
                onCheckedChange={(checked) =>
                  patchGestures((node) => {
                    node["dnd-edge-workspace-switch"] = checked;
                  })
                }
              />
            </div>

            <fieldset className="space-y-2 rounded-md border border-border-subtle p-3">
              <legend className="px-1 font-mono text-xs text-muted-foreground">hot-corners</legend>
              <p className="text-xs text-muted-foreground">
                {t("gestures.hot_corners_hint", {
                  defaultValue:
                    "One action string per corner, in the same syntax as a key binding action. Leave a field empty to keep the niri default.",
                })}
              </p>
              {HOT_CORNER_KEYS.map((key) => (
                <div key={key} className="space-y-1">
                  <Label htmlFor={`corner-${key}`} className="font-mono text-xs text-muted-foreground">
                    {key}
                  </Label>
                  <Input
                    id={`corner-${key}`}
                    className="h-8 font-mono"
                    placeholder={t("gestures.corner_placeholder", { defaultValue: "niri default" })}
                    value={(gestures?.["hot-corners"] as HotCornersConfig | null)?.[key] ?? ""}
                    onChange={(event) => {
                      const raw = event.target.value;
                      patchGestures((node) => {
                        if (!node["hot-corners"]) node["hot-corners"] = {};
                        node["hot-corners"][key] = raw === "" ? null : raw;
                      });
                    }}
                  />
                </div>
              ))}
            </fieldset>
          </section>

          <SwitchEventsPanel
            switchEvents={switchEvents}
            draft={newSpawn}
            onDraftChange={(key, value) =>
              setNewSpawn((current) => ({ ...current, [key]: value }))
            }
            onAdd={(key) => {
              const command = (newSpawn[key] ?? "").trim();
              if (command === "") return;
              const existing = switchEvents?.[key] ?? [];
              const entry: SpawnEntry = { command };
              patchSwitchEvents(key, [...existing, entry]);
              setNewSpawn((current) => ({ ...current, [key]: "" }));
              logger.debug("GesturesDebugPage", "switch event entry added", { key });
            }}
            onRemove={(key, index) => {
              const existing = [...(switchEvents?.[key] ?? [])];
              existing.splice(index, 1);
              patchSwitchEvents(key, existing);
            }}
            onClear={(key) => {
              patchSwitchEvents(key, []);
              logger.debug("GesturesDebugPage", "switch event entries cleared", { key });
            }}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-card p-4">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              <h2 className="text-lg font-semibold">
                {t("gestures.overlay", { defaultValue: "Switcher overlay & overview" })}
              </h2>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-muted p-2.5">
              <span className="font-mono text-sm">hotkey-overlay enabled</span>
              <Switch
                checked={hotkeyOverlay?.enabled ?? false}
                onCheckedChange={(checked) =>
                  patchHotkeyOverlay((node) => {
                    node.enabled = checked;
                  })
                }
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["width", hotkeyOverlay?.width],
                  ["height", hotkeyOverlay?.height],
                  ["delay-ms", hotkeyOverlay?.["delay-ms"]],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="space-y-1">
                  <Label htmlFor={`overlay-${key}`} className="font-mono text-xs text-muted-foreground">
                    {key}
                  </Label>
                  <Input
                    id={`overlay-${key}`}
                    type="number"
                    className="h-8 font-mono"
                    placeholder={t("gestures.niri_default", { defaultValue: "niri default" })}
                    value={value ?? ""}
                    onChange={(event) => {
                      const raw = event.target.value;
                      patchHotkeyOverlay((node) => {
                        const numeric = Number(raw);
                        if (raw === "") {
                          delete node[key];
                        } else {
                          node[key] = Number.isFinite(numeric) ? numeric : 0;
                        }
                      });
                    }}
                  />
                </div>
              ))}
            </div>

            <fieldset className="space-y-2 rounded-md border border-border-subtle p-3">
              <legend className="px-1 font-mono text-xs text-muted-foreground">overview</legend>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="overview-zoom" className="font-mono text-xs text-muted-foreground">
                    zoom
                  </Label>
                  <Input
                    id="overview-zoom"
                    type="number"
                    step="0.01"
                    className="h-8 font-mono"
                    placeholder={t("gestures.niri_default", { defaultValue: "niri default" })}
                    value={overview?.zoom ?? ""}
                    onChange={(event) => {
                      const raw = event.target.value;
                      patchOverview((node) => {
                        if (raw === "") {
                          delete node.zoom;
                        } else {
                          const numeric = Number(raw);
                          node.zoom = Number.isFinite(numeric) ? numeric : 1;
                        }
                      });
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="overview-backdrop" className="font-mono text-xs text-muted-foreground">
                    backdrop-color
                  </Label>
                  <Input
                    id="overview-backdrop"
                    className="h-8 font-mono"
                    placeholder="rrggbbaa"
                    value={overview?.["backdrop-color"] ?? ""}
                    onChange={(event) => {
                      const raw = event.target.value;
                      patchOverview((node) => {
                        node["backdrop-color"] = raw === "" ? null : raw;
                      });
                    }}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="overview-shadow" className="font-mono text-xs text-muted-foreground">
                  workspace-shadow
                </Label>
                <Switch
                  id="overview-shadow"
                  checked={overview?.["workspace-shadow"] ?? false}
                  onCheckedChange={(checked) =>
                    patchOverview((node) => {
                      node["workspace-shadow"] = checked;
                    })
                  }
                />
              </div>
            </fieldset>

            <fieldset className="space-y-2 rounded-md border border-border-subtle p-3">
              <legend className="px-1 font-mono text-xs text-muted-foreground">recent-windows</legend>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="recent-previews" className="font-mono text-xs text-muted-foreground">
                  previews
                </Label>
                <Switch
                  id="recent-previews"
                  checked={recentWindows?.previews ?? false}
                  onCheckedChange={(checked) =>
                    patchRecentWindows((node) => {
                      node.previews = checked;
                    })
                  }
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="recent-highlight" className="font-mono text-xs text-muted-foreground">
                  highlight
                </Label>
                <Switch
                  id="recent-highlight"
                  checked={recentWindows?.highlight ?? false}
                  onCheckedChange={(checked) =>
                    patchRecentWindows((node) => {
                      node.highlight = checked;
                    })
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["debounce-ms", recentWindows?.["debounce-ms"]],
                    ["open-delay-ms", recentWindows?.["open-delay-ms"]],
                  ] as const
                ).map(([key, value]) => (
                  <div key={key} className="space-y-1">
                    <Label
                      htmlFor={`recent-${key}`}
                      className="font-mono text-xs text-muted-foreground"
                    >
                      {key}
                    </Label>
                    <Input
                      id={`recent-${key}`}
                      type="number"
                      className="h-8 font-mono"
                      placeholder={t("gestures.niri_default", { defaultValue: "niri default" })}
                      value={value ?? ""}
                      onChange={(event) => {
                        const raw = event.target.value;
                        patchRecentWindows((node) => {
                          const numeric = Number(raw);
                          if (raw === "") {
                            delete node[key];
                          } else {
                            node[key] = Number.isFinite(numeric) ? numeric : 0;
                          }
                        });
                      }}
                    />
                  </div>
                ))}
              </div>
            </fieldset>
          </section>

          <section className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-card p-4">
            <div className="flex items-center gap-2">
              <Bug className="h-4 w-4 text-primary" />
              <h2 className="text-lg font-semibold">
                {t("gestures.debug", { defaultValue: "Compositor debug" })}
              </h2>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("gestures.debug_hint", {
                defaultValue:
                  "These are written to config.kdl and read by niri at load. A higher log level slows the compositor down; dump-frames writes images to disk.",
              })}
            </p>

            <div className="space-y-1">
              <Label className="font-mono text-xs text-muted-foreground">log-level</Label>
              <Select
                value={debug?.["log-level"] ?? LOG_LEVEL_NONE}
                onValueChange={(value) =>
                  patchDebug((node) => {
                    node["log-level"] = value === LOG_LEVEL_NONE ? null : value;
                  })
                }
              >
                <SelectTrigger className="h-8 font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={LOG_LEVEL_NONE} className="font-mono text-xs">
                    {t("gestures.log_default", { defaultValue: "niri default (warn)" })}
                  </SelectItem>
                  {LOG_LEVELS.map((level) => (
                    <SelectItem key={level} value={level} className="font-mono text-xs">
                      {level}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {(
              [
                [
                  "disable-direct-scanout",
                  debug?.["disable-direct-scanout"] ?? false,
                  t("gestures.disable_scanout_hint", {
                    defaultValue: "Hand every frame through the compositor instead of scanning out directly.",
                  }),
                ],
                [
                  "dump-frames",
                  debug?.["dump-frames"] ?? false,
                  t("gestures.dump_frames_hint", {
                    defaultValue: "Write every rendered frame to disk as an image.",
                  }),
                ],
                [
                  "preview-render",
                  debug?.["preview-render"] ?? false,
                  t("gestures.preview_render_hint", {
                    defaultValue: "Ask clients for preview-style rendering.",
                  }),
                ],
                [
                  "honor-xdg-activation-token",
                  debug?.["honor-xdg-activation-token"] ?? false,
                  t("gestures.activation_token_hint", {
                    defaultValue: "Focus a window by the XDG activation token it was launched with.",
                  }),
                ],
              ] as const
            ).map(([key, value, hint]) => (
              <div
                key={key}
                className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-muted p-2.5"
              >
                <div className="min-w-0">
                  <span className="font-mono text-sm">{key}</span>
                  <p className="text-xs text-muted-foreground">{hint}</p>
                </div>
                <Switch
                  checked={value}
                  onCheckedChange={(checked) =>
                    patchDebug((node) => {
                      node[key] = checked;
                    })
                  }
                />
              </div>
            ))}
          </section>
        </div>

        <section className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ScanEye className="h-4 w-4 text-primary" />
              <h2 className="text-lg font-semibold">
                {t("gestures.diagnostics", { defaultValue: "Runtime diagnostics" })}
              </h2>
              <Badge variant="outline" className="font-mono text-xs">
                read-only
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={runProbes} disabled={probing}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
                {t("gestures.run_probe", { defaultValue: "Query niri" })}
              </Button>
              <Button size="sm" variant="ghost" onClick={exportDump}>
                {dumped ? (
                  <Check className="mr-1 h-3.5 w-3.5 text-success" />
                ) : (
                  <Copy className="mr-1 h-3.5 w-3.5" />
                )}
                {t("gestures.export_dump", { defaultValue: "Copy diagnostics" })}
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {t("gestures.diagnostics_hint", {
              defaultValue:
                "Answers come from the running compositor over its IPC socket. Nothing here is stored, and the copy holds these answers only — no config, no environment, no commands.",
            })}
          </p>

          <div className="divide-y divide-border-subtle rounded-md border border-border-subtle">
            {diagnostics.map((item) => {
              const probe = probes[item.key] ?? IDLE_PROBE;
              return (
                <div
                  key={item.key}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <span className="font-mono text-xs text-muted-foreground">{item.label}</span>
                  <ProbeValue probe={probe} notChecked={t("gestures.not_checked", { defaultValue: "not checked" })} />
                </div>
              );
            })}
          </div>

          {Object.values(probes).some((probe) => probe.state === "unavailable") && (
            <p className="text-xs text-warning">
              {t("gestures.probe_failed", {
                defaultValue:
                  "At least one command could not answer, so niri is likely not running or this build has no IPC support. The values above are only what came back.",
              })}
            </p>
          )}
        </section>

        {!hasGestureConfig ? (
          <RuleEmptyState
            icon={Hand}
            title={t("gestures.empty_title", { defaultValue: "Nothing tuned here" })}
            description={t("gestures.empty_description", {
              defaultValue:
                "No gestures node, no switch events, no debug block — niri is running on its own defaults. A switch above writes the matching node to config.kdl.",
            })}
          />
        ) : null}

        <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-3">
          <div className="flex items-center gap-2">
            <FileCode2 className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate text-sm font-medium">
              {t("gestures.kdl_title", { defaultValue: "Generated KDL" })}
            </span>
          </div>
          {kdlLines.length === 0 ? (
            <p className="rounded-md bg-muted p-3 font-mono text-xs text-muted-foreground">
              {t("gestures.kdl_empty", {
                defaultValue: "No node to write: every field above is at its niri default.",
              })}
            </p>
          ) : (
            <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed text-foreground">
              <code>{kdlLines.join("\n")}</code>
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

interface ProbeValueProps {
  probe: Probe;
  notChecked: string;
}

function ProbeValue({ probe, notChecked }: ProbeValueProps) {
  switch (probe.state) {
    case "loading":
      return (
        <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          <RefreshCw className="h-3 w-3 animate-spin" />
          querying
        </span>
      );
    case "ok":
      return (
        <span className="flex items-center gap-1.5 font-mono text-xs text-foreground">
          <Wifi className="h-3 w-3 text-success" />
          {probe.value}
        </span>
      );
    case "unavailable":
      return (
        <span className="flex items-center gap-1.5 font-mono text-xs text-warning">
          <WifiOff className="h-3 w-3" />
          {probe.reason}
        </span>
      );
    default:
      return (
        <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          <CircleSlash className="h-3 w-3" />
          {notChecked}
        </span>
      );
  }
}

interface SwitchEventsPanelProps {
  switchEvents: SwitchEventsConfig | null;
  draft: Record<string, string>;
  onDraftChange: (key: SwitchEventKey, value: string) => void;
  onAdd: (key: SwitchEventKey) => void;
  onRemove: (key: SwitchEventKey, index: number) => void;
  onClear: (key: SwitchEventKey) => void;
}

/**
 * One block per switch event.
 *
 * niri runs a switch event's list as a sequence, so entries keep the order they
 * are added in; the index in the list is the index niri will use.
 */
function SwitchEventsPanel({
  switchEvents,
  draft,
  onDraftChange,
  onAdd,
  onRemove,
  onClear,
}: SwitchEventsPanelProps) {
  const { t } = useTranslation();

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-card p-4">
      <div className="flex items-center gap-2">
        <Layers className="h-4 w-4 text-primary" />
        <h2 className="text-lg font-semibold">
          {t("gestures.switch_events", { defaultValue: "Switch events" })}
        </h2>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("gestures.switch_events_hint", {
          defaultValue:
            "Commands niri runs when the lid opens or closes, or when the machine enters or leaves tablet mode. Unset events are left to niri.",
        })}
      </p>

      {SWITCH_EVENT_KEYS.map((key) => {
        const entries = switchEvents?.[key] ?? null;
        const isUnset = entries === null;
        return (
          <div key={key} className="space-y-2 rounded-md border border-border-subtle p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-sm">{key}</span>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono text-xs">
                  {isUnset ? t("gestures.unset", { defaultValue: "unset" }) : `${entries.length}`}
                </Badge>
                {isUnset ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onAdd(key)}
                    disabled={(draft[key] ?? "").trim() === ""}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    {t("gestures.arm", { defaultValue: "Arm" })}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-danger"
                    onClick={() => onClear(key)}
                  >
                    <Eraser className="mr-1 h-3.5 w-3.5" />
                    {t("gestures.back_to_default", { defaultValue: "Back to default" })}
                  </Button>
                )}
              </div>
            </div>

            {isUnset ? (
              <>
                <p className="text-xs text-muted-foreground">
                  {t("gestures.unset_hint", {
                    defaultValue: "No commands. Typing one here and pressing Arm writes an empty list first.",
                  })}
                </p>
                <Input
                  className="h-8 font-mono"
                  placeholder={t("gestures.command_placeholder", { defaultValue: "command" })}
                  aria-label={`${key} command`}
                  value={draft[key] ?? ""}
                  onChange={(event) => onDraftChange(key, event.target.value)}
                />
              </>
            ) : (
              <>
                {entries.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("gestures.empty_list", {
                      defaultValue: "Empty list: the event is defined and does nothing.",
                    })}
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {entries.map((entry, index) => (
                      <div
                        key={`${entry.command}-${index}`}
                        className="flex items-center gap-2 rounded-md bg-muted p-2"
                      >
                        <span className="font-mono text-xs text-muted-foreground">#{index + 1}</span>
                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                          {entry.command}
                          {entry.args && entry.args.length > 0 ? ` ${entry.args.join(" ")}` : ""}
                        </span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-muted-foreground hover:text-danger"
                          onClick={() => onRemove(key, index)}
                          aria-label={t("common.delete")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Input
                    className="h-8 font-mono"
                    placeholder={t("gestures.command_placeholder", { defaultValue: "command" })}
                    aria-label={`${key} new command`}
                    value={draft[key] ?? ""}
                    onChange={(event) => onDraftChange(key, event.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onAdd(key)}
                    disabled={(draft[key] ?? "").trim() === ""}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    {t("common.add")}
                  </Button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}

interface GesturesDebugKdlInput {
  gestures: GesturesConfig | null;
  switchEvents: SwitchEventsConfig | null;
  hotkeyOverlay: HotkeyOverlayConfig | null;
  overview: OverviewConfig | null;
  recentWindows: RecentWindowsConfig | null;
  debug: DebugConfig | null;
}

/**
 * KDL for the nodes this page owns, in the order niri documents them.
 *
 * A block is emitted only when it holds something, because writing
 * `debug { }` where niri's defaults already apply changes nothing and only
 * adds noise to the diff.
 */
function gesturesDebugToKdl(input: GesturesDebugKdlInput): string[] {
  const lines: string[] = [];

  const gesturesBody: string[] = [];
  if (input.gestures?.["dnd-edge-view-scroll"] != null) {
    gesturesBody.push(`dnd-edge-view-scroll ${input.gestures["dnd-edge-view-scroll"]}`);
  }
  if (input.gestures?.["dnd-edge-workspace-switch"] != null) {
    gesturesBody.push(`dnd-edge-workspace-switch ${input.gestures["dnd-edge-workspace-switch"]}`);
  }
  const corners = input.gestures?.["hot-corners"];
  if (corners) {
    const cornerLines: string[] = [];
    for (const key of HOT_CORNER_KEYS) {
      const value = corners[key];
      if (value != null) cornerLines.push(`    ${key} ${kdlString(value)}`);
    }
    if (cornerLines.length > 0) {
      gesturesBody.push("hot-corners {");
      gesturesBody.push(...cornerLines);
      gesturesBody.push("}");
    }
  }
  if (gesturesBody.length > 0) {
    lines.push("gestures {");
    lines.push(...gesturesBody);
    lines.push("}");
  }

  const switchBody: string[] = [];
  for (const key of SWITCH_EVENT_KEYS) {
    const entries = input.switchEvents?.[key];
    if (entries == null) continue;
    switchBody.push(`    ${key} {`);
    for (const entry of entries) {
      const args = entry.args && entry.args.length > 0 ? ` ${entry.args.join(" ")}` : "";
      switchBody.push(`        ${kdlString(entry.command)}${args}`);
    }
    switchBody.push("    }");
  }
  if (switchBody.length > 0) {
    lines.push("switch-events {");
    lines.push(...switchBody);
    lines.push("}");
  }

  const overlayBody: string[] = [];
  if (input.hotkeyOverlay?.enabled != null) {
    overlayBody.push(`enabled ${input.hotkeyOverlay.enabled}`);
  }
  if (input.hotkeyOverlay?.width != null) overlayBody.push(`width ${input.hotkeyOverlay.width}`);
  if (input.hotkeyOverlay?.height != null) overlayBody.push(`height ${input.hotkeyOverlay.height}`);
  if (input.hotkeyOverlay?.["delay-ms"] != null) {
    overlayBody.push(`delay-ms ${input.hotkeyOverlay["delay-ms"]}`);
  }
  if (overlayBody.length > 0) {
    lines.push("hotkey-overlay {");
    lines.push(...overlayBody);
    lines.push("}");
  }

  const overviewBody: string[] = [];
  if (input.overview?.zoom != null) overviewBody.push(`zoom ${input.overview.zoom}`);
  if (input.overview?.["backdrop-color"] != null) {
    overviewBody.push(`backdrop-color ${kdlString(input.overview["backdrop-color"])}`);
  }
  if (input.overview?.["workspace-shadow"] != null) {
    overviewBody.push(`workspace-shadow ${input.overview["workspace-shadow"]}`);
  }
  if (overviewBody.length > 0) {
    lines.push("overview {");
    lines.push(...overviewBody);
    lines.push("}");
  }

  const recentBody: string[] = [];
  if (input.recentWindows?.previews != null) {
    recentBody.push(`previews ${input.recentWindows.previews}`);
  }
  if (input.recentWindows?.highlight != null) {
    recentBody.push(`highlight ${input.recentWindows.highlight}`);
  }
  if (input.recentWindows?.["debounce-ms"] != null) {
    recentBody.push(`debounce-ms ${input.recentWindows["debounce-ms"]}`);
  }
  if (input.recentWindows?.["open-delay-ms"] != null) {
    recentBody.push(`open-delay-ms ${input.recentWindows["open-delay-ms"]}`);
  }
  if (recentBody.length > 0) {
    lines.push("recent-windows {");
    lines.push(...recentBody);
    lines.push("}");
  }

  const debugBody: string[] = [];
  if (input.debug?.["log-level"] != null) {
    debugBody.push(`log-level ${kdlString(input.debug["log-level"])}`);
  }
  if (input.debug?.["disable-direct-scanout"] != null) {
    debugBody.push(`disable-direct-scanout ${input.debug["disable-direct-scanout"]}`);
  }
  if (input.debug?.["dump-frames"] != null) {
    debugBody.push(`dump-frames ${input.debug["dump-frames"]}`);
  }
  if (input.debug?.["preview-render"] != null) {
    debugBody.push(`preview-render ${input.debug["preview-render"]}`);
  }
  if (input.debug?.["honor-xdg-activation-token"] != null) {
    debugBody.push(`honor-xdg-activation-token ${input.debug["honor-xdg-activation-token"]}`);
  }
  if (debugBody.length > 0) {
    lines.push("debug {");
    lines.push(...debugBody);
    lines.push("}");
  }

  return lines;
}
