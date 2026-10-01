"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Columns3, Plus, Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useConfigStore } from "@/stores/configStore";
import type { LayoutConfig } from "@/types/generated/contract";
import { logger } from "@/lib/logger";

/** Virtual viewport the preview is scaled from, in logical pixels. */
const PREVIEW_VIEWPORT_WIDTH = 1920;

const DEFAULT_COLUMN_WIDTH = 0.5;
const NIRI_DEFAULT_GAPS = 12;

const COLUMN_WIDTH_PRESETS = [0.333, 0.5, 0.666, 1.0];
const CENTER_POLICIES = ["on-overflow", "always", "never"];
/** `niri_ipc::ColumnDisplay` has exactly these two variants. */
const COLUMN_DISPLAYS = ["normal", "tabbed"];

const LAYOUT_DEFAULTS: LayoutConfig = {
  gaps: NIRI_DEFAULT_GAPS,
  "center-focused-column": "never",
  "default-column-width": DEFAULT_COLUMN_WIDTH,
};

/**
 * Layout & Columns.
 *
 * `config.layout` is global: gaps, the width a new column gets, the centering
 * policy and the empty-workspace placement. The canvas below is drawn from
 * those same numbers, so it cannot drift from what is written to the file.
 */
export function LayoutPage() {
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);

  const layout = config?.layout ?? null;

  useEffect(() => {
    logger.info("LayoutPage", "mounted");
    return () => logger.info("LayoutPage", "unmounted");
  }, []);

  const mutateLayout = useCallback((mutate: (draft: LayoutConfig) => void) => {
    const store = useConfigStore.getState();
    store.update((draft) => {
      if (!draft.layout) draft.layout = {};
      mutate(draft.layout);
    });
    store.markDirty();
  }, []);

  const addLayout = useCallback(() => {
    const store = useConfigStore.getState();
    store.update((draft) => {
      if (!draft.layout) draft.layout = { ...LAYOUT_DEFAULTS };
    });
    store.markDirty();
  }, []);

  const gaps = layout?.gaps ?? 0;
  const defaultColumnWidth = layout?.["default-column-width"] ?? DEFAULT_COLUMN_WIDTH;
  const centerFocusedColumn = layout?.["center-focused-column"] ?? "never";
  const defaultColumnDisplay = layout?.["default-column-display"] ?? "normal";
  const alwaysCenterSingleColumn = layout?.["always-center-single-column"] ?? false;
  const emptyWorkspaceAboveFirst = layout?.["empty-workspace-above-first"] ?? false;

  const preview = useMemo(() => {
    const gapShare = Math.min(0.5, Math.max(0, gaps) / PREVIEW_VIEWPORT_WIDTH);
    const share = Math.min(1, Math.max(0.1, defaultColumnWidth));
    return { gapPercent: gapShare * 100, columnPercent: share * 100 };
  }, [gaps, defaultColumnWidth]);

  if (!layout) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Columns3 className="h-4 w-4 text-primary" />
              {t("sidebar.layout")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-center">
            <p className="text-sm text-muted-foreground">
              {t("layout.empty_description", {
                defaultValue:
                  "This config has no layout block, so niri uses its own defaults. Add one to edit gaps, column width and the centering policy here.",
              })}
            </p>
            <Button onClick={addLayout} className="w-full">
              <Plus className="mr-2 h-4 w-4" />
              {t("layout.add_layout", { defaultValue: "Add layout" })}
            </Button>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-left font-mono text-xs text-muted-foreground">
              <code>{`layout {\n    gaps ${NIRI_DEFAULT_GAPS}\n    default-column-width { proportion ${DEFAULT_COLUMN_WIDTH} }\n}`}</code>
            </pre>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-card p-4">
        <Columns3 className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold">{t("sidebar.layout")}</h1>
        <span className="font-mono text-xs text-muted-foreground">config.layout</span>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="grid gap-4 lg:grid-cols-5">
          <Card className="flex flex-col lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Ruler className="h-4 w-4 text-primary" />
                {t("layout.preview_title", { defaultValue: "Column geometry" })}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-md border border-border-subtle bg-background p-2">
                <div className="relative h-40 w-full rounded-sm bg-muted">
                  <div
                    className="flex h-full w-full items-stretch"
                    style={{ padding: `${preview.gapPercent}%` }}
                  >
                    <div
                      className="relative rounded-sm border border-border bg-surface-card"
                      style={{ width: `${preview.columnPercent}%` }}
                    >
                      <div className="pointer-events-none absolute inset-0 rounded-sm ring-2 ring-inset ring-primary" />
                      <span className="absolute left-1 top-1 rounded-sm bg-primary px-1 font-mono text-xs text-primary-foreground">
                        focus
                      </span>
                      <span className="absolute bottom-1 left-1 font-mono text-xs text-muted-foreground">
                        {(defaultColumnWidth * PREVIEW_VIEWPORT_WIDTH).toFixed(0)}px
                      </span>
                    </div>
                    {/* The gap between columns is the same value niri uses for the
                        screen edges, so it is drawn rather than faked. */}
                    <div
                      className="shrink-0 self-stretch bg-background"
                      style={{ width: `${preview.gapPercent}%` }}
                    />
                    <div className="relative flex-1 rounded-sm border border-border bg-surface">
                      <span className="absolute bottom-1 left-1 font-mono text-xs text-muted-foreground">
                        {t("layout.preview_remainder", { defaultValue: "remaining width" })}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <dl className="space-y-1 font-mono text-xs">
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">layout.gaps</dt>
                  <dd className="text-foreground">{gaps}px</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">layout.default-column-width</dt>
                  <dd className="text-foreground">
                    {defaultColumnWidth} / {(defaultColumnWidth * PREVIEW_VIEWPORT_WIDTH).toFixed(0)}px
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">layout.center-focused-column</dt>
                  <dd className="text-foreground">{centerFocusedColumn}</dd>
                </div>
              </dl>

              <p className="text-xs text-muted-foreground">
                {t("layout.preview_note", {
                  defaultValue:
                    "Drawn from the values on the right against a 1920px viewport. The fields stay authoritative.",
                })}
              </p>
            </CardContent>
          </Card>

          <div className="space-y-4 lg:col-span-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  {t("layout.spacing_title", { defaultValue: "Spacing & column sizing" })}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2 rounded-md border border-border-subtle bg-surface p-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="layout-gaps">
                      {t("layout.gaps", { defaultValue: "Gaps" })}
                    </Label>
                    <span className="font-mono text-sm text-primary">{gaps}px</span>
                  </div>
                  <input
                    id="layout-gaps"
                    type="range"
                    min={0}
                    max={64}
                    step={1}
                    value={gaps}
                    onChange={(event) =>
                      mutateLayout((draft) => {
                        draft.gaps = Number(event.target.value);
                      })
                    }
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted"
                    style={{ accentColor: "var(--primary)" }}
                  />
                  <div className="flex justify-between font-mono text-xs text-muted-foreground">
                    <span>0</span>
                    <span>{t("layout.outer_and_inner", { defaultValue: "screen edges and columns" })}</span>
                    <span>64</span>
                  </div>
                </div>

                <div className="space-y-2 rounded-md border border-border-subtle bg-surface p-3">
                  <div className="flex items-center justify-between">
                    <Label>
                      {t("layout.default_column_width", { defaultValue: "Default column width" })}
                    </Label>
                    <span className="rounded-sm bg-primary/20 px-2 py-0.5 font-mono text-xs text-primary">
                      {defaultColumnWidth}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.01}
                    value={Math.min(1, Math.max(0.1, defaultColumnWidth))}
                    onChange={(event) =>
                      mutateLayout((draft) => {
                        draft["default-column-width"] = Number(event.target.value);
                      })
                    }
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted"
                    style={{ accentColor: "var(--primary)" }}
                    aria-label={t("layout.default_column_width", { defaultValue: "Default column width" })}
                  />
                  <div className="grid grid-cols-4 gap-2">
                    {COLUMN_WIDTH_PRESETS.map((preset) => (
                      <Button
                        key={preset}
                        variant={Math.abs(defaultColumnWidth - preset) < 0.005 ? "default" : "secondary"}
                        size="sm"
                        className="font-mono"
                        onClick={() =>
                          mutateLayout((draft) => {
                            draft["default-column-width"] = preset;
                          })
                        }
                      >
                        {Math.round(preset * 100)}%
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("layout.default_column_width_hint", {
                      defaultValue: "Proportion of the viewport a freshly opened tiled column takes.",
                    })}
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label>
                      {t("layout.center_focused_column", { defaultValue: "Center focused column" })}
                    </Label>
                    <Select
                      value={centerFocusedColumn}
                      onValueChange={(value) =>
                        mutateLayout((draft) => {
                          draft["center-focused-column"] = value;
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CENTER_POLICIES.map((policy) => (
                          <SelectItem key={policy} value={policy}>
                            {policy}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label>
                      {t("layout.default_column_display", { defaultValue: "Default column display" })}
                    </Label>
                    <Select
                      value={defaultColumnDisplay}
                      onValueChange={(value) =>
                        mutateLayout((draft) => {
                          draft["default-column-display"] = value;
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COLUMN_DISPLAYS.map((display) => (
                          <SelectItem key={display} value={display}>
                            {display}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between rounded-md border border-border-subtle bg-surface p-3">
                    <div className="space-y-0.5">
                      <Label htmlFor="layout-always-center">
                        {t("layout.always_center", { defaultValue: "Always center single column" })}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {t("layout.always_center_hint", {
                          defaultValue: "Center a lone column even when the policy says otherwise.",
                        })}
                      </p>
                    </div>
                    <Switch
                      id="layout-always-center"
                      checked={alwaysCenterSingleColumn}
                      onCheckedChange={(checked) =>
                        mutateLayout((draft) => {
                          draft["always-center-single-column"] = checked;
                        })
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-md border border-border-subtle bg-surface p-3">
                    <div className="space-y-0.5">
                      <Label htmlFor="layout-empty-above">
                        {t("layout.empty_above", { defaultValue: "Empty workspace above first" })}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {t("layout.empty_above_hint", {
                          defaultValue: "Keeps the empty workspace column above workspace 1.",
                        })}
                      </p>
                    </div>
                    <Switch
                      id="layout-empty-above"
                      checked={emptyWorkspaceAboveFirst}
                      onCheckedChange={(checked) =>
                        mutateLayout((draft) => {
                          draft["empty-workspace-above-first"] = checked;
                        })
                      }
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="layout-background">
                    {t("layout.background_color", { defaultValue: "Background color" })}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="layout-background"
                      type="color"
                      className="h-8 w-14 p-1"
                      value={layout["background-color"] ?? "#000000"}
                      onChange={(event) =>
                        mutateLayout((draft) => {
                          draft["background-color"] = event.target.value;
                        })
                      }
                    />
                    <span className="font-mono text-xs text-muted-foreground">
                      layout["background-color"]
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
