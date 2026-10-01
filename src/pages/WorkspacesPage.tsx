"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Code2, Keyboard, LayoutGrid, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { RuleEmptyState } from "@/components/rules/RuleEmptyState";
import { KdlPreviewPanel } from "@/components/rules/KdlPreviewPanel";
import { kdlString } from "@/components/rules/kdl";
import { WorkspaceRibbon } from "@/components/workspaces/WorkspaceRibbon";
import { useConfigStore } from "@/stores/configStore";
import type { BindEntry, LayoutConfig, NamedWorkspace } from "@/types/generated/contract";
import { logger } from "@/lib/logger";

const NO_OUTPUT = "__none__";

/**
 * Workspaces.
 *
 * `config.workspaces` is a list of named blocks and nothing more: a name, an
 * optional output it opens on, and an optional layout override. Windows, column
 * allocation and which workspace is focused right now are runtime state the
 * compositor owns, so none of it is read from or written back to this model.
 */
export function WorkspacesPage() {
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);

  const workspaces = useMemo(() => config?.workspaces ?? [], [config]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    logger.info("WorkspacesPage", "mounted");
    return () => logger.info("WorkspacesPage", "unmounted");
  }, []);

  useEffect(() => {
    if (selectedIndex !== null && selectedIndex > workspaces.length - 1) {
      setSelectedIndex(workspaces.length > 0 ? workspaces.length - 1 : null);
    }
    if (selectedIndex === null && workspaces.length > 0) setSelectedIndex(0);
  }, [workspaces.length, selectedIndex]);

  const activeIndex = selectedIndex ?? (workspaces.length > 0 ? 0 : null);
  const active = activeIndex !== null ? workspaces[activeIndex] ?? null : null;

  const patchWorkspace = useCallback((index: number, patch: (workspace: NamedWorkspace) => void) => {
    const store = useConfigStore.getState();
    store.update((draft) => {
      const workspace = draft.workspaces[index];
      if (workspace) patch(workspace);
    });
    store.markDirty();
  }, []);

  const patchActive = useCallback(
    (patch: (workspace: NamedWorkspace) => void) => {
      if (activeIndex === null) return;
      patchWorkspace(activeIndex, patch);
    },
    [activeIndex, patchWorkspace]
  );

  const addWorkspace = useCallback(() => {
    const store = useConfigStore.getState();
    const index = store.config?.workspaces.length ?? 0;
    store.update((draft) => {
      draft.workspaces.push({ name: "" });
    });
    store.markDirty();
    setNameError(null);
    setSelectedIndex(index);
    logger.info("WorkspacesPage", "workspace added");
  }, []);

  const removeWorkspace = useCallback(
    (index: number) => {
      const store = useConfigStore.getState();
      store.update((draft) => {
        draft.workspaces.splice(index, 1);
      });
      store.markDirty();
      setSelectedIndex(null);
      logger.info("WorkspacesPage", "workspace removed", { index });
    },
    []
  );

  const duplicateName = useMemo(() => {
    if (!active || activeIndex === null) return null;
    const name = active.name.trim();
    if (name === "") return null;
    return workspaces.some(
      (workspace, index) => index !== activeIndex && workspace.name === name
    );
  }, [active, activeIndex, workspaces]);

  const hotkeys = useMemo(
    () => (config ? workspaceHotkeys(config.binds.binds) : []),
    [config]
  );

  if (!config) {
    return (
      <div className="flex h-full flex-col">
        <RuleEmptyState icon={LayoutGrid} title={t("empty.title")} description={t("empty.description")} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card p-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <LayoutGrid className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">{t("sidebar.workspaces")}</h1>
          <span className="font-mono text-xs text-muted-foreground">config.workspaces</span>
          <Badge variant="outline" className="font-mono text-xs">
            {workspaces.length}
          </Badge>
        </div>
        <Button size="sm" onClick={addWorkspace}>
          <Plus className="mr-2 h-4 w-4" />
          {t("workspaces.add", { defaultValue: "Add workspace" })}
        </Button>
      </div>

      {workspaces.length === 0 ? (
        <RuleEmptyState
          icon={LayoutGrid}
          title={t("workspaces.empty_title", { defaultValue: "No named workspaces" })}
          description={t("workspaces.empty_description", {
            defaultValue:
              "This config declares no workspace blocks. niri still has workspaces, they are just unnamed and unpinned — a block here only appears once you give one a name.",
          })}
          actionLabel={t("workspaces.add", { defaultValue: "Add workspace" })}
          onAction={addWorkspace}
        />
      ) : (
        <div className="flex flex-1 flex-col gap-4 overflow-auto p-4">
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">
              {t("workspaces.ribbon_title", { defaultValue: "Declared workspaces" })}
            </h2>
            <WorkspaceRibbon workspaces={workspaces} selectedIndex={activeIndex ?? -1} onSelect={setSelectedIndex} />
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-card p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">
                  {t("workspaces.editor", { defaultValue: "Workspace" })}
                </h2>
                {activeIndex !== null && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-danger hover:bg-danger/10 hover:text-danger"
                    onClick={() => removeWorkspace(activeIndex)}
                    aria-label={t("common.delete")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              {active === null || activeIndex === null ? (
                <p className="text-sm text-muted-foreground">
                  {t("workspaces.select", { defaultValue: "Pick a workspace from the list above." })}
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="ws-name" className="font-mono text-xs text-muted-foreground">
                      name
                    </Label>
                    <Input
                      id="ws-name"
                      className="h-8 font-mono"
                      placeholder={t("workspaces.name_placeholder", { defaultValue: "e.g. web, code" })}
                      aria-invalid={!!duplicateName}
                      value={active.name}
                      onChange={(event) => {
                        setNameError(null);
                        const value = event.target.value;
                        patchActive((workspace) => {
                          workspace.name = value;
                        });
                      }}
                    />
                    {duplicateName && (
                      <p className="text-xs text-danger">
                        {t("workspaces.duplicate_name", {
                          defaultValue: "Another workspace already uses this name.",
                        })}
                      </p>
                    )}
                    {nameError && <p className="text-xs text-danger">{nameError}</p>}
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="ws-output" className="font-mono text-xs text-muted-foreground">
                      open-on-output
                    </Label>
                    <Select
                      value={active["open-on-output"] ?? NO_OUTPUT}
                      onValueChange={(value) => {
                        patchActive((workspace) => {
                          workspace["open-on-output"] = value === NO_OUTPUT ? null : value;
                        });
                      }}
                    >
                      <SelectTrigger id="ws-output">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_OUTPUT}>
                          {t("workspaces.output_dynamic", { defaultValue: "compositor decides" })}
                        </SelectItem>
                        {config.outputs.map((output) => (
                          <SelectItem key={output.name} value={output.name}>
                            {output.name}
                            {output.mode ? ` · ${output.mode}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {t("workspaces.output_hint", {
                        defaultValue:
                          "Options come from config.outputs. A name niri reports at runtime but has no block for is not listed here.",
                      })}
                    </p>
                  </div>

                  <LayoutOverrideEditor
                    layout={active.layout ?? null}
                    onChange={(layout) => {
                      patchActive((workspace) => {
                        if (layout) {
                          workspace.layout = layout;
                        } else {
                          delete workspace.layout;
                        }
                      });
                    }}
                  />
                </div>
              )}
            </section>

            <div className="flex flex-col gap-4">
              <HotkeySummary hotkeys={hotkeys} />

              {active && (
                <KdlPreviewPanel
                  nodeName="workspace"
                  lines={workspaceToKdl(active)}
                  title={t("workspaces.kdl_title", { defaultValue: "Generated KDL" })}
                  icon={<Code2 className="h-4 w-4 text-primary" />}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface LayoutOverrideEditorProps {
  layout: LayoutConfig | null;
  onChange: (layout: LayoutConfig | null) => void;
}

/**
 * The subset of `layout` a workspace block can override.
 *
 * niri takes the whole `LayoutConfig` here, but only the properties below mean
 * something per workspace: gaps, column width and the two ring colours are what
 * a person pins a workspace to. Presets are shared between workspaces rather
 * than overridden, so they are left alone.
 */
function LayoutOverrideEditor({ layout, onChange }: LayoutOverrideEditorProps) {
  const { t } = useTranslation();

  const patch = useCallback(
    (apply: (draft: LayoutConfig) => void) => {
      const next: LayoutConfig = structuredClone(layout ?? {});
      apply(next);
      onChange(next);
    },
    [layout, onChange]
  );

  return (
    <fieldset className="space-y-3 rounded-md border border-border-subtle p-3">
      <legend className="px-1 font-mono text-xs text-muted-foreground">
        {t("workspaces.layout_override", { defaultValue: "layout override" })}
      </legend>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="ws-layout-gaps" className="font-mono text-xs text-muted-foreground">
            gaps
          </Label>
          <Input
            id="ws-layout-gaps"
            type="number"
            min={0}
            className="h-8 font-mono"
            placeholder={t("workspaces.inherit", { defaultValue: "inherit" })}
            value={layout?.gaps ?? ""}
            onChange={(event) => {
              const raw = event.target.value;
              patch((next) => {
                if (raw === "") delete next.gaps;
                else {
                  const value = Number(raw);
                  if (Number.isFinite(value)) next.gaps = Math.max(0, value);
                }
              });
            }}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="ws-layout-width" className="font-mono text-xs text-muted-foreground">
            default-column-width
          </Label>
          <Input
            id="ws-layout-width"
            type="number"
            min={0}
            max={1}
            step={0.05}
            className="h-8 font-mono"
            placeholder={t("workspaces.inherit", { defaultValue: "inherit" })}
            value={layout?.["default-column-width"] ?? ""}
            onChange={(event) => {
              const raw = event.target.value;
              patch((next) => {
                if (raw === "") {
                  delete next["default-column-width"];
                } else {
                  const value = Number(raw);
                  if (Number.isFinite(value)) next["default-column-width"] = Math.min(1, Math.max(0, value));
                }
              });
            }}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="ws-ring-color" className="font-mono text-xs text-muted-foreground">
            focus-ring color
          </Label>
          <Input
            id="ws-ring-color"
            className="h-8 font-mono"
            placeholder={t("workspaces.inherit", { defaultValue: "inherit" })}
            value={layout?.["focus-ring"]?.color ?? ""}
            onChange={(event) => {
              const raw = event.target.value;
              patch((next) => {
                if (raw === "") {
                  if (next["focus-ring"]) delete next["focus-ring"].color;
                } else {
                  next["focus-ring"] = { ...(next["focus-ring"] ?? {}), color: raw };
                }
              });
            }}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="ws-border-color" className="font-mono text-xs text-muted-foreground">
            border color
          </Label>
          <Input
            id="ws-border-color"
            className="h-8 font-mono"
            placeholder={t("workspaces.inherit", { defaultValue: "inherit" })}
            value={layout?.border?.color ?? ""}
            onChange={(event) => {
              const raw = event.target.value;
              patch((next) => {
                if (raw === "") {
                  if (next.border) delete next.border.color;
                } else {
                  next.border = { ...(next.border ?? {}), color: raw };
                }
              });
            }}
          />
        </div>
      </div>

      <Button
        size="sm"
        variant="ghost"
        className="font-mono text-xs"
        disabled={layout === null}
        onClick={() => onChange(null)}
      >
        {t("workspaces.layout_clear", { defaultValue: "drop override" })}
      </Button>
    </fieldset>
  );
}

interface HotkeySummaryProps {
  hotkeys: HotkeyRow[];
}

interface HotkeyRow {
  key: string;
  actions: string[];
  targets: string[];
}

/**
 * Read-only summary of the binds that mention a workspace.
 *
 * The binds themselves are edited on the Key Bindings page; duplicating the
 * editor here would give two places to change one thing.
 */
function HotkeySummary({ hotkeys }: HotkeySummaryProps) {
  const { t } = useTranslation();

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-card p-4">
      <div className="flex items-center gap-2">
        <Keyboard className="h-4 w-4 text-primary" />
        <h2 className="text-lg font-semibold">
          {t("workspaces.hotkeys", { defaultValue: "Workspace binds" })}
        </h2>
      </div>

      {hotkeys.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("workspaces.no_hotkeys", {
            defaultValue: "No bind in this config targets a workspace by name.",
          })}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-xs text-muted-foreground">
                <th className="py-1.5 pr-3 font-normal">key</th>
                <th className="py-1.5 pr-3 font-normal">action</th>
                <th className="py-1.5 font-normal">target</th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {hotkeys.map((row) => (
                <tr key={`${row.key}-${row.actions.join(",")}`} className="border-b border-border-subtle/60">
                  <td className="py-1.5 pr-3 text-foreground">{row.key}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{row.actions.join(", ")}</td>
                  <td className="py-1.5 text-muted-foreground">{row.targets.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {t("workspaces.hotkeys_hint", {
          defaultValue: "Bindings are edited on the Key Bindings page.",
        })}
      </p>
    </section>
  );
}

/** Binds whose action names a workspace, grouped by the key that triggers them. */
function workspaceHotkeys(binds: BindEntry[]): HotkeyRow[] {
  const byKey = new Map<string, { actions: Set<string>; targets: Set<string> }>();

  for (const bind of binds) {
    if (!bind.action.startsWith("focus-workspace") && !bind.action.startsWith("move-to-workspace")) {
      continue;
    }
    const entry = byKey.get(bind.key) ?? { actions: new Set<string>(), targets: new Set<string>() };
    entry.actions.add(bind.action);
    const target = bind.args?.join(" ");
    if (target) entry.targets.add(target);
    else entry.targets.add("∅");
    byKey.set(bind.key, entry);
  }

  return Array.from(byKey.entries()).map(([key, value]) => ({
    key,
    actions: Array.from(value.actions).sort(),
    targets: Array.from(value.targets).sort(),
  }));
}

/** KDL for one `workspace` block, printing only what the block actually sets. */
function workspaceToKdl(workspace: NamedWorkspace): string[] {
  const lines: string[] = [];
  if (workspace["open-on-output"]) {
    lines.push(`open-on-output ${kdlString(workspace["open-on-output"])}`);
  }

  const layout = workspace.layout;
  if (layout && Object.keys(layout).length > 0) {
    lines.push("layout {");
    if (layout.gaps != null) lines.push(`    gaps ${layout.gaps}`);
    if (layout["default-column-width"] != null) {
      lines.push(`    default-column-width proportion ${layout["default-column-width"]}`);
    }
    const ring = layout["focus-ring"];
    if (ring && Object.keys(ring).length > 0) {
      lines.push("    focus-ring {");
      if (ring.enabled != null) lines.push(`        enabled ${ring.enabled}`);
      if (ring.color) lines.push(`        color ${kdlString(ring.color)}`);
      if (ring.width != null) lines.push(`        width ${ring.width}`);
      lines.push("    }");
    }
    const border = layout.border;
    if (border && Object.keys(border).length > 0) {
      lines.push("    border {");
      if (border.enabled != null) lines.push(`        enabled ${border.enabled}`);
      if (border.color) lines.push(`        color ${kdlString(border.color)}`);
      if (border.width != null) lines.push(`        width ${border.width}`);
      lines.push("    }");
    }
    lines.push("}");
  }

  return lines;
}